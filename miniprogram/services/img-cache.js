// 照片本机缓存：云端照片下载一次存进本机，以后直接读本地文件，打开页面不用再换链接、重新下载
// 云端照片的文件名唯一、上传后不会原地修改，所以缓存不用设过期，只按总大小淘汰最久没看的
// 下载有两条路：
//   1. wx.cloud.downloadFile：只能下自己传的照片（云存储默认仅创建者可读），不受域名白名单限制
//   2. 临时链接 + wx.downloadFile：两个人的照片都能下，但云存储域名要先加进小程序后台的 downloadFile 合法域名
// 两条都走不通时返回空，调用方退回临时链接直接显示（和以前一样）
const storeKey = require('../utils/store-key')
const KEY = storeKey('img-cache-v1')
// 下不了的（对方传的）单独存一份，满了就清空重新记，免得把索引那一份撑过 1MB
const DENIED_KEY = storeKey('img-denied-v1')
const DENIED_MAX = 3000
const LIMIT = 100 * 1024 * 1024
const PARALLEL = 4

let state = null // { files: { fileID: { p: 本地路径, s: 字节数, t: 最近使用 } } }
let denied = null // { fileID: 1 }
let saveTimer = null
let deniedTimer = null
let dirReady = false
// 临时链接下载被域名白名单拦了：记 6 小时（冷启动也知道，对方的照片不用排队空等），过后再试一次（可能已经配好了）
const BLOCKED_KEY = storeKey('img-blocked-at')
const BLOCKED_TTL = 6 * 3600 * 1000
let blocked = false
try {
  blocked = Date.now() - (wx.getStorageSync(BLOCKED_KEY) || 0) < BLOCKED_TTL
} catch (e) {
  blocked = false
}
const pending = {}
// 排队中的下载：[{ f, run, done }]，从尾部取（后进先出）
const queue = []
let running = 0

const fs = () => wx.getFileSystemManager()
const dir = () => `${wx.env.USER_DATA_PATH}/imgc`

function load() {
  if (state) return state
  let saved = null
  try {
    saved = wx.getStorageSync(KEY) || null
  } catch (e) {
    saved = null
  }
  state = { files: (saved && saved.files) || {} }
  // 缓存目录被系统或用户清掉了：索引一起作废
  try {
    fs().accessSync(dir())
  } catch (e) {
    state.files = {}
  }
  return state
}

function loadDenied() {
  if (denied) return denied
  try {
    denied = wx.getStorageSync(DENIED_KEY) || {}
  } catch (e) {
    denied = {}
  }
  return denied
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    wx.setStorage({ key: KEY, data: state, fail: () => null })
  }, 800)
}

function deny(f) {
  const d = loadDenied()
  if (Object.keys(d).length >= DENIED_MAX) denied = {}
  denied[f] = 1
  if (deniedTimer) return
  deniedTimer = setTimeout(() => {
    deniedTimer = null
    wx.setStorage({ key: DENIED_KEY, data: denied, fail: () => null })
  }, 800)
}

// 每次启动第一次用缓存目录时（这时本次还没开始下载）：清掉上次被打断留下的 .part，
// 以及索引里没有的文件（下完还没来得及记进索引就被关掉了）——它们不算进 100MB，留着只会越积越多
function ensureDir() {
  if (dirReady) return
  dirReady = true
  try {
    fs().mkdirSync(dir(), true)
  } catch (e) {
    // 已经有了
  }
  try {
    const known = new Set(Object.keys(load().files).map((k) => state.files[k].p))
    fs()
      .readdirSync(dir())
      .forEach((name) => {
        const p = `${dir()}/${name}`
        if (/\.part$/.test(name) || !known.has(p)) unlinkQuiet(p)
      })
  } catch (e) {
    // 读不了目录就算了，不影响下载
  }
}

function exists(path) {
  try {
    fs().accessSync(path)
    return true
  } catch (e) {
    return false
  }
}

// 文件名：fileID 的两段指纹 + 原扩展名
function nameOf(f) {
  let a = 5381
  let b = 0
  for (let i = 0; i < f.length; i++) {
    const c = f.charCodeAt(i)
    a = ((a << 5) + a + c) | 0
    b = (c + (b << 6) + (b << 16) - b) | 0
  }
  const m = /\.(jpe?g|png|gif|webp|heic)$/i.exec(f)
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}.${m ? m[1].toLowerCase() : 'jpg'}`
}

// 已缓存就返回本地路径（同步，只查索引），没有返回空
function local(f) {
  const hit = load().files[f]
  if (!hit) return ''
  hit.t = Date.now()
  save()
  return hit.p
}

// 和 local 一样，但先确认文件真的还在（给没有出错回调的原生查看器用）
function checked(f) {
  const p = local(f)
  if (p && !exists(p)) {
    drop(f)
    return ''
  }
  return p
}

// 本地文件打不开了（被清理或损坏），删掉记录，下次重新下载
// 同步删文件：紧接着重新下载时，不会把还没删掉的坏文件又收回来
function drop(f) {
  const s = load()
  const hit = s.files[f]
  if (!hit) return
  delete s.files[f]
  save()
  try {
    fs().unlinkSync(hit.p)
  } catch (e) {
    // 已经不在了
  }
}

function evict() {
  const s = load()
  const list = Object.keys(s.files).map((k) => ({ k, s: s.files[k].s || 0, t: s.files[k].t || 0 }))
  let total = list.reduce((n, x) => n + x.s, 0)
  if (total <= LIMIT) return
  list.sort((x, y) => x.t - y.t)
  for (let i = 0; i < list.length && total > LIMIT * 0.9; i++) {
    total -= list[i].s
    drop(list[i].k)
  }
}

function remember(f, path) {
  let size = 0
  try {
    size = fs().statSync(path).size
  } catch (e) {
    return ''
  }
  if (!size) return ''
  const s = load()
  s.files[f] = { p: path, s: size, t: Date.now() }
  save()
  evict()
  return path
}

// 没权限：只认实测的报错（-403003 empty download url），别的失败下次还会再试
function isDenied(e) {
  return !!e && (e.errCode === -403003 || /empty download url|STORAGE_EXCEED_AUTHORITY/.test(e.errMsg || ''))
}

// 路 1：自己传的照片直接从云存储下载
function viaCloud(f, dest) {
  return new Promise((done) => {
    if (loadDenied()[f] || !wx.cloud) return done('')
    wx.cloud.downloadFile({
      fileID: f,
      success: (r) =>
        fs().saveFile({
          tempFilePath: r.tempFilePath,
          filePath: dest,
          success: () => done(remember(f, dest)),
          fail: () => done('')
        }),
      fail: (e) => {
        // 对方传的：记下来，以后不再走这条路
        if (isDenied(e)) deny(f)
        done('')
      }
    })
  })
}

function unlinkQuiet(path) {
  try {
    fs().unlinkSync(path)
  } catch (e) {
    // 本来就没有
  }
}

// 发现被白名单拦了：记下时间；已经在排队的对方照片不用再等，直接放行（调用方用临时链接）
function markBlocked() {
  if (blocked) return
  blocked = true
  wx.setStorage({ key: BLOCKED_KEY, data: Date.now(), fail: () => null })
  const d = loadDenied()
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!d[queue[i].f]) continue
    const [job] = queue.splice(i, 1)
    delete pending[job.f]
    job.done('')
  }
}

// 路 2：临时链接下载，需要域名白名单
// 先下到 .part，下完整了再改名：中途被打断留下的半截文件不会被当成缓存
function viaUrl(f, dest, urlOf) {
  if (blocked) return Promise.resolve('')
  const part = dest + '.part'
  return urlOf(f).then(
    (url) =>
      new Promise((done) => {
        if (!url || !/^https:/.test(url)) return done('')
        unlinkQuiet(part)
        wx.downloadFile({
          url,
          filePath: part,
          success: (r) => {
            if (r.statusCode !== 200) {
              unlinkQuiet(part)
              return done('')
            }
            try {
              fs().renameSync(part, dest)
            } catch (e) {
              unlinkQuiet(part)
              return done('')
            }
            done(remember(f, dest))
          },
          fail: (e) => {
            unlinkQuiet(part)
            if (/domain list/.test((e && e.errMsg) || '')) markBlocked()
            done('')
          }
        })
      }),
    () => ''
  )
}

// 后进先出：刚打开的页面先下，离开的页面剩下的排后面
function next() {
  while (running < PARALLEL && queue.length) {
    const job = queue.pop()
    running += 1
    job.run().then(() => {
      running -= 1
      next()
    })
  }
}

// 下载到本机并返回本地路径；下不了返回空。同一张同时只下一次
// urlOf(fileID) => Promise<临时链接>
function fetch(f, urlOf) {
  const hit = local(f)
  if (hit) return Promise.resolve(hit)
  // 已知两条路都走不通（对方的照片、白名单没配）：不排队，调用方直接用临时链接
  if (loadDenied()[f] && blocked) return Promise.resolve('')
  if (pending[f]) {
    // 还在排队的又被要了一次（比如刚打开的页面也有这张）：挪到最前面先下
    const i = queue.findIndex((j) => j.f === f)
    if (i >= 0 && i !== queue.length - 1) queue.push(queue.splice(i, 1)[0])
    return pending[f]
  }
  pending[f] = new Promise((resolve) => {
    let settled = false
    const job = {
      f,
      done: (p) => {
        if (settled) return
        settled = true
        delete pending[f]
        resolve(p)
      },
      run: () =>
        Promise.resolve()
          .then(() => {
            ensureDir()
            const dest = `${dir()}/${nameOf(f)}`
            // 文件已经在了（上次下完还没来得及记进索引）：直接收回，不再下载
            if (exists(dest)) {
              const p = remember(f, dest)
              if (p) return p
            }
            return viaCloud(f, dest).then((p) => p || viaUrl(f, dest, urlOf))
          })
          .catch(() => '')
          .then((p) => job.done(p))
    }
    queue.push(job)
    next()
  })
  return pending[f]
}

// 供排查：缓存了多少张、占多大、临时链接下载是否被白名单拦了
function stats() {
  const s = load()
  const keys = Object.keys(s.files)
  return { count: keys.length, bytes: keys.reduce((n, k) => n + (s.files[k].s || 0), 0), blocked }
}

module.exports = { local, checked, fetch, drop, stats }
