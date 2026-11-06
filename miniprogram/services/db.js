// 数据层：配置了云开发环境就调云函数（两个人共享）；
// 没配置就在本机直接运行同一份云函数逻辑（services/server.js，仅供预览）
// 两种模式对外接口完全一致，页面不用关心数据在哪
const config = require('../config')

const CLOUD = !!config.envId
const CACHE = require('../utils/store-key')('cache:')
let localServer = null

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === undefined || v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    // 存储满了也不影响主流程
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function fail(code, msg) {
  const e = new Error(msg)
  e.code = code
  return e
}

function init() {
  if (!CLOUD) return
  if (!wx.cloud) throw fail('no-cloud', '微信版本太低，不支持云开发')
  wx.cloud.init({ env: config.envId, traceUser: true })
}

function unwrap(r) {
  if (!r || !r.ok) throw fail((r && r.code) || 'error', (r && r.msg) || '请求失败')
  return r.data
}

function callCloud(action, data) {
  return wx.cloud.callFunction({ name: 'api', data: Object.assign({ action }, data) }).then(
    (res) => unwrap(res.result),
    (err) => {
      const msg = String((err && err.errMsg) || err)
      if (/FunctionName|not found|-501000|FUNCTION_NOT_FOUND/i.test(msg)) {
        throw fail('no-function', '云函数 api 还没有部署')
      }
      if (/env|-501001|INVALID_ENV/i.test(msg)) throw fail('bad-env', '云开发环境 ID 不对')
      throw fail('network', '网络不太好，稍后再试')
    }
  )
}

function callLocal(action, data) {
  if (!localServer) localServer = require('./server')
  return localServer.main(Object.assign({ action }, data)).then(unwrap)
}

function run(action, data) {
  try {
    return CLOUD ? callCloud(action, data || {}) : callLocal(action, data || {})
  } catch (e) {
    return Promise.reject(e)
  }
}

// ---------- 缓存：页面先用上次的数据秒开，再静默刷新 ----------

function cacheKey(collection, opts) {
  const r = opts && opts.range
  return r ? `${CACHE}${collection}@${r.from}_${r.to}` : CACHE + collection
}

// 每个集合的本机修改次数：拉列表期间本机刚改过（比如刚存好一条），这次拉回来的旧列表不能覆盖缓存
const edits = {}

// 整表缓存就地修改；按日期范围的缓存直接作废，下次进页面重新拉
function patchCache(collection, fn) {
  edits[collection] = (edits[collection] || 0) + 1
  const base = CACHE + collection
  const list = read(base, null)
  if (list) write(base, fn(list))
  let keys = []
  try {
    keys = wx.getStorageInfoSync().keys || []
  } catch (e) {
    keys = []
  }
  keys
    .filter((k) => k.indexOf(base + '@') === 0)
    .forEach((k) => {
      try {
        wx.removeStorageSync(k)
      } catch (e) {
        // ignore
      }
    })
}

function withoutAwards(d) {
  const c = Object.assign({}, d)
  delete c._awards
  return c
}

// ---------- 图片 ----------

function isStored(path) {
  return /^cloud:\/\//.test(path) || path.indexOf(wx.env.USER_DATA_PATH + '/photos') === 0
}

function extOf(path) {
  const m = /\.(\w{2,4})(\?|$)/.exec(path)
  return m ? m[1].toLowerCase() : 'jpg'
}

// folder：云端存放目录（photos 原图 / thumbs 缩略图）；本机预览模式都放在 photos 目录
function storeOne(path, folder) {
  const day = new Date().toISOString().slice(0, 10)
  const name = `${folder === 'thumbs' ? 't-' : ''}${uid()}.${extOf(path)}`
  if (CLOUD) {
    return wx.cloud.uploadFile({ cloudPath: `${folder || 'photos'}/${day}/${name}`, filePath: path }).then((r) => r.fileID)
  }
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    const dir = `${wx.env.USER_DATA_PATH}/photos`
    try {
      fs.mkdirSync(dir, true)
    } catch (e) {
      // 目录已存在
    }
    const dest = `${dir}/${name}`
    fs.copyFile({ srcPath: path, destPath: dest, success: () => resolve(dest), fail: reject })
  })
}

// 缩略图：短边压到 400px 给宫格和列表用，一张几十 KB；原图本来就小或者压不了就不做
const THUMB_SHORT = 400

function makeThumb(path) {
  return new Promise((resolve) => {
    if (!wx.canIUse('compressImage.object.compressedWidth')) return resolve('')
    wx.getImageInfo({
      src: path,
      success: ({ width: w, height: h }) => {
        if (!w || !h || Math.min(w, h) <= THUMB_SHORT * 1.25) return resolve('')
        const width = w >= h ? Math.round((THUMB_SHORT * w) / h) : THUMB_SHORT
        wx.compressImage({
          src: path,
          quality: 70,
          compressedWidth: Math.min(width, 1600),
          success: (r) => resolve(r.tempFilePath),
          fail: () => resolve('')
        })
      },
      fail: () => resolve('')
    })
  })
}

// 按顺序并发处理：同时最多 n 个，结果顺序和输入一致
// 有一个失败就不再开始新的，但等已经在跑的都结束了才报失败（它们的结果调用方要记下来，重试时复用）
function mapLimit(list, n, fn) {
  const out = new Array(list.length)
  let i = 0
  let error = null
  const worker = () => {
    if (error || i >= list.length) return Promise.resolve()
    const k = i++
    return fn(list[k], k).then(
      (r) => {
        out[k] = r
        return worker()
      },
      (e) => {
        if (!error) error = e
      }
    )
  }
  return Promise.all(Array.from({ length: Math.min(n, list.length) }, worker)).then(() => {
    if (error) throw error
    return out
  })
}

module.exports = {
  isCloud: CLOUD,
  init,
  uid,

  bootstrap: () => run('bootstrap'),
  bind: (role) => run('bind', { role }),
  unbind: () => run('unbind'),
  saveCouple: (patch) => run('saveCouple', { patch }),
  // 微信通知：允许了哪几类；给自己发一条试试
  subscribe: (kinds) => run('subscribe', { kinds }),
  notifyTest: (kind) => run('notifyTest', { kind }),

  // opts: { range: { field: 'date', from, to }, limit }
  peek(collection, opts) {
    return read(cacheKey(collection, opts), null)
  },

  list(collection, opts) {
    const o = opts || {}
    const before = edits[collection] || 0
    return run('list', { collection, range: o.range, limit: o.limit }).then((list) => {
      // 拉的过程中本机改过：服务器这份可能是改之前的，用本机改过的缓存，下次再拉
      if ((edits[collection] || 0) !== before) {
        const cached = read(cacheKey(collection, o), null)
        if (cached) return cached
      }
      write(cacheKey(collection, o), list)
      return list
    })
  },

  // 拿到最新的一条，顺手更新整表缓存（详情页、编辑页、列表看到的是同一份）
  get(collection, id) {
    return run('get', { collection, id }).then((d) => {
      if (d) patchCache(collection, (list) => list.map((x) => (x._id === id ? d : x)))
      return d
    })
  },

  // 返回的文档可能带 _awards（这次操作得到的积分），页面拿来做提示
  add(collection, doc) {
    return run('add', { collection, doc }).then((d) => {
      const saved = withoutAwards(d)
      patchCache(collection, (list) => [saved].concat(list))
      return d
    })
  },

  update(collection, id, patch) {
    return run('update', { collection, id, patch }).then((p) => {
      patchCache(collection, (list) => list.map((d) => (d._id === id ? Object.assign({}, d, p) : d)))
      return p
    })
  },

  remove(collection, id) {
    return run('remove', { collection, id }).then(() => {
      patchCache(collection, (list) => list.filter((d) => d._id !== id))
      return true
    })
  },

  // 专门的业务操作：taskSubmit / taskConfirm / redeem / fulfill
  act: (action, payload) => run(action, payload),

  seedDishes(dishes) {
    return run('seed', { dishes }).then((list) => {
      write(CACHE + 'dishes', list)
      return list
    })
  },

  orderItem(date, dish, delta) {
    return run('orderItem', { date, dish: { _id: dish._id, name: dish.name }, delta })
  },

  // 新选的图片上传/保存，已经存好的原样返回；串行上传，弱网下更稳
  upload(paths, onProgress) {
    let done = 0
    return paths.reduce(
      (chain, p) =>
        chain.then((ids) => {
          if (isStored(p)) return ids.concat(p)
          return storeOne(p).then((id) => {
            done += 1
            if (onProgress) onProgress(done)
            return ids.concat(id)
          })
        }),
      Promise.resolve([])
    )
  },

  // 足迹照片：新照片连同缩略图一起上传，已经存好的原样带过（缩略图从 known 里找）
  // uploaded 由调用方保管（{ 本地路径: { p, t } }）：传完一张就记一张，上次没保存成功的重试时直接复用，不重复上传
  // 先传原图、成功了再传缩略图（原图失败就不留下没人用的缩略图）；最多 3 张同时传，有一张失败就不再开始新的
  // 返回 { photos: [原图], thumbs: [{ p, t }] }，顺序和传入一致
  uploadPhotos(paths, known, uploaded, onProgress) {
    const memo = uploaded || {}
    let done = 0
    const tick = () => {
      done += 1
      if (onProgress) onProgress(done)
    }
    return mapLimit(paths, 3, (p) => {
      if (isStored(p)) return Promise.resolve({ p, t: (known && known[p]) || '' })
      if (memo[p] && memo[p].p) {
        tick()
        return Promise.resolve(memo[p])
      }
      return makeThumb(p)
        .then((tp) =>
          storeOne(p).then((id) => {
            memo[p] = { p: id, t: '' }
            if (!tp) return memo[p]
            return storeOne(tp, 'thumbs').then(
              (tid) => {
                memo[p] = { p: id, t: tid }
                return memo[p]
              },
              () => memo[p]
            )
          })
        )
        .then((r) => {
          tick()
          return r
        })
    }).then((list) => ({
      photos: list.map((x) => x.p),
      thumbs: list.filter((x) => x.t).map((x) => ({ p: x.p, t: x.t }))
    }))
  },

  removeFiles(fileIDs) {
    const list = (fileIDs || []).filter(Boolean)
    if (!list.length) return Promise.resolve(true)
    return run('removeFiles', { fileIDs: list })
  },

  countNew(paths) {
    return paths.filter((p) => !isStored(p)).length
  }
}
