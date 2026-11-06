// 开发用：用内存数据库模拟 wx-server-sdk，测试云函数 api 的逻辑（绑定、权限、原子点菜）
// 用法：node tools/test-cloud.js
// 注意：这里的 mock 按官方文档的语义实现，只能验证我们自己的逻辑，不能代替真机测试
// 和 smoke-test 一样固定北京时间，测试结果不随电脑时区变
process.env.TZ = 'Asia/Shanghai'
const path = require('path')
const Module = require('module')
const assert = require('assert')

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
// 两个人的身份按部署设置来（cloudfunctions/api/settings.js）：换成任何身份键，测试都应该通过
const [R0, R1] = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'settings.js')).roles
const db = {}
let openid = 'A'
let seq = 0
const deleted = []

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

function getPath(obj, parts) {
  return parts.reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function applyUpdate(doc, data, prefix) {
  Object.keys(data).forEach((key) => {
    const parts = (prefix ? prefix + '.' : '') + key
    const v = data[key]
    const keys = parts.split('.')
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
      // 普通对象：深度合并（和官方行为一致）
      applyUpdate(doc, v, parts)
    } else {
      parent[last] = clone(v)
    }
  })
}

function collection(name) {
  const need = () => {
    if (!db[name]) throw new Error(`collection ${name} not exists`)
    return db[name]
  }
  let order = null
  let filter = null
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
          const d = need().find((x) => x._id === id)
          if (!d) return { stats: { updated: 0 } }
          applyUpdate(d, data)
          return { stats: { updated: 1 } }
        },
        async remove() {
          db[name] = need().filter((x) => x._id !== id)
          return { stats: { removed: 1 } }
        }
      }
    },
    async add({ data }) {
      const list = need()
      const d = clone(data)
      d._id = d._id || 'id' + ++seq
      if (list.find((x) => x._id === d._id)) throw new Error('duplicate key')
      d._openid = openid
      list.push(d)
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
    limit() {
      return api
    },
    async get() {
      const list = clone(rows())
      if (order) list.sort((a, b) => (order[1] === 'desc' ? b[order[0]] - a[order[0]] : a[order[0]] - b[order[0]]))
      return { data: list }
    },
    async count() {
      return { total: rows().length }
    }
  }
  return api
}

// 微信通知：发出去的记在 sent；sendFail(参数) 返回错误码就模拟发送失败
const sent = []
let sendFail = null
let source = 'wx_client'

const sdk = {
  DYNAMIC_CURRENT_ENV: 'dynamic',
  init() {},
  getWXContext: () => ({ OPENID: openid, SOURCE: source }),
  openapi: {
    subscribeMessage: {
      async send(args) {
        const code = sendFail && sendFail(args)
        if (code) {
          const e = new Error('openapi.subscribeMessage.send:fail ' + code)
          e.errCode = code
          throw e
        }
        sent.push(clone(args))
        return { errCode: 0 }
      }
    }
  },
  database: () => ({
    command: {
      set: (v) => new Cmd('set', v),
      inc: (v) => new Cmd('inc', v),
      remove: () => new Cmd('remove'),
      addToSet: (v) => new Cmd('addToSet', v),
      gte: (v) => new Cmd('gte', v),
      lte: (v) => new Cmd('lte', v)
    },
    async createCollection(name) {
      if (db[name]) throw new Error('exists')
      db[name] = []
    },
    collection
  }),
  async getTempFileURL({ fileList }) {
    return {
      fileList: fileList.map((f) => ({ fileID: f.fileID, tempFileURL: 'https://tmp.example/' + f.fileID.slice(8), maxAge: f.maxAge, status: 0 }))
    }
  },
  async deleteFile({ fileList }) {
    deleted.push(...fileList)
    return { fileList }
  }
}

const origLoad = Module._load
Module._load = function (req, ...rest) {
  if (req === 'wx-server-sdk') return sdk
  return origLoad.call(this, req, ...rest)
}

const { main } = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'index.js'))
const call = async (who, action, data) => {
  openid = who
  return main(Object.assign({ action }, data))
}

async function run() {
  // 未绑定：可以 bootstrap，不能读数据
  let r = await call('A', 'bootstrap')
  assert.ok(r.ok && r.data.me === null)
  assert.deepStrictEqual(Object.keys(db).sort(), [
    'anniversaries', 'couple', 'diary', 'dishes', 'logs', 'marks', 'orders', 'periods', 'plans', 'points', 'redemptions', 'rewards', 'tasks', 'trips'
  ])
  r = await call('A', 'list', { collection: 'trips' })
  assert.strictEqual(r.code, 'not-member')
  console.log('ok  首次调用自动建集合；未绑定不能读数据')

  // 绑定两个人，第三个人被拒
  assert.strictEqual((await call('A', 'bind', { role: R0 })).data.me, R0)
  assert.strictEqual((await call('B', 'bind', { role: R0 })).code, 'role-taken')
  assert.strictEqual((await call('B', 'bind', { role: R1 })).data.me, R1)
  assert.strictEqual((await call('C', 'bind', { role: R1 })).code, 'role-taken')
  assert.strictEqual((await call('C', 'list', { collection: 'plans' })).code, 'not-member')
  assert.strictEqual((await call('A', 'list', { collection: 'couple' })).code, 'bad-collection')
  console.log('ok  只能绑定两个人，第三个微信和越权集合都被拒绝')

  // 在一起日期、称呼
  r = await call('A', 'saveCouple', { patch: { togetherSince: '2024-05-20', names: { [R0]: 'X', [R1]: 'Y' }, members: [] } })
  assert.strictEqual(r.data.togetherSince, '2024-05-20')
  assert.strictEqual(db.couple[0].members.length, 2, 'members 不能被 saveCouple 改掉')
  r = await call('A', 'saveCouple', { patch: { cover: 'https://evil.example/x.jpg' } })
  assert.strictEqual(r.data.cover, '', '非云存储地址的封面不保存')
  r = await call('B', 'saveCouple', { patch: { cover: 'cloud://env/photos/cover.jpg' } })
  assert.strictEqual(r.data.cover, 'cloud://env/photos/cover.jpg')
  r = await call('A', 'bootstrap')
  assert.strictEqual(r.data.couple.cover, 'cloud://env/photos/cover.jpg', '对方能看到新封面')
  console.log('ok  saveCouple 只改允许的字段；封面只接受云存储地址')

  // 增改删，createdBy 不能伪造
  r = await call('B', 'add', { collection: 'trips', doc: { city: '杭州', createdBy: R0, photos: ['cloud://x/1.jpg'] } })
  assert.strictEqual(r.data.createdBy, R1)
  const tripId = r.data._id
  await call('A', 'update', { collection: 'trips', id: tripId, patch: { learned: { [R0]: true }, city: '杭州市' } })
  await call('A', 'update', { collection: 'trips', id: tripId, patch: { learned: { [R1]: true } } })
  r = await call('A', 'get', { collection: 'trips', id: tripId })
  assert.deepStrictEqual(r.data.learned, { [R1]: true }, '对象字段应整体替换')
  await call('A', 'remove', { collection: 'trips', id: tripId })
  assert.deepStrictEqual(deleted, ['cloud://x/1.jpg'])
  assert.strictEqual(db.trips.length, 0)
  console.log('ok  增改删；对象字段整体替换；删除时连带删云存储照片')

  // 预设菜谱只写一次
  const presets = [
    { name: '红烧肉', category: 'meat' },
    { name: '番茄炒蛋', category: 'veg' }
  ]
  r = await call('A', 'seed', { dishes: presets })
  assert.strictEqual(r.data.length, 2)
  r = await call('B', 'seed', { dishes: presets })
  assert.strictEqual(db.dishes.length, 2)
  assert.strictEqual(r.data[0].name, '红烧肉', '按预设顺序')
  console.log('ok  预设菜谱只写入一次，顺序保持')

  // 两个人同时点菜（原子加减）
  const [d1, d2] = db.dishes
  await Promise.all([
    call('A', 'orderItem', { date: '2026-10-17', dish: d1, delta: 1 }),
    call('B', 'orderItem', { date: '2026-10-17', dish: d2, delta: 1 })
  ])
  await call('B', 'orderItem', { date: '2026-10-17', dish: d1, delta: 1 })
  r = await call('A', 'get', { collection: 'orders', id: 'd2026-10-17' })
  assert.strictEqual(r.data.items[d1._id].count, 2)
  assert.deepStrictEqual(r.data.items[d1._id].by.sort(), [R0, R1].sort())
  assert.strictEqual(r.data.items[d2._id].count, 1)
  // 两个人同时点同一道还没点过的菜：要算 2 份，不能互相覆盖成 1 份
  await Promise.all([
    call('A', 'orderItem', { date: '2026-10-19', dish: d1, delta: 1 }),
    call('B', 'orderItem', { date: '2026-10-19', dish: d1, delta: 1 })
  ])
  r = await call('A', 'get', { collection: 'orders', id: 'd2026-10-19' })
  assert.strictEqual(r.data.items[d1._id].count, 2, '同时点同一道新菜')
  r = await call('A', 'orderItem', { date: '2026-10-17', dish: d2, delta: -1 })
  assert.strictEqual(r.data.items[d2._id], undefined)
  r = await call('A', 'orderItem', { date: '2026-10-18', dish: d2, delta: -1 })
  assert.strictEqual(r.data, null)
  assert.strictEqual((await call('A', 'orderItem', { date: 'x', dish: d2, delta: 1 })).code, 'bad-date')
  console.log('ok  今日菜单：两人同时点不丢菜，减到 0 自动移除，参数校验')

  // ---------- 任务 ----------
  r = await call('A', 'add', { collection: 'tasks', doc: { title: '按摩', points: 20, assignee: R1, status: 'done' } })
  const task = r.data
  assert.strictEqual(task.status, 'open', '不能直接创建已完成的任务')
  assert.strictEqual((await call('A', 'taskSubmit', { id: task._id })).code, 'not-assignee')
  assert.strictEqual((await call('B', 'taskConfirm', { id: task._id, accept: true })).code, 'self-confirm')
  await call('B', 'update', { collection: 'tasks', id: task._id, patch: { status: 'done', points: 999, title: '按摩 30 分钟' } })
  r = await call('A', 'get', { collection: 'tasks', id: task._id })
  assert.strictEqual(r.data.status, 'open', '状态不能直接改')
  assert.strictEqual(r.data.points, 20, '执行人不能改分值')
  assert.strictEqual(r.data.title, '按摩 30 分钟', '标题可以改')
  await call('B', 'taskSubmit', { id: task._id })
  r = await call('A', 'taskConfirm', { id: task._id, accept: false })
  assert.strictEqual(r.data.task.status, 'open', '打回后回到未完成')
  await call('B', 'taskSubmit', { id: task._id })
  r = await call('A', 'taskConfirm', { id: task._id, accept: true })
  assert.strictEqual(r.data.task.status, 'done')
  assert.strictEqual(r.data.award.delta, 20)
  assert.strictEqual((await call('A', 'taskConfirm', { id: task._id, accept: true })).code, 'bad-status')
  r = await call('A', 'bootstrap')
  // R1 在前面的用例里记过一条足迹（+10）
  assert.deepStrictEqual(r.data.couple.points, { [R0]: 0, [R1]: 30 })
  console.log('ok  任务：只能对方确认，状态和分值改不动，打回重做，确认后积分到账且不重复')

  // ---------- 心情 ----------
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  r = await call('B', 'add', { collection: 'diary', doc: { date: today, mood: 'happy', text: '今天很好' } })
  assert.strictEqual(r.data._awards[0].delta, 5)
  const diaryId = r.data._id
  assert.strictEqual((await call('A', 'update', { collection: 'diary', id: diaryId, patch: { text: '改' } })).code, 'not-owner')
  assert.strictEqual((await call('A', 'remove', { collection: 'diary', id: diaryId })).code, 'not-owner')
  await call('B', 'remove', { collection: 'diary', id: diaryId })
  r = await call('B', 'add', { collection: 'diary', doc: { date: today, mood: 'calm', text: '重写' } })
  assert.strictEqual(r.data._awards, undefined, '同一天删了重写不重复加分')
  r = await call('A', 'add', { collection: 'diary', doc: { date: '2020-01-01', mood: 'sad', text: '补写' } })
  assert.strictEqual(r.data._awards, undefined, '补写以前的日子不加分')
  r = await call('A', 'list', { collection: 'diary', range: { field: 'date', from: today, to: today } })
  assert.strictEqual(r.data.length, 1, '按日期范围取')
  console.log('ok  心情：只能改删自己的，每天只加一次分，补写不加分，按月取数')

  // ---------- 足迹加分 ----------
  r = await call('A', 'add', { collection: 'trips', doc: { scope: 'cn', province: '浙江省', provinceCode: '330000', city: '杭州市' } })
  assert.deepStrictEqual(r.data._awards.map((a) => a.delta), [10, 20])
  r = await call('A', 'add', { collection: 'trips', doc: { scope: 'cn', province: '浙江省', provinceCode: '330000', city: '宁波市' } })
  assert.deepStrictEqual(r.data._awards.map((a) => a.delta), [10], '同一个省第二次不再加点亮分')
  r = await call('A', 'add', { collection: 'trips', doc: { scope: 'abroad', country: '日本', city: '京都' } })
  assert.deepStrictEqual(r.data._awards.map((a) => a.delta), [10])
  r = await call('A', 'bootstrap')
  assert.deepStrictEqual(r.data.couple.points, { [R0]: 50, [R1]: 35 })
  console.log('ok  足迹：每次 +10，第一次点亮省份再 +20')

  // ---------- 旅行点评：两个人各写各的 ----------
  const trip = (await call('A', 'list', { collection: 'trips' })).data.find((t) => t.city === '京都')
  assert.strictEqual((await call('A', 'tripReview', { id: trip._id, mood: 'lol', text: 'x' })).code, 'bad-mood')
  await Promise.all([
    call('A', 'tripReview', { id: trip._id, mood: 'great', text: '  寺庙很美  ' }),
    call('B', 'tripReview', { id: trip._id, mood: 'calm', text: '有点累' })
  ])
  r = await call('A', 'get', { collection: 'trips', id: trip._id })
  assert.strictEqual(r.data.reviews[R0].mood, 'great')
  assert.strictEqual(r.data.reviews[R0].text, '寺庙很美', '去掉首尾空格')
  assert.strictEqual(r.data.reviews[R1].mood, 'calm', '两人同时写，互不覆盖')
  // 编辑足迹本身（还想顺手改对方的点评）不会动到点评
  await call('A', 'update', { collection: 'trips', id: trip._id, patch: { place: '清水寺', reviews: { [R1]: { mood: 'angry', text: '被改了' } } } })
  r = await call('A', 'get', { collection: 'trips', id: trip._id })
  assert.strictEqual(r.data.place, '清水寺')
  assert.strictEqual(r.data.reviews[R1].mood, 'calm', '通过编辑足迹改不了点评')
  await call('B', 'tripReview', { id: trip._id, remove: true })
  r = await call('A', 'get', { collection: 'trips', id: trip._id })
  assert.strictEqual(r.data.reviews[R1], undefined, '只删自己的')
  assert.strictEqual(r.data.reviews[R0].mood, 'great')
  assert.strictEqual((await call('C', 'tripReview', { id: trip._id, mood: 'great' })).code, 'not-member')
  console.log('ok  旅行点评：各写各的、同时写不覆盖、编辑足迹改不了点评、只能删自己的')

  // ---------- 奖励和兑换 ----------
  r = await call('B', 'add', { collection: 'rewards', doc: { title: '请吃火锅', cost: 30 } })
  const reward = r.data
  assert.strictEqual((await call('A', 'update', { collection: 'rewards', id: reward._id, patch: { cost: 1 } })).code, 'not-owner')
  assert.strictEqual((await call('B', 'redeem', { id: reward._id })).code, 'own-reward')
  r = await call('A', 'redeem', { id: reward._id })
  assert.strictEqual(r.data.redemption.status, 'pending')
  assert.strictEqual(r.data.award.delta, -30)
  const red = r.data.redemption
  r = await call('A', 'redeem', { id: reward._id })
  assert.strictEqual(r.code, 'not-enough')
  assert.ok(/还差 10 分/.test(r.msg))
  assert.strictEqual((await call('A', 'fulfill', { id: red._id })).code, 'not-owner')
  r = await call('B', 'fulfill', { id: red._id })
  assert.strictEqual(r.data.status, 'fulfilled')
  r = await call('A', 'bootstrap')
  assert.deepStrictEqual(r.data.couple.points, { [R0]: 20, [R1]: 35 })
  console.log('ok  奖励：不能兑换自己的，积分不够会提示差多少，只有上架的人能兑现')

  // ---------- 只读集合 ----------
  assert.strictEqual((await call('A', 'add', { collection: 'points', doc: { role: R0, delta: 999 } })).code, 'read-only')
  assert.strictEqual((await call('A', 'update', { collection: 'redemptions', id: red._id, patch: { status: 'pending' } })).code, 'read-only')
  assert.strictEqual((await call('A', 'remove', { collection: 'points', id: 'task:' + task._id })).code, 'read-only')
  r = await call('A', 'list', { collection: 'points' })
  assert.strictEqual(r.data.length, 8, '8 笔流水：早先足迹 1、任务 1、心情 1、足迹 4、兑换 1')
  console.log('ok  积分流水和兑换记录不能直接增删改')

  // ---------- 经期 ----------
  assert.strictEqual((await call('B', 'add', { collection: 'periods', doc: { start: '昨天' } })).code, 'bad-date')
  r = await call('B', 'add', { collection: 'periods', doc: { start: '2026-09-20' } })
  assert.strictEqual(r.data.end, '', '没结束时结束日为空')
  const pid = r.data._id
  assert.strictEqual((await call('A', 'update', { collection: 'periods', id: pid, patch: { end: '2026-09-10' } })).code, 'bad-date')
  r = await call('A', 'update', { collection: 'periods', id: pid, patch: { end: '2026-09-24' } })
  assert.strictEqual(r.data.end, '2026-09-24', '对方也能帮忙记结束')
  console.log('ok  经期：日期校验，结束不能早于开始，两人都能记')

  // ---------- 日历标记 ----------
  assert.strictEqual((await call('A', 'add', { collection: 'marks', doc: { start: '2026-12-01' } })).code, 'bad-type', '要选类型')
  assert.strictEqual((await call('A', 'add', { collection: 'marks', doc: { type: 'rocket', start: '2026-12-01' } })).code, 'bad-type')
  assert.strictEqual((await call('A', 'add', { collection: 'marks', doc: { type: 'trip', start: '下周' } })).code, 'bad-date')
  assert.strictEqual((await call('A', 'add', { collection: 'marks', doc: { type: 'trip' } })).code, 'bad-date', '要有日期')
  assert.strictEqual(
    (await call('A', 'add', { collection: 'marks', doc: { type: 'trip', start: '2026-12-05', end: '2026-12-01' } })).code,
    'bad-date',
    '结束不能早于开始'
  )
  assert.strictEqual(
    (await call('A', 'add', { collection: 'marks', doc: { type: 'trip', start: '2026-01-01', end: '2026-04-01' } })).code,
    'bad-date',
    '最多跨 90 天'
  )
  r = await call('A', 'add', { collection: 'marks', doc: { type: 'love', start: '2026-12-24', title: '  第一次一起过平安夜，要记很久很久很久很久很久  ' } })
  assert.strictEqual(r.data.end, '2026-12-24', '没填结束日就是当天')
  assert.strictEqual(r.data.title, '第一次一起过平安夜，要记很久很久很久很久', '标题去空格、最多 20 字')
  assert.strictEqual(r.data.createdBy, R0)
  r = await call('B', 'add', { collection: 'marks', doc: { type: 'trip', start: '2026-12-10', end: '2026-12-15', title: '去三亚' } })
  const markId = r.data._id
  r = await call('A', 'update', { collection: 'marks', id: markId, patch: { end: '2026-12-16', title: '去三亚玩' } })
  assert.strictEqual(r.data.end, '2026-12-16', '对方也能改')
  assert.strictEqual((await call('A', 'update', { collection: 'marks', id: markId, patch: { end: '2026-12-01' } })).code, 'bad-date', '改的时候也查日期')
  assert.strictEqual((await call('A', 'update', { collection: 'marks', id: markId, patch: { type: 'rocket' } })).code, 'bad-type')
  r = await call('A', 'update', { collection: 'marks', id: markId, patch: { start: '2026-12-11', end: '' } })
  assert.strictEqual(r.data.end, '2026-12-11', '结束日清空就是当天')
  r = await call('A', 'list', { collection: 'marks' })
  assert.strictEqual(r.data.length, 2)
  assert.strictEqual((await call('C', 'list', { collection: 'marks' })).code, 'not-member', '外人看不到')
  assert.ok((await call('A', 'remove', { collection: 'marks', id: markId })).ok, '对方加的也能删')
  assert.strictEqual((await call('A', 'list', { collection: 'marks' })).data.length, 1)
  console.log('ok  日历标记：类型和日期校验，跨天最多 90 天，两人都能加改删')

  // ---------- 照片临时链接：对方上传的也能看 ----------
  r = await call('A', 'fileUrls', { fileIDs: ['cloud://env/photos/b-upload.jpg', 'https://evil.example/x.jpg', 'cloud://env/photos/a.jpg'] })
  assert.deepStrictEqual(Object.keys(r.data).sort(), ['cloud://env/photos/a.jpg', 'cloud://env/photos/b-upload.jpg'], '只换本环境的云文件')
  assert.strictEqual(r.data['cloud://env/photos/a.jpg'].maxAge, 86400)
  assert.strictEqual((await call('C', 'fileUrls', { fileIDs: ['cloud://env/photos/a.jpg'] })).code, 'not-member', '外人拿不到链接')
  console.log('ok  照片临时链接：只换本环境的云文件，外人拿不到')
  r = await call('B', 'log', { event: 'image-error', detail: { kind: 'https', err: 'x' }, sys: { model: 'iPhone' } })
  assert.strictEqual(r.ok, true)
  assert.strictEqual((await call('C', 'log', { event: 'x' })).code, 'not-member', '外人不能写日志')
  assert.strictEqual((await call('A', 'add', { collection: 'logs', doc: { event: 'fake' } })).code, 'read-only')
  r = await call('A', 'list', { collection: 'logs' })
  assert.strictEqual(r.data[0].by, R1)
  console.log('ok  真机诊断日志：成员能写、能读，不能伪造')

  // ---------- 在一起的时刻 ----------
  r = await call('A', 'saveCouple', { patch: { togetherTime: '20:30' } })
  assert.strictEqual(r.data.togetherTime, '20:30')
  r = await call('A', 'saveCouple', { patch: { togetherTime: '25点' } })
  assert.strictEqual(r.data.togetherTime, '20:30', '格式不对的时间不保存')
  console.log('ok  在一起的具体时刻')

  // 解绑后可以重新绑定
  await call('B', 'unbind')
  assert.strictEqual((await call('C', 'bind', { role: R1 })).data.me, R1)
  console.log('ok  解绑后身份可以被重新绑定')

  // ---------- 老环境升级：只有 6 个集合、couple 没有 schema ----------
  for (const c of ['tasks', 'rewards', 'redemptions', 'points', 'diary', 'periods', 'logs', 'marks']) delete db[c]
  delete db.couple[0].schema
  r = await call('A', 'bootstrap')
  assert.ok(r.ok)
  assert.ok(db.tasks && db.diary && db.points && db.periods && db.marks, '补建了新集合')
  assert.strictEqual(db.couple[0].schema, 5)
  assert.strictEqual(db.couple[0].members.length, 2, '原有绑定不受影响')
  console.log('ok  已经初始化过的环境会自动补建新集合')

  // 足迹缩略图：只认已存储的文件、原图要在这条足迹里；删除足迹时缩略图一起删
  deleted.length = 0
  r = await call('A', 'add', {
    collection: 'trips',
    doc: {
      city: '苏州',
      photos: ['cloud://x/p1.jpg', 'cloud://x/p2.jpg'],
      thumbs: [
        { p: 'cloud://x/p1.jpg', t: 'cloud://x/t1.jpg' },
        { p: 'cloud://x/other.jpg', t: 'cloud://x/t9.jpg' },
        { p: 'cloud://x/p2.jpg', t: 'http://evil/t2.jpg' },
        'junk'
      ]
    }
  })
  assert.deepStrictEqual(r.data.thumbs, [{ p: 'cloud://x/p1.jpg', t: 'cloud://x/t1.jpg' }])
  const thumbTrip = r.data._id
  // 只改照片不带缩略图、照片都还在（旧版本改文字）：缩略图原样保留，什么都不删
  await call('A', 'update', { collection: 'trips', id: thumbTrip, patch: { photos: ['cloud://x/p1.jpg', 'cloud://x/p2.jpg'], note: '好玩' } })
  r = await call('A', 'get', { collection: 'trips', id: thumbTrip })
  assert.deepStrictEqual(r.data.thumbs, [{ p: 'cloud://x/p1.jpg', t: 'cloud://x/t1.jpg' }])
  assert.deepStrictEqual(deleted, [])
  // 旧版本改照片（只带 photos、不带核对信息，可能拿着旧列表）：拒绝，请它先更新；什么都不删
  r = await call('A', 'update', { collection: 'trips', id: thumbTrip, patch: { photos: ['cloud://x/p2.jpg'] } })
  assert.strictEqual(r.code, 'upgrade')
  r = await call('A', 'get', { collection: 'trips', id: thumbTrip })
  assert.deepStrictEqual(r.data.photos, ['cloud://x/p1.jpg', 'cloud://x/p2.jpg'])
  assert.deepStrictEqual(deleted, [])
  // 新版本核对过的保存：按新的照片列表过滤缩略图，移出去的原图和缩略图一起删；还在的不删
  deleted.length = 0
  await call('A', 'update', {
    collection: 'trips',
    id: thumbTrip,
    patch: {
      basePhotos: ['cloud://x/p1.jpg', 'cloud://x/p2.jpg'],
      photos: ['cloud://x/p2.jpg', 'cloud://x/p3.jpg'],
      thumbs: [{ p: 'cloud://x/p1.jpg', t: 'cloud://x/t1.jpg' }, { p: 'cloud://x/p3.jpg', t: 'cloud://x/t3.jpg' }]
    }
  })
  r = await call('A', 'get', { collection: 'trips', id: thumbTrip })
  assert.deepStrictEqual(r.data.thumbs, [{ p: 'cloud://x/p3.jpg', t: 'cloud://x/t3.jpg' }])
  assert.deepStrictEqual(deleted.sort(), ['cloud://x/p1.jpg', 'cloud://x/t1.jpg'])
  // 核对过的保存移出一张：原图和缩略图都由云函数删掉
  deleted.length = 0
  await call('A', 'update', {
    collection: 'trips',
    id: thumbTrip,
    patch: { basePhotos: ['cloud://x/p2.jpg', 'cloud://x/p3.jpg'], photos: ['cloud://x/p2.jpg'], thumbs: [] }
  })
  assert.deepStrictEqual(deleted.sort(), ['cloud://x/p3.jpg', 'cloud://x/t3.jpg'])
  deleted.length = 0
  await call('A', 'remove', { collection: 'trips', id: thumbTrip })
  assert.deepStrictEqual(deleted.sort(), ['cloud://x/p2.jpg'])
  console.log('ok  足迹缩略图：过滤非法的；旧版本改照片要先更新；核对过的保存删掉移出去的照片；删除足迹时一起删')

  // 30 张照片 + 30 张缩略图：删除时分批，每批不超过 50 个
  deleted.length = 0
  const many = Array.from({ length: 30 }, (_, i) => `cloud://x/m${i}.jpg`)
  r = await call('A', 'add', {
    collection: 'trips',
    doc: { city: '杭州', photos: many, thumbs: many.map((p) => ({ p, t: p.replace('/m', '/tm') })) }
  })
  const batches = []
  const realDelete = sdk.deleteFile
  sdk.deleteFile = async (o) => {
    batches.push(o.fileList.length)
    return realDelete.call(sdk, o)
  }
  await call('A', 'remove', { collection: 'trips', id: r.data._id })
  sdk.deleteFile = realDelete
  assert.deepStrictEqual(batches.sort(), [10, 50])
  assert.strictEqual(deleted.length, 60)
  console.log('ok  删除文件按 50 个一批')

  // （前面的用例里 B 已解绑，现在 R1 是 C）
  // 编辑时对方刚改过照片：按打开时的列表保存会弄丢对方的照片，拒绝；回应丢了的重试照常放行
  deleted.length = 0
  r = await call('A', 'add', {
    collection: 'trips',
    doc: { city: '南京', photos: ['cloud://x/a1.jpg'], thumbs: [{ p: 'cloud://x/a1.jpg', t: 'cloud://x/ta1.jpg' }] }
  })
  const nj = r.data._id
  // R1 加了一张
  await call('C', 'update', {
    collection: 'trips',
    id: nj,
    patch: {
      basePhotos: ['cloud://x/a1.jpg'],
      photos: ['cloud://x/a1.jpg', 'cloud://x/b1.jpg'],
      thumbs: [{ p: 'cloud://x/a1.jpg', t: 'cloud://x/ta1.jpg' }, { p: 'cloud://x/b1.jpg', t: 'cloud://x/tb1.jpg' }]
    }
  })
  // R0 还拿着打开时的旧列表，加了自己的一张再存：拒绝，什么都不删
  r = await call('A', 'update', {
    collection: 'trips',
    id: nj,
    patch: { basePhotos: ['cloud://x/a1.jpg'], photos: ['cloud://x/a1.jpg', 'cloud://x/a2.jpg'], thumbs: [] }
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'conflict')
  assert.deepStrictEqual(deleted, [])
  r = await call('A', 'get', { collection: 'trips', id: nj })
  assert.deepStrictEqual(r.data.photos, ['cloud://x/a1.jpg', 'cloud://x/b1.jpg'])
  assert.strictEqual(r.data.basePhotos, undefined, 'basePhotos 不存')
  // R1 那次其实存上了、只是回应丢了，带着同样的内容重试：放行
  r = await call('C', 'update', {
    collection: 'trips',
    id: nj,
    patch: { basePhotos: ['cloud://x/a1.jpg'], photos: ['cloud://x/b1.jpg', 'cloud://x/a1.jpg'] }
  })
  assert.strictEqual(r.ok, true)
  console.log('ok  编辑足迹：对方刚改过照片就拒绝保存，不按旧列表删照片；重试照常')

  // 新建足迹的回应丢了、重试：不建第二条，按这次提交的内容更新那一条，积分不重复加
  const before = (await call('A', 'bootstrap', {})).data.couple.points
  const once = { city: '成都', province: '四川省', provinceCode: '510000', clientKey: 'k-123', photos: ['cloud://x/c1.jpg', 'cloud://x/c2.jpg'] }
  r = await call('A', 'add', { collection: 'trips', doc: once })
  const firstId = r.data._id
  assert.ok(r.data._awards && r.data._awards.length)
  const mid = (await call('A', 'bootstrap', {})).data.couple.points
  deleted.length = 0
  const retryDoc = Object.assign({}, once, { photos: ['cloud://x/c1.jpg'], note: '删了一张', basePhotos: [], triedPhotos: [once.photos] })
  r = await call('A', 'add', { collection: 'trips', doc: retryDoc })
  assert.strictEqual(r.data._id, firstId, '还是那一条')
  assert.strictEqual(r.data._awards, undefined)
  assert.deepStrictEqual(r.data.photos, ['cloud://x/c1.jpg'])
  assert.deepStrictEqual(deleted, ['cloud://x/c2.jpg'], '两次之间删掉的那张由云函数删掉')
  // 同时到达的重试（另一次刚建好）：主键挡住，不建第二条
  r = await call('A', 'add', { collection: 'trips', doc: Object.assign({}, retryDoc, { triedPhotos: [once.photos, ['cloud://x/c1.jpg']] }) })
  assert.strictEqual(r.data._id, firstId)
  const trips = (await call('A', 'list', { collection: 'trips' })).data.filter((t) => t.clientKey === 'k-123')
  assert.strictEqual(trips.length, 1)
  assert.strictEqual(trips[0].note, '删了一张')
  assert.deepStrictEqual((await call('A', 'bootstrap', {})).data.couple.points, mid, '积分不重复加')
  assert.notDeepStrictEqual(mid, before)
  // 对方在两次之间改过这一条：重试拒绝，不覆盖对方的改动
  await call('C', 'update', { collection: 'trips', id: firstId, patch: { basePhotos: ['cloud://x/c1.jpg'], photos: ['cloud://x/c1.jpg', 'cloud://x/v1.jpg'], note: '对方写的' } })
  deleted.length = 0
  r = await call('A', 'add', { collection: 'trips', doc: retryDoc })
  assert.strictEqual(r.code, 'conflict')
  r = await call('A', 'get', { collection: 'trips', id: firstId })
  assert.strictEqual(r.data.note, '对方写的')
  assert.deepStrictEqual(deleted, [])
  // 别人的 clientKey 不算（R1 用同一个 key 也是新建）
  r = await call('C', 'add', { collection: 'trips', doc: Object.assign({}, once) })
  assert.notStrictEqual(r.data._id, firstId)
  console.log('ok  新建足迹重试：同一个 clientKey 不建第二条，按新内容更新，积分不重复加，对方改过就拒绝')

  await testNotify()

  console.log('\n云函数逻辑测试全部通过')
}

// 此时 A 是 R0（称呼 X），C 是 R1（称呼 Y）
async function testNotify() {
  const { NOTIFY } = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'index.js'))
  const date = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'date.js'))
  const subs = async (who) => (await call(who, 'bootstrap')).data.couple.notify.subs
  const field = (i, k) => sent[i].data[k].value

  // 代码里配好的模板：每个字段都对应到有的内容
  const SEMANTIC = ['title', 'who', 'note', 'status', 'time', 'date']
  Object.keys(NOTIFY).forEach((k) => {
    Object.keys(NOTIFY[k].fields).forEach((f) => assert.ok(SEMANTIC.includes(NOTIFY[k].fields[f]), `${k}.${f}`))
  })
  // 没配置模板：不发，也不告诉小程序有通知
  Object.keys(NOTIFY).forEach((k) => {
    NOTIFY[k].id = ''
  })
  let r = await call('A', 'bootstrap')
  assert.deepStrictEqual(r.data.couple.notify.ids, [])
  Object.assign(NOTIFY.order, { id: 'T-order', fields: { thing1: 'title', name2: 'who', time3: 'time', phrase4: 'status' } })
  Object.assign(NOTIFY.task, { id: 'T-task', fields: { thing1: 'title', thing2: 'note', phrase3: 'status' } })
  Object.assign(NOTIFY.remind, { id: 'T-remind', fields: { thing1: 'title', date2: 'date', thing3: 'note' } })
  r = await call('A', 'bootstrap')
  assert.deepStrictEqual(r.data.couple.notify.ids, [
    { kind: 'order', id: 'T-order' },
    { kind: 'task', id: 'T-task' },
    { kind: 'remind', id: 'T-remind' }
  ])
  assert.deepStrictEqual(r.data.couple.notify.subs[R0], { order: 0, task: 0, remind: 0 })

  // 没订阅过：不发
  sent.length = 0
  await call('C', 'orderItem', { date: '2026-11-01', dish: { _id: 'n1', name: '红烧肉' }, delta: 1 })
  assert.strictEqual(sent.length, 0)
  // 订阅：未知的类忽略，同一次里重复的只算一条
  r = await call('A', 'subscribe', { kinds: ['order', 'order', 'task', 'remind', 'evil'] })
  assert.deepStrictEqual(r.data.subs[R0], { order: 1, task: 1, remind: 1 })
  r = await call('A', 'subscribe', { kinds: ['order', 'remind'] })
  assert.deepStrictEqual(r.data.subs[R0], { order: 2, task: 1, remind: 2 })
  assert.deepStrictEqual(r.data.subs[R1], { order: 0, task: 0, remind: 0 })
  console.log('ok  通知：没配置模板不发；订阅一次每类多一条，未知的类忽略')

  // R1 点菜 → 通知 R0；30 分钟内接着点不再发；减菜不发
  await call('C', 'orderItem', { date: '2026-11-01', dish: { _id: 'n2', name: '一道名字特别特别特别特别特别特别长的菜' }, delta: 1 })
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].touser, 'A')
  assert.strictEqual(sent[0].templateId, 'T-order')
  assert.strictEqual(sent[0].miniprogramState, 'trial')
  assert.strictEqual(sent[0].page, 'pages/menu/index')
  assert.strictEqual(field(0, 'thing1'), '一道名字特别特别特别特别特别特别长的菜'.slice(0, 20), '事物字段截到 20 字')
  assert.strictEqual(field(0, 'name2'), 'Y')
  assert.ok(/^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/.test(field(0, 'time3')), field(0, 'time3'))
  assert.strictEqual(field(0, 'phrase4'), '点菜啦')
  await call('C', 'orderItem', { date: '2026-11-01', dish: { _id: 'n3', name: '青菜' }, delta: 1 })
  await call('C', 'orderItem', { date: '2026-11-01', dish: { _id: 'n3', name: '青菜' }, delta: -1 })
  assert.strictEqual(sent.length, 1)
  assert.strictEqual((await subs('A'))[R0].order, 1, '发出一条扣一条')
  // 自己点菜不通知自己；对方没订阅也不发
  await call('A', 'orderItem', { date: '2026-11-01', dish: { _id: 'n4', name: '鱼' }, delta: 1 })
  assert.strictEqual(sent.length, 1)
  console.log('ok  通知：对方点菜通知一次，连着点不重复发，自己点不通知自己，发一条扣一条')

  // 任务：派给对方 → 对方；派给自己不发；完成 → 发布的人；确认 → 做的人
  sent.length = 0
  r = await call('C', 'add', { collection: 'tasks', doc: { title: '洗碗', points: 10, assignee: R0 } })
  const task = r.data
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].touser, 'A')
  assert.strictEqual(sent[0].page, 'pages/plans/index')
  assert.strictEqual(field(0, 'thing2'), 'Y给你派了任务，完成得 10 分')
  assert.strictEqual(field(0, 'phrase3'), '新任务')
  await call('A', 'add', { collection: 'tasks', doc: { title: '自己的事', assignee: R0 } })
  assert.strictEqual(sent.length, 1)
  await call('C', 'subscribe', { kinds: ['task'] })
  await call('A', 'taskSubmit', { id: task._id })
  assert.strictEqual(sent.length, 2)
  assert.strictEqual(sent[1].touser, 'C')
  assert.strictEqual(field(1, 'thing2'), 'X说做完了，等你确认')
  assert.strictEqual(field(1, 'phrase3'), '待确认')
  await call('C', 'taskConfirm', { id: task._id, accept: true })
  assert.strictEqual(sent.length, 2, 'R0 的任务通知已经用完')
  await call('A', 'subscribe', { kinds: ['task'] })
  r = await call('C', 'add', { collection: 'tasks', doc: { title: '买花', points: 0, assignee: R1 } })
  await call('C', 'update', { collection: 'tasks', id: r.data._id, patch: { assignee: R0 } })
  assert.strictEqual(sent.length, 3, '改派给对方也通知')
  assert.strictEqual(field(2, 'thing2'), 'Y给你派了任务')
  console.log('ok  通知：任务派给对方、改派、做完等确认都通知到对的人，派给自己不发')

  // 对方关掉了通知（43101）：清零；页面不存在（41030）：去掉跳转再发；别的失败记日志，不影响操作
  await call('A', 'subscribe', { kinds: ['task'] })
  sendFail = (a) => (a.touser === 'A' ? 43101 : 0)
  r = await call('C', 'add', { collection: 'tasks', doc: { title: '倒垃圾', assignee: R0 } })
  assert.ok(r.ok)
  assert.strictEqual((await subs('A'))[R0].task, 0)
  await call('A', 'subscribe', { kinds: ['task'] })
  sendFail = (a) => (a.page ? 41030 : 0)
  sent.length = 0
  await call('C', 'add', { collection: 'tasks', doc: { title: '拖地', assignee: R0 } })
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].page, undefined)
  assert.strictEqual((await subs('A'))[R0].task, 0)
  await call('A', 'subscribe', { kinds: ['task'] })
  sendFail = () => 47003
  const logsBefore = db.logs.length
  r = await call('C', 'add', { collection: 'tasks', doc: { title: '做饭', assignee: R0 } })
  assert.ok(r.ok)
  assert.strictEqual(db.logs.length, logsBefore + 1)
  assert.strictEqual(db.logs[db.logs.length - 1].event, 'notify-failed')
  assert.strictEqual((await subs('A'))[R0].task, 1, '没发出去不扣')
  sendFail = null
  console.log('ok  通知：对方关掉通知就清零，没发布正式版去掉跳转再发，其他失败记日志、不影响操作')

  // 兑换奖励 → 上架的人
  r = await call('A', 'add', { collection: 'rewards', doc: { title: '看电影', cost: 5 } })
  sent.length = 0
  await call('A', 'subscribe', { kinds: ['task'] })
  await call('C', 'redeem', { id: r.data._id })
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].touser, 'A')
  assert.strictEqual(sent[0].page, 'pages/points/index')
  assert.strictEqual(field(0, 'thing2'), 'Y用 5 分兑换了，等你兑现')
  // 给自己发一条试试
  r = await call('C', 'notifyTest', { kind: 'remind' })
  assert.strictEqual(r.code, 'no-quota')
  await call('C', 'subscribe', { kinds: ['remind'] })
  r = await call('C', 'notifyTest', { kind: 'remind' })
  assert.ok(r.ok)
  assert.strictEqual(sent[sent.length - 1].touser, 'C')
  assert.strictEqual(r.data.subs[R1].remind, 0)
  // 记账成了负数（同时发的几条一条被拒收清零、一条成功减一）：再订阅从 1 记起
  db.couple[0].subs[R1].remind = -1
  r = await call('C', 'subscribe', { kinds: ['remind'] })
  assert.strictEqual(r.data.subs[R1].remind, 1)
  await call('C', 'notifyTest', { kind: 'remind' })
  console.log('ok  通知：兑换奖励通知上架的人；可以给自己发一条试试；记账成负数后能恢复')

  // 每天的提醒：明天是纪念日、在一起第 100 天，经期后天开始，两个人都收到；同一天只跑一次；小程序端冒充不了
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const tomorrow = date.addDays(today, 1)
  const lastYear = String(Number(tomorrow.slice(0, 4)) - 1) + tomorrow.slice(4)
  await call('A', 'add', { collection: 'anniversaries', doc: { title: '第一次约会', kind: 'love', date: lastYear, repeat: true, calendar: 'solar' } })
  await call('A', 'add', { collection: 'anniversaries', doc: { title: '不是明天', date: date.addDays(today, 5), repeat: false } })
  await call('A', 'saveCouple', { patch: { togetherSince: date.addDays(tomorrow, -99) } })
  db.periods = []
  await call('C', 'add', { collection: 'periods', doc: { start: date.addDays(today, -26), end: date.addDays(today, -22) } })
  for (let i = 0; i < 3; i++) {
    await call('A', 'subscribe', { kinds: ['remind'] })
    await call('C', 'subscribe', { kinds: ['remind'] })
  }
  const timer = async (who, src) => {
    openid = who
    source = src
    const res = await main({ Type: 'Timer', TriggerName: 'daily-remind' })
    source = 'wx_client'
    return res
  }
  // 预览：只看不发
  sent.length = 0
  r = await call('A', 'notifyPreview', {})
  assert.deepStrictEqual(r.data.map((x) => x.title).sort(), ['在一起第 100 天', '第一次约会', '经期预计后天开始'])
  r = await call('A', 'notifyPreview', { today: date.addDays(today, 1) })
  assert.deepStrictEqual(r.data, [], '换一天就没有')
  assert.strictEqual(sent.length, 0)
  // 小程序端带着 Type: 'Timer' 调用：当普通请求处理，没有这个操作
  r = await timer('A', 'wx_client')
  assert.strictEqual(r.code, 'bad-action')
  assert.strictEqual(sent.length, 0)
  r = await timer(undefined, 'wx_trigger')
  assert.ok(r.ok, JSON.stringify(r))
  const titles = sent.map((s) => `${s.touser}:${s.data.thing1.value}`).sort()
  assert.deepStrictEqual(titles, [
    'A:在一起第 100 天', 'A:第一次约会', 'A:经期预计后天开始',
    'C:在一起第 100 天', 'C:第一次约会', 'C:经期预计后天开始'
  ])
  const date1 = sent.find((s) => s.data.thing1.value === '第一次约会')
  assert.ok(date1.data.thing3.value.endsWith('1 周年'), date1.data.thing3.value)
  assert.strictEqual(date1.data.date2.value, `${Number(tomorrow.slice(0, 4))}年${Number(tomorrow.slice(5, 7))}月${Number(tomorrow.slice(8))}日`)
  assert.ok(sent.every((s) => s.templateId === 'T-remind'))
  r = await timer(undefined, 'wx_trigger')
  assert.strictEqual(sent.length, 6, '同一天第二次不再发')
  assert.strictEqual((await subs('A'))[R0].remind, 2, '5 条用掉 3 条')
  console.log('ok  通知：每天提醒明天的纪念日、在一起第 N 天、后天的经期，两人都收到，一天一次，小程序端冒充不了定时器')

  // 字段按类型整理：短语只留汉字，名字混写只留汉字
  await call('A', 'saveCouple', { patch: { names: { [R0]: '小X', [R1]: 'Y' } } })
  Object.assign(NOTIFY.task, { fields: { name1: 'who', phrase2: 'status', character_string3: 'title', number4: 'title', thing5: 'title' } })
  await call('C', 'subscribe', { kinds: ['task'] })
  sent.length = 0
  await call('A', 'add', { collection: 'tasks', doc: { title: '任务 No.7🎉', assignee: R1 } })
  assert.deepStrictEqual(sent[0].data, {
    name1: { value: '小' },
    phrase2: { value: '新任务' },
    character_string3: { value: 'No.7' },
    number4: { value: '7' },
    thing5: { value: '任务 No.7' }
  })
  console.log('ok  通知：按模板字段类型整理内容，去掉表情符号')
}

run().catch((e) => {
  console.error('\n失败：', e)
  process.exit(1)
})
