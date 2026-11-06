// 本机预览模式用的“假云开发”：接口和 wx-server-sdk 一致，数据存在手机本地存储
// 配合 tools/sync-server.js 生成的 server.js，让本机模式直接跑云函数的同一份业务逻辑
const PREFIX = require('../utils/store-key')('local:')

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

function load(name) {
  try {
    const v = wx.getStorageSync(PREFIX + name)
    return Array.isArray(v) ? v : null
  } catch (e) {
    return null
  }
}

function save(name, list) {
  try {
    wx.setStorageSync(PREFIX + name, list)
  } catch (e) {
    // 存储满了也不影响主流程
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

class Cmd {
  constructor(op, val) {
    this.op = op
    this.val = val
  }

  and(other) {
    return new Cmd('and', [this, other])
  }
}

function matches(v, cond) {
  if (cond instanceof Cmd) {
    if (cond.op === 'and') return cond.val.every((c) => matches(v, c))
    if (cond.op === 'gte') return v >= cond.val
    if (cond.op === 'lte') return v <= cond.val
  }
  return v === cond
}

// update 的语义：带点的键按路径写；普通对象深度合并；命令对象按命令执行
function applyUpdate(doc, data, prefix) {
  Object.keys(data).forEach((key) => {
    const path = (prefix ? prefix + '.' : '') + key
    const v = data[key]
    const keys = path.split('.')
    const parent = keys.slice(0, -1).reduce((o, k) => (o[k] == null ? (o[k] = {}) : o[k]), doc)
    const last = keys[keys.length - 1]
    if (v instanceof Cmd) {
      if (v.op === 'set') parent[last] = clone(v.val)
      else if (v.op === 'inc') parent[last] = (parent[last] || 0) + v.val
      else if (v.op === 'remove') delete parent[last]
      else if (v.op === 'addToSet') {
        parent[last] = parent[last] || []
        if (parent[last].indexOf(v.val) < 0) parent[last].push(v.val)
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      applyUpdate(doc, v, path)
    } else {
      parent[last] = clone(v)
    }
  })
}

function collection(name) {
  const need = () => {
    const list = load(name)
    if (!list) throw new Error(`collection ${name} not exists`)
    return list
  }
  let filter = null
  let order = null
  let max = 1000
  const rows = () => need().filter((d) => !filter || Object.keys(filter).every((k) => matches(d[k], filter[k])))
  const api = {
    doc(id) {
      return {
        async get() {
          const d = need().find((x) => x._id === id)
          if (!d) throw new Error('document not exists')
          return { data: clone(d) }
        },
        async update({ data }) {
          const list = need()
          const d = list.find((x) => x._id === id)
          if (!d) return { stats: { updated: 0 } }
          applyUpdate(d, data)
          save(name, list)
          return { stats: { updated: 1 } }
        },
        async remove() {
          save(name, need().filter((x) => x._id !== id))
          return { stats: { removed: 1 } }
        }
      }
    },
    async add({ data }) {
      const list = need()
      const d = clone(data)
      d._id = d._id || uid()
      if (list.find((x) => x._id === d._id)) throw new Error('duplicate key')
      list.push(d)
      save(name, list)
      return { _id: d._id }
    },
    where(cond) {
      filter = cond
      return api
    },
    orderBy(field, dir) {
      order = [field, dir]
      return api
    },
    limit(n) {
      max = n
      return api
    },
    async get() {
      const list = clone(rows())
      if (order) {
        const [f, dir] = order
        list.sort((a, b) => (dir === 'desc' ? (b[f] || 0) - (a[f] || 0) : (a[f] || 0) - (b[f] || 0)))
      }
      return { data: list.slice(0, max) }
    },
    async count() {
      return { total: rows().length }
    }
  }
  return api
}

const command = {
  set: (v) => new Cmd('set', v),
  inc: (v) => new Cmd('inc', v),
  remove: () => new Cmd('remove'),
  addToSet: (v) => new Cmd('addToSet', v),
  gte: (v) => new Cmd('gte', v),
  lte: (v) => new Cmd('lte', v)
}

module.exports = {
  // 本机模式下“已存储的文件”就是存在本地照片目录里的文件
  FILE_PREFIX: `${wx.env.USER_DATA_PATH}/photos`,
  DYNAMIC_CURRENT_ENV: 'local',
  init() {},
  getWXContext: () => ({ OPENID: 'local-user' }),
  database: () => ({
    command,
    async createCollection(name) {
      if (load(name)) throw new Error('exists')
      save(name, [])
    },
    collection
  }),
  // 本机模式发不了微信通知，当作发出去了
  openapi: {
    subscribeMessage: {
      async send() {
        return { errCode: 0 }
      }
    }
  },
  // 本机文件本身就能读，原样返回
  async getTempFileURL({ fileList }) {
    return {
      fileList: fileList.map((f) => {
        const id = typeof f === 'string' ? f : f.fileID
        return { fileID: id, tempFileURL: id, maxAge: 86400, status: 0 }
      })
    }
  },
  async deleteFile({ fileList }) {
    const fs = wx.getFileSystemManager()
    fileList.forEach((p) => {
      try {
        fs.unlinkSync(p)
      } catch (e) {
        // 文件已经不在了
      }
    })
    return { fileList }
  }
}
