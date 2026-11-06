// 云存储图片的访问地址
// 云存储默认只有上传者本人能读，所以显示和预览前，统一请云函数换成临时链接（两个人都能看）。
// 注意：云函数报回的 maxAge 是 3600 秒，但实测私有文件的临时链接十几分钟就失效（官方文档写 10 分钟），
// 所以缓存时间按 8 分钟封顶；图片加载失败时作废缓存、换新链接重试
// 能存进本机的照片优先用本机文件（见 img-cache.js），存不了的才用临时链接
const db = require('./db')
const diag = require('./diag')
const cache = require('./img-cache')

// 换了缓存名：旧版本按 48 分钟缓存的链接直接作废
const KEY = require('../utils/store-key')('file-urls-v2')
const BATCH = 50
const MAX_TTL = 8 * 60 * 1000
let urls = null
let queue = []
let waiters = []
let timer = null

const isCloud = (f) => typeof f === 'string' && f.indexOf('cloud://') === 0

function loadUrls() {
  if (urls) return urls
  try {
    urls = wx.getStorageSync(KEY) || {}
  } catch (e) {
    urls = {}
  }
  const now = Date.now()
  Object.keys(urls).forEach((k) => {
    if (!urls[k] || urls[k].exp <= now) delete urls[k]
  })
  return urls
}

function saveUrls() {
  try {
    wx.setStorageSync(KEY, urls)
  } catch (e) {
    // 存不下也不影响显示
  }
}

function peekUrl(f) {
  const hit = loadUrls()[f]
  return hit && hit.exp > Date.now() ? hit.url : ''
}

// 已经有可用地址就直接给（本机缓存优先）；本机文件、临时文件原样返回；云文件没换过返回空
function peek(f) {
  if (!f) return ''
  if (!isCloud(f)) return f
  return cache.local(f) || peekUrl(f)
}

// 某个链接打不开了，作废它
function invalidate(f) {
  const c = loadUrls()
  if (c[f]) {
    delete c[f]
    saveUrls()
  }
}

function mapOf(list) {
  const m = {}
  list.forEach((f) => {
    m[f] = isCloud(f) ? peekUrl(f) : f
  })
  return m
}

function flush() {
  timer = null
  const ids = Array.from(new Set(queue))
  const ws = waiters
  queue = []
  waiters = []
  const chunks = []
  for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH))
  Promise.all(
    chunks.map((c) =>
      db.act('fileUrls', { fileIDs: c }).catch((e) => {
        diag.report('file-urls-failed', { code: e.code || '', msg: e.message || '' })
        return {}
      })
    )
  )
    .then((results) => {
      const now = Date.now()
      const c = loadUrls()
      results.forEach((r) => {
        Object.keys(r || {}).forEach((id) => {
          c[id] = { url: r[id].url, exp: now + Math.min(r[id].maxAge * 1000 * 0.8, MAX_TTL) }
        })
      })
      saveUrls()
    })
    .then(() => ws.forEach((w) => w(mapOf(w.list))))
}

// 返回 { fileID: 临时链接 }；fresh=true 时不用缓存，一律换新
function resolve(list, opts) {
  const all = (list || []).filter(Boolean)
  const fresh = !!(opts && opts.fresh)
  if (fresh) all.filter(isCloud).forEach(invalidate)
  const need = all.filter((f) => isCloud(f) && !peekUrl(f))
  if (!need.length) return Promise.resolve(mapOf(all))
  return new Promise((done) => {
    const w = (m) => done(m)
    w.list = all
    queue = queue.concat(need)
    waiters.push(w)
    if (!timer) timer = setTimeout(flush, 30)
  })
}

const urlOf = (f) => resolve([f]).then((m) => m[f] || '')

// 显示一张照片要用的地址：先存进本机再显示；存不了就用临时链接
function load(f, opts) {
  if (!isCloud(f)) return Promise.resolve(f || '')
  if (opts && opts.fresh) invalidate(f)
  return cache.fetch(f, urlOf).then((p) => p || urlOf(f))
}

// 全屏预览（和微信聊天、朋友圈同一个原生查看器：左右滑、双指缩放、长按保存/转发）
// 本机有的直接用本机文件，其余一律先换最新链接，避免点开时链接刚好过期
// 从哪个页面打开的查看器：关掉查看器回到页面也会触发 onShow，页面可以据此跳过一次刷新
let previewFrom = ''

function previewedFrom(route) {
  const hit = previewFrom === route
  previewFrom = ''
  return hit
}

const topRoute = () => {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  return pages.length ? pages[pages.length - 1].route : ''
}

function preview(list, current) {
  const all = (list || []).filter(Boolean)
  if (!all.length) return
  const from = topRoute()
  const locals = {}
  all.forEach((f) => {
    // 查看器没有出错回调：本机文件先确认还在，不在的换临时链接
    if (isCloud(f)) locals[f] = cache.checked(f)
  })
  const need = all.filter((f) => isCloud(f) && !locals[f])
  const ready = need.length ? resolve(need, { fresh: true }) : Promise.resolve({})
  ready.then((m) => {
    // 换链接这段时间里用户已经切到别的页面了：不再弹出查看器
    if (topRoute() !== from) return
    previewFrom = from
    const pick = (f) => locals[f] || m[f] || f
    wx.previewImage({
      urls: all.map(pick),
      current: pick(current || all[0]),
      showmenu: true,
      fail: () => {
        previewFrom = ''
      }
    })
  })
}

// 足迹缩略图：thumbs 是 [{ p: 原图, t: 缩略图 }]，返回 { 原图: 缩略图 }；旧照片没有缩略图
function thumbs(doc) {
  const m = {}
  ;((doc && doc.thumbs) || []).forEach((x) => {
    if (x && x.p && x.t) m[x.p] = x.t
  })
  return m
}

module.exports = { resolve, peek, load, preview, previewedFrom, invalidate, isCloud, thumbs }
