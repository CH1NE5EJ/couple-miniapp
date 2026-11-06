// 开发用：在 Node 里模拟小程序运行时（本机模式），按真实操作顺序把各页面走一遍
// 用法：node tools/smoke-test.js
// 两人的手机都在北京时间：电脑时区（或 TZ 环境变量）不是北京时，手机的“今天”和云函数的“今天”会差一天
process.env.TZ = 'Asia/Shanghai'
const path = require('path')
const assert = require('assert')

const ROOT = path.join(__dirname, '..', 'miniprogram')
// 两个人的身份、默认称呼按部署设置来（tools/sync-server.js 从云函数复制的那份）：换成任何身份键，测试都应该通过
const SETTINGS = require(path.join(ROOT, 'services', 'settings.js'))
const [R0, R1] = SETTINGS.roles
const N0 = (SETTINGS.names && SETTINGS.names[R0]) || R0
// 本地存储键名前缀（config.js 的 storagePrefix）
const P = require(path.join(ROOT, 'config.js')).storagePrefix || 'cm:'
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0))

// 强制本机模式：不管 config.js 里填没填云环境，测试都不碰真实数据库
const configPath = require.resolve(path.join(ROOT, 'config.js'))
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: Object.assign({}, require(configPath), { envId: '' })
}

// ---------- 假的 wx ----------
const storage = {}
const nav = []
const toasts = []
global.wx = {
  env: { USER_DATA_PATH: 'wxfile://usr' },
  getStorageSync: (k) => (k in storage ? clone(storage[k]) : ''),
  setStorageSync: (k, v) => {
    storage[k] = clone(v)
  },
  removeStorageSync: (k) => {
    delete storage[k]
  },
  getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
  getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 375, pixelRatio: 2 }),
  vibrateShort() {},
  showToast: (o) => toasts.push(o.title),
  showModal: (o) => o.success && o.success({ confirm: true }),
  navigateTo: (o) => nav.push('navigateTo ' + o.url),
  navigateBack: () => nav.push('navigateBack'),
  switchTab: (o) => nav.push('switchTab ' + o.url),
  reLaunch: (o) => nav.push('reLaunch ' + o.url),
  hideHomeButton() {},
  hideTabBar() {},
  showLoading() {},
  hideLoading() {},
  cropImage: (o) => o.success({ tempFilePath: o.src.replace(/(.w+)$/, '-crop$1') }),
  showActionSheet: (o) => o.success({ tapIndex: global.__sheetPick || 0 }),
  showTabBar() {},
  setNavigationBarTitle() {},
  stopPullDownRefresh() {},
  previewImage() {},
  canIUse: () => true,
  getImageInfo: (o) => o.success({ width: 1600, height: 1200 }),
  compressImage: (o) => o.success({ tempFilePath: o.src.replace(/(\.\w+)$/, '-thumb$1') }),
  // 地图画布查不到节点（跳过绘制）；照片宫格量到 300px 宽
  createSelectorQuery: () => {
    const q = {
      select: () => q,
      fields: (o, cb) => {
        if (cb) q.rect = cb
        return q
      },
      boundingClientRect: (cb) => {
        q.rect = cb
        return q
      },
      exec: (cb) => {
        if (q.rect) q.rect({ width: '300px' })
        if (cb) cb([null])
      }
    }
    return q
  },
  getFileSystemManager: () => ({ mkdirSync() {}, unlinkSync() {}, copyFile: (o) => o.success() }),
  chooseMedia: (o) =>
    o.success({ tempFiles: [{ tempFilePath: 'http://tmp/a.jpg' }, { tempFilePath: 'http://tmp/b.png' }].slice(0, o.count) })
}

// ---------- 假的 App / Page ----------
let appCfg = null
let pageCfg = null
// 和真机一样：App() 注册时就调 onLaunch、onShow，这期间 getApp() 还拿不到实例（返回 undefined）
global.App = (cfg) => {
  appCfg = null
  cfg.onLaunch && cfg.onLaunch()
  cfg.onShow && cfg.onShow()
  appCfg = cfg
}
global.getApp = () => appCfg
global.getCurrentPages = () => []
global.Page = (cfg) => {
  pageCfg = cfg
}
let compCfg = null
global.Component = (cfg) => {
  compCfg = cfg
}
global.Behavior = (cfg) => cfg

function setPath(obj, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}
    o = o[parts[i]]
  }
  o[parts[parts.length - 1]] = value
}

function load(route) {
  const file = require.resolve(path.join(ROOT, route))
  delete require.cache[file]
  require(file)
  const cfg = pageCfg
  const page = {}
  // 页面用的 behaviors：方法和数据并进来（页面自己的同名项优先）
  const behaviors = cfg.behaviors || []
  behaviors.forEach((b) => {
    Object.keys(b.methods || {}).forEach((k) => {
      page[k] = b.methods[k].bind(page)
    })
  })
  Object.keys(cfg).forEach((k) => {
    page[k] = typeof cfg[k] === 'function' ? cfg[k].bind(page) : cfg[k]
  })
  page.data = clone(Object.assign({}, ...behaviors.map((b) => b.data || {}), cfg.data || {}))
  page.setData = (obj, cb) => {
    Object.keys(obj).forEach((k) => setPath(page.data, k, clone(obj[k])))
    if (cb) setTimeout(cb, 0)
  }
  page.getTabBar = () => ({ show() {}, setHidden() {} })
  return page
}

const ev = (dataset, detail) => ({ currentTarget: { dataset: dataset || {} }, detail: detail || {} })
const peek = (c) => storage[P + 'local:' + c] || []

async function main() {
  require(path.join(ROOT, 'app.js'))
  const app = appCfg
  await tick(5)

  // 1. 首次进入：选身份、设置在一起的日子、改称呼
  const setup = load('pages/settings/index')
  setup.onLoad({ setup: '1' })
  await tick(5)
  assert.strictEqual(setup.data.me, null)
  setup.pickRole(ev({ role: R0 }))
  await tick(5)
  assert.strictEqual(app.globalData.me, R0)
  setup.onSince(ev({}, { value: '2024-05-20' }))
  setup.onName(ev({ role: R1 }, { value: 'Y' }))
  await tick(5)
  assert.strictEqual(app.globalData.couple.togetherSince, '2024-05-20')
  assert.strictEqual(app.names()[R1], 'Y')
  console.log('ok  设置：身份 / 在一起日期 / 称呼')

  // 2. 首页
  const home = load('pages/home/index')
  home.onShow()
  await tick(1300)
  assert.ok(home.data.together.days > 800)
  assert.strictEqual(home.data.daysShown, home.data.together.days)
  assert.ok(home.data.milestone && home.data.milestone.left > 0)
  assert.strictEqual(home.data.list.length, 1)
  console.log(`ok  首页：在一起第 ${home.data.together.days} 天，下个里程碑第 ${home.data.milestone.n} 天`)

  // 3. 纪念日：农历生日 + 一次性
  let ae = load('pages/anniversary-edit/index')
  ae.onLoad({})
  ae.onTitle(ev({}, { value: 'Y 生日' }))
  ae.pickKind(ev({ key: 'birthday' }))
  ae.onDate(ev({}, { value: '1998-03-15' }))
  ae.onCalendar(ev({}, { key: 'lunar' }))
  ae.save()
  await tick(5)
  ae = load('pages/anniversary-edit/index')
  ae.onLoad({})
  ae.onTitle(ev({}, { value: '一起跨年' }))
  ae.onDate(ev({}, { value: '2026-12-31' }))
  ae.onRepeat(ev({}, { value: false }))
  ae.save()
  await tick(5)
  const saved = peek('anniversaries')
  assert.strictEqual(saved.length, 2)
  assert.strictEqual(saved.find((a) => a.title === 'Y 生日').lunarText, '二月十七')
  home.onShow()
  await tick(600)
  assert.strictEqual(home.data.list.length, 3)
  console.log('ok  纪念日：' + home.data.list.map((x) => `${x.title}(${x.num}${x.unit})`).join('，'))

  // 编辑再删除一个
  ae = load('pages/anniversary-edit/index')
  ae.onLoad({ id: saved[0]._id })
  assert.strictEqual(ae.data.form.title, saved[0].title)
  ae.remove()
  await tick(5)
  assert.strictEqual(peek('anniversaries').length, 1)
  console.log('ok  纪念日：编辑回填 / 删除')

  // 4. 足迹
  const map = load('pages/map/index')
  map.onLoad()
  map.onReady()
  map.onShow()
  await tick(5)
  assert.strictEqual(map.data.loaded, true)

  let te = load('pages/trip-edit/index')
  te.onLoad({ province: '330000' })
  assert.strictEqual(te.data.form.provinceCode, '330000')
  assert.deepStrictEqual(te.data.form.people, [N0, 'Y'])
  te.onRegion(ev({}, { value: ['浙江省', '杭州市'], code: ['330000', '330100'] }))
  te.onInput(ev({ name: 'place' }, { value: '西湖' }))
  te.onReady()
  te.choosePhotos()
  te.setCover(ev({ key: 'http://tmp/b.png' }))
  assert.strictEqual(te.data.form.photos[0], 'http://tmp/b.png')
  // 宫格：格子按加入先后排着不动，位置跟着顺序走，封面标在第一张
  assert.deepStrictEqual(te.data.items.map((it) => it.key), ['http://tmp/a.jpg', 'http://tmp/b.png'])
  assert.strictEqual(te.data.items[1].x, 0)
  assert.ok(te.data.items[0].x > 0)
  assert.strictEqual(te.data.items[1].cover, true)
  // 拖动换位：把 a 拖回第一格
  te.onDragEnd({ key: 'http://tmp/a.jpg', to: 0 })
  assert.deepStrictEqual(te.data.form.photos, ['http://tmp/a.jpg', 'http://tmp/b.png'])
  assert.strictEqual(te.data.items[0].cover, true)
  assert.deepStrictEqual(te.data.layout.order, te.data.form.photos)
  te.onDragEnd({ key: 'http://tmp/a.jpg', to: 1 })
  assert.strictEqual(te.data.form.photos[0], 'http://tmp/b.png')
  te.removePhoto(ev({ key: 'http://tmp/a.jpg' }))
  assert.deepStrictEqual(te.data.items.map((it) => it.key), ['http://tmp/b.png'])
  te.onOtherInput(ev({}, { value: '小王' }))
  te.addOther()
  te.save()
  await tick(20)

  te = load('pages/trip-edit/index')
  te.onLoad({})
  te.onScope(ev({}, { key: 'abroad' }))
  te.onInput(ev({ name: 'country' }, { value: '日本' }))
  te.onInput(ev({ name: 'abroadCity' }, { value: '京都' }))
  te.onStart(ev({}, { value: '2025-04-01' }))
  te.onEnd(ev({}, { value: '2025-04-05' }))
  assert.ok(te.data.endText.indexOf('5 天') > 0)
  te.save()
  await tick(20)

  // 没有 code 时按省名换算
  te = load('pages/trip-edit/index')
  te.onLoad({})
  te.onRegion(ev({}, { value: ['北京市', '北京市'] }))
  assert.strictEqual(te.data.form.provinceCode, '110000')
  te.save()
  await tick(20)

  const trips = peek('trips')
  assert.strictEqual(trips.length, 3)
  const hz = trips.find((t) => t.city === '杭州市')
  assert.deepStrictEqual(hz.people, [N0, 'Y', '小王'])
  assert.strictEqual(hz.photos.length, 1)
  assert.ok(hz.photos[0].indexOf('wxfile://usr/photos/') === 0)
  // 新照片带一张缩略图，按原图对应
  assert.strictEqual(hz.thumbs.length, 1)
  assert.strictEqual(hz.thumbs[0].p, hz.photos[0])
  assert.ok(hz.thumbs[0].t.indexOf('wxfile://usr/photos/t-') === 0)
  assert.strictEqual(trips.find((t) => t.country === '日本').city, '京都')

  map.onShow()
  await tick(800)
  assert.strictEqual(map.data.stats.lit, 2)
  assert.strictEqual(map.data.stats.abroad, 1)
  assert.strictEqual(map.data.shown.length, 3)
  assert.strictEqual(map.data.litShown, 2)
  map.select('330000')
  await tick(40)
  assert.strictEqual(map.data.shown.length, 1)
  assert.strictEqual(map.data.selected.count, 1)
  map.clearSelect()
  await tick(40)
  assert.strictEqual(map.data.shown.length, 3)
  console.log(`ok  足迹：点亮 ${map.data.stats.lit} 省，${map.data.stats.cities} 城，海外 ${map.data.stats.abroad} 次，按省筛选正常`)

  const td = load('pages/trip-detail/index')
  td.onLoad({ id: hz._id })
  td.onShow()
  await tick(5)
  assert.strictEqual(td.data.trip.photos.length, 1)
  assert.strictEqual(td.data.trip.people.length, 3)

  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  await tick(20)
  assert.strictEqual(te.data.form.place, '西湖')
  // 删掉已存好的照片：原图和缩略图都要从存储里删
  te.removePhoto(ev({ key: hz.photos[0] }))
  assert.deepStrictEqual(te.removed, [hz.photos[0], hz.thumbs[0].t])
  te.save()
  await tick(20)
  assert.strictEqual(peek('trips').find((t) => t._id === hz._id).photos.length, 0)
  console.log('ok  足迹：详情 / 编辑删图')

  // 保存失败后重试：已经传上去的新照片直接复用、不重复上传；保存中照片不能动；同一张不重复加；
  // 保存成功后不删任何存进去的文件；没保存就离开时删掉这次传上去的
  const dbm = require(path.join(ROOT, 'services/db.js'))
  let copies = 0
  const realFsm = wx.getFileSystemManager
  wx.getFileSystemManager = () => {
    const m = realFsm()
    const cp = m.copyFile
    m.copyFile = (o) => {
      copies += 1
      cp(o)
    }
    return m
  }
  const realUpdate = dbm.update
  const realRemoveFiles = dbm.removeFiles
  const removeCalls = []
  dbm.removeFiles = (ids) => {
    removeCalls.push(ids.slice())
    return realRemoveFiles(ids)
  }
  let failNext = true
  dbm.update = (...a) => {
    if (failNext) {
      failNext = false
      return Promise.reject(new Error('网络不好'))
    }
    return realUpdate(...a)
  }

  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  await tick(20)
  te.onReady()
  te.choosePhotos()
  te.choosePhotos()
  assert.strictEqual(te.data.form.photos.length, 2, '同一张不重复加')
  te.save()
  assert.strictEqual(te.data.saving, true)
  te.removePhoto(ev({ key: 'http://tmp/a.jpg' }))
  te.onDragEnd({ key: 'http://tmp/a.jpg', to: 1 })
  assert.deepStrictEqual(te.data.form.photos, ['http://tmp/a.jpg', 'http://tmp/b.png'], '保存中照片不能动')
  await tick(50)
  assert.strictEqual(te.data.saving, false, '失败后可以再点保存')
  assert.strictEqual(copies, 4, '两张原图 + 两张缩略图')
  te.save()
  await tick(50)
  assert.strictEqual(copies, 4, '重试不重复上传')
  const retried = peek('trips').find((t) => t._id === hz._id)
  assert.strictEqual(retried.photos.length, 2)
  assert.strictEqual(retried.thumbs.length, 2)
  const kept = new Set(retried.photos.concat(retried.thumbs.map((x) => x.t)))
  removeCalls.forEach((ids) => ids.forEach((id) => assert.ok(!kept.has(id), '存进去的文件不能删')))
  removeCalls.length = 0
  te.onUnload()
  assert.strictEqual(removeCalls.length, 0, '保存成功后离开不删')

  failNext = true
  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  await tick(20)
  te.onReady()
  te.choosePhotos()
  te.save()
  await tick(50)
  assert.strictEqual(te.data.saving, false)
  te.onUnload()
  await tick(30)
  assert.strictEqual(removeCalls.length, 1)
  assert.strictEqual(removeCalls[0].length, 4, '没保存就离开：这次传的两张原图和缩略图都删掉')

  // 云端其实存上了、只是回应丢了：离开时不能删（足迹已经在用这些照片）
  removeCalls.length = 0
  dbm.update = (...a) => realUpdate(...a).then(() => Promise.reject(new Error('回应丢了')))
  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  await tick(20)
  te.onReady()
  te.choosePhotos()
  te.save()
  await tick(50)
  assert.strictEqual(te.data.saving, false)
  te.onUnload()
  await tick(30)
  const lost = peek('trips').find((t) => t._id === hz._id)
  removeCalls.forEach((ids) => ids.forEach((id) => assert.ok(lost.photos.indexOf(id) < 0, '足迹在用的照片不能删')))
  assert.ok(lost.photos.some((p) => p.indexOf('wxfile://usr/photos/') === 0))

  // 保存途中离开：不能删照片，保存完成后也不能再多退一页
  removeCalls.length = 0
  dbm.update = realUpdate
  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  await tick(20)
  te.onReady()
  const backs = nav.filter((n) => n === 'navigateBack').length
  te.save()
  te.onUnload()
  assert.strictEqual(removeCalls.length, 0, '保存中离开不马上删')
  await tick(60)
  assert.strictEqual(removeCalls.flat().length, 0)
  assert.strictEqual(nav.filter((n) => n === 'navigateBack').length, backs, '已经离开的页面不再返回')

  // 打开编辑页时本机缓存是旧的：读取最新内容期间已经改了标题 -> 标题保留，照片换成最新的；没改过 -> 整页换成最新的
  const realGet = dbm.get
  const cachedHz = peek('trips').find((t) => t._id === hz._id)
  const newer = Object.assign({}, cachedHz, { updatedAt: (cachedHz.updatedAt || 0) + 1, note: '对方改的', photos: (cachedHz.photos || []).concat('wxfile://usr/photos/partner.jpg') })
  dbm.get = () => tick(10).then(() => newer)
  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  te.onInput(ev({ name: 'title' }, { value: '我刚改的标题' }))
  await tick(30)
  assert.strictEqual(te.data.form.title, '我刚改的标题', '已经改的文字不被覆盖')
  assert.ok(te.data.form.photos.indexOf('wxfile://usr/photos/partner.jpg') >= 0, '照片换成最新的')
  assert.deepStrictEqual(te.basePhotos, newer.photos)
  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  await tick(30)
  assert.strictEqual(te.data.form.note, '对方改的', '没改过就整页换成最新的')
  // 读不到最新的：保存前先补读一次，读到了才保存
  let gets = 0
  dbm.get = () => (gets++ === 0 ? Promise.reject(new Error('断网')) : Promise.resolve(newer))
  te = load('pages/trip-edit/index')
  te.onLoad({ id: hz._id })
  await tick(10)
  assert.strictEqual(te.stale, true)
  te.save()
  await tick(10)
  assert.strictEqual(gets, 2, '保存前补读了一次')
  assert.strictEqual(te.stale, false)
  dbm.get = realGet

  dbm.update = realUpdate
  dbm.removeFiles = realRemoveFiles
  wx.getFileSystemManager = realFsm
  console.log('ok  足迹：保存失败重试不重复上传、保存中锁定、离开时只清理没用上的照片、保存中离开不误删、读取最新内容时不覆盖已改的文字')

  // 旅行点评：复用心情选择器，自己写自己的
  const tdr = load('pages/trip-detail/index')
  tdr.onLoad({ id: hz._id })
  tdr.onShow()
  await tick(10)
  assert.strictEqual(tdr.data.reviews.length, 2)
  assert.strictEqual(tdr.data.reviews[0].mine, true)
  assert.strictEqual(tdr.data.reviews[0].has, false)
  tdr.tapReview(ev({ mine: false }))
  assert.strictEqual(tdr.data.sheet.show, false, '点对方的卡片不弹出')
  tdr.tapReview(ev({ mine: true }))
  assert.strictEqual(tdr.data.sheet.show, true)
  tdr.saveReview()
  assert.ok(toasts[toasts.length - 1].indexOf('心情') >= 0, '没选心情不能存')
  tdr.onReviewMood(ev({}, { key: 'great' }))
  tdr.onReviewText(ev({}, { value: '西湖边散步太舒服了' }))
  tdr.saveReview()
  await tick(40)
  const reviewed = peek('trips').find((t) => t._id === hz._id)
  assert.strictEqual(reviewed.reviews[R0].mood, 'great')
  assert.strictEqual(reviewed.reviews[R0].text, '西湖边散步太舒服了')
  assert.strictEqual(reviewed.place, '西湖', '写点评不影响足迹本身')
  assert.strictEqual(tdr.data.reviews[0].has, true)
  assert.strictEqual(tdr.data.reviews[0].label, '超开心')
  assert.strictEqual(tdr.data.sheet.show, false, '保存后收起')
  map.onShow()
  await tick(40)
  const hzCard = map.trips.find((t) => t._id === hz._id)
  assert.deepStrictEqual(hzCard.reviews, [{ role: R0, mood: 'great' }], '列表卡片显示点评心情')
  tdr.openReview()
  assert.strictEqual(tdr.data.sheet.mood, 'great', '再打开带出原来的点评')
  tdr.removeReview()
  await tick(40)
  assert.strictEqual((peek('trips').find((t) => t._id === hz._id).reviews || {})[R0], undefined)
  console.log('ok  旅行点评：选心情写点评、列表显示、再编辑、删除')

  // 5. 计划
  const pe = load('pages/plan-edit/index')
  pe.onLoad({ category: 'travel' })
  pe.onInput(ev({ name: 'title' }, { value: '去日本看樱花' }))
  pe.onNewItem(ev({}, { value: '订机票' }))
  pe.addItem()
  pe.onNewItem(ev({}, { value: '办签证' }))
  pe.addItem()
  pe.onNewItem(ev({}, { value: '做攻略' }))
  pe.save()
  await tick(5)
  const plan = peek('plans')[0]
  assert.strictEqual(plan.items.length, 3)

  const plans = load('pages/plans/index')
  plans.onLoad()
  plans.onShow()
  await tick(5)
  assert.strictEqual(plans.data.shown.length, 1)
  plans.toggleOpen(ev({ id: plan._id }))
  assert.strictEqual(plans.data.shown[0].open, true)
  for (const it of plan.items) {
    plans.toggleItem(ev({ id: plan._id, sid: it.id }))
    await tick(5)
  }
  await tick(900)
  assert.strictEqual(peek('plans')[0].done, true)
  assert.strictEqual(plans.data.shown.length, 0)
  plans.toggleShowDone()
  await tick(40)
  assert.strictEqual(plans.data.shown.length, 1)
  plans.toTrip(ev({ id: plan._id }))
  assert.ok(nav[nav.length - 1].indexOf('trip-edit/index?title=') > 0)
  console.log('ok  计划：子任务勾完自动完成并退场，旅行计划可转足迹')

  // 6. 点菜
  const menu = load('pages/menu/index')
  menu.onLoad()
  menu.onShow()
  await tick(20)
  assert.ok(menu.data.total >= 40, 'preset dishes seeded')
  const first = menu.data.groups[0].dishes[0]
  menu.inc(ev({ id: first._id, name: first.name }))
  menu.inc(ev({ id: first._id, name: first.name }))
  await tick(10)
  menu.dec(ev({ id: first._id, name: first.name }))
  await tick(10)
  assert.strictEqual(menu.data.order.count, 1)
  assert.strictEqual(menu.data.tabs[1].badge, 1)
  menu.toggleLearn(ev({ id: first._id, role: R1 }))
  await tick(5)
  menu.pickWho(ev({ key: R1 }))
  await tick(5)
  assert.strictEqual(menu.data.total, 1)
  menu.pickWho(ev({ key: 'all' }))
  await tick(5)
  menu.openRand()
  await tick(4000)
  assert.strictEqual(menu.data.rand.rolling, false)
  assert.ok(menu.data.rand.name)
  menu.takeRand()
  await tick(500)
  assert.strictEqual(menu.data.tab, 'today')
  assert.ok(menu.data.order.count >= 2)
  menu.confirmOrder()
  await tick(5)
  assert.strictEqual(peek('orders')[0].status, 'done')
  console.log(`ok  点菜：预设 ${menu.data.total} 道，加减菜 / 学会标记 / 随机抽到「${menu.data.rand.name}」/ 确认菜单`)

  const de = load('pages/dish-edit/index')
  de.onLoad({ category: 'staple' })
  de.onInput(ev({ name: 'name' }, { value: '土豆泥' }))
  de.toggleLearn(ev({ role: R0 }))
  de.choosePhoto()
  de.save()
  await tick(10)
  const mash = peek('dishes').find((d) => d.name === '土豆泥')
  assert.ok(mash && mash.learned[R0] && mash.photo.indexOf('wxfile://usr/photos/') === 0)
  console.log('ok  点菜：新增自定义菜品带照片')

  const orders = load('pages/orders/index')
  orders.onShow()
  await tick(5)
  assert.strictEqual(orders.data.list.length, 1)
  menu.clearOrder()
  await tick(5)
  assert.strictEqual(Object.keys(peek('orders')[0].items).length, 0)
  console.log('ok  历史菜单 / 清空今日菜单')

  // 6.5 首页封面：设置、更换（旧图要删）、移除
  home.editCover()
  await tick(20)
  const cover1 = app.globalData.couple.cover
  assert.ok(cover1 && cover1.indexOf('wxfile://usr/photos/') === 0, '封面已保存')
  assert.strictEqual(home.data.cover, cover1)
  home.onCoverLoad()
  assert.strictEqual(home.data.coverReady, true)
  global.__sheetPick = 0
  home.editCover()
  await tick(20)
  const cover2 = app.globalData.couple.cover
  assert.ok(cover2 && cover2 !== cover1, '封面已更换')
  assert.strictEqual(home.data.coverReady, false, '换图后重新淡入')
  global.__sheetPick = 1
  home.editCover()
  await tick(20)
  assert.strictEqual(app.globalData.couple.cover, '')
  assert.strictEqual(home.data.cover, '')
  console.log('ok  首页封面：设置 / 更换 / 移除')

  // 7. 首页统计
  home.onShow()
  await tick(600)
  assert.strictEqual(home.data.stats.provinces, 2)
  assert.strictEqual(home.data.stats.plansDone, 1)
  assert.strictEqual(home.data.stats.dishes, 2)
  console.log(`ok  首页统计：${JSON.stringify(home.data.stats)}`)

  // 7.5 相恋计时：可设几点开始，精确到秒
  const st2 = load('pages/settings/index')
  st2.onLoad({})
  await tick(5)
  st2.onTime(ev({}, { value: '20:30' }))
  await tick(10)
  assert.strictEqual(app.globalData.couple.togetherTime, '20:30')
  home.onShow()
  await tick(60)
  assert.ok(home.data.ticker && home.data.ticker.d >= 880, '计时器在走')
  assert.ok(/^\d\d$/.test(home.data.ticker.s))
  home.onHide()
  console.log(`ok  相恋计时：${home.data.ticker.d} 天 ${home.data.ticker.h}:${home.data.ticker.m}:${home.data.ticker.s}`)

  // 7.6 写心情：今天第一次写 +5，改写不重复加分
  const toastsBefore = toasts.length
  let de2 = load('pages/diary-edit/index')
  de2.onLoad({})
  await tick(10)
  de2.pickMood(ev({ key: 'great' }))
  de2.onText(ev({}, { value: '今天一起去看了海' }))
  de2.onEventInput(ev({}, { value: '看电影' }))
  de2.addEvent()
  de2.onEventInput(ev({}, { value: '吃火锅' }))
  de2.choosePhotos()
  de2.save()
  await tick(40)
  const diary = peek('diary')
  assert.strictEqual(diary.length, 1)
  assert.deepStrictEqual(diary[0].events, ['看电影', '吃火锅'], '没点添加的小事也存上')
  assert.strictEqual(diary[0].photos.length, 2)
  assert.ok(toasts.slice(toastsBefore).some((t) => /\+5 积分/.test(t)), '提示 +5 积分')
  de2 = load('pages/diary-edit/index')
  de2.onLoad({})
  await tick(20)
  assert.strictEqual(de2.data.id, diary[0]._id, '再进来是编辑自己那条')
  const t2 = toasts.length
  de2.onText(ev({}, { value: '改一下' }))
  de2.save()
  await tick(30)
  assert.ok(!toasts.slice(t2).some((t) => /积分/.test(t)), '改写不再加分')
  assert.strictEqual(peek('diary').length, 1)
  console.log('ok  写心情：今天 +5 积分，改写不重复加分，小事和照片都存上')

  // 7.6 照片地址：本机文件原样返回；云文件走云函数换链接（本机模式下不会有云文件）
  const files = require(path.join(ROOT, 'services', 'files.js'))
  const localPhoto = peek('diary')[0].photos[0]
  const m1 = await files.resolve([localPhoto, 'http://tmp/x.jpg'])
  assert.strictEqual(m1[localPhoto], localPhoto)
  assert.strictEqual(m1['http://tmp/x.jpg'], 'http://tmp/x.jpg')
  assert.strictEqual(files.peek('cloud://env/a.jpg'), '', '没换过的云文件先不显示')
  console.log('ok  照片地址：本机文件直接显示，云文件需要换链接')

  // 7.65 心情头像：有形象图（data/avatars.js）的人用自己的小人表情，缺的表情先用已有的顶上并加徽章；没有形象图的用心情图标
  const avatar = require(path.join(ROOT, 'utils', 'avatar.js'))
  const AVATARS = require(path.join(ROOT, 'data', 'avatars.js'))
  ;[R0, R1].forEach((r) => {
    const face = avatar.moodFace(r, 'sad')
    if (AVATARS[r]) {
      assert.ok(face.avatar.indexOf(`/assets/${r}/`) === 0, r + ' 有小人头像')
      assert.strictEqual(face.exact, !!AVATARS[r].sad)
    } else {
      assert.strictEqual(face.avatar, '', r + ' 没有形象图时用图标')
    }
  })
  assert.strictEqual(avatar.moodFace('someone', 'sad').avatar, '', '没有小人的角色用图标')
  // 往本地数据里放一条对方今天的心情，看首页是否两边都显示
  const todayStr = require(path.join(ROOT, 'utils', 'date.js')).today()
  storage[P + 'local:diary'].push({ _id: 'other-mood', date: todayStr, mood: 'sad', text: '', createdBy: R1, createdAt: Date.now() })
  home.onShow()
  await tick(60)
  home.onHide()
  assert.strictEqual(home.data.moods[0].mood, 'great', '我今天的心情')
  assert.strictEqual(home.data.moods[1].mood, 'sad', '对方今天的心情')
  assert.strictEqual(home.data.moods[1].avatar, !!AVATARS[R1])
  console.log(`ok  心情头像：${Object.keys(AVATARS).length ? '有形象图的用自己的小人表情' : '没有形象图时用心情图标'}，首页显示今天两人的心情`)

  // 7.7 日历和经期（日期都按今天倒推，测试哪天跑都一样）
  const date = require(path.join(ROOT, 'utils', 'date.js'))
  const T = date.today()
  const cal = load('pages/calendar/index')
  cal.onLoad()
  cal.onShow()
  await tick(30)
  assert.strictEqual(cal.data.cells.length, 42)
  const todayDots = cal.data.cells.find((c) => c.today).moods
  assert.strictEqual(todayDots.length, 2, '今天的格子有两个人的心情点')
  // 心情点按角色当 key：两个人心情一样（颜色一样）时 key 也不重复
  assert.deepStrictEqual(todayDots.map((x) => x.role), [R0, R1])
  assert.ok(todayDots.every((x) => /^#/.test(x.color)), '心情点带颜色')
  const pickDay = async (d) => {
    cal.setData({ selected: d, month: d.slice(0, 7) })
    cal.useCache()
    cal.render()
    await tick(5)
  }
  await pickDay(date.addDays(T, -29))
  assert.ok(cal.data.panel.period.canStart)
  cal.periodStart()
  await tick(20)
  await pickDay(date.addDays(T, -25))
  assert.ok(cal.data.panel.period.canEnd, '在经期里可以记结束')
  cal.periodEnd()
  await tick(20)
  await pickDay(date.addDays(T, -1))
  assert.ok(cal.data.panel.period.canStart)
  cal.periodStart()
  await tick(20)
  const periods = peek('periods')
  assert.strictEqual(periods.length, 2)
  await pickDay(T)
  const todayCell = cal.data.cells.find((c) => c.date === T)
  assert.strictEqual(todayCell.period, 'period', '进行中的经期铺到今天')
  assert.ok(/经期第 2 天/.test(cal.data.panel.period.text))
  await pickDay(date.addDays(T, 27))
  assert.ok(
    cal.data.cells.some((c) => c.date === date.addDays(T, 27) && c.period === 'predicted'),
    '下个周期标为预测'
  )
  home.onShow()
  await tick(40)
  home.onHide()
  assert.strictEqual(home.data.period.title, '经期第 2 天')
  console.log(`ok  经期：记开始和结束，首页显示「${home.data.period.title}」，日历标出预测（${home.data.period.foot}）`)

  // 7.7.1 日历标记：加一个跨天的出远门，改日期和类型，删掉；纪念日用各自的图标；爱心可以转成纪念日
  const cellOf = (d) => cal.data.cells.find((c) => c.date === d)
  const hasIcon = (d, icon) => cellOf(d).icons.some((x) => x.icon === icon)
  const D = (n) => date.addDays(T, n)
  await pickDay(D(3))
  assert.strictEqual(cal.data.panel.marks.length, 0)
  cal.newMark()
  assert.strictEqual(cal.data.mark.show, true)
  assert.strictEqual(cal.data.mark.start, D(3), '默认从选中的那天开始')
  assert.strictEqual(cal.data.mark.type, 'trip')
  cal.onMarkEnd(ev({}, { value: D(1) }))
  assert.strictEqual(cal.data.mark.end, D(3), '结束不会早于开始')
  cal.onMarkEnd(ev({}, { value: D(103) }))
  cal.saveMark()
  await tick(20)
  assert.strictEqual(toasts[toasts.length - 1], '一个标记最多跨 90 天')
  assert.strictEqual(cal.data.mark.show, true, '超过 90 天不保存')
  toasts.pop()
  cal.onMarkEnd(ev({}, { value: D(6) }))
  assert.strictEqual(cal.data.mark.days, 4)
  cal.onMarkTitle(ev({}, { value: ' 去三亚 ' }))
  cal.saveMark()
  await tick(20)
  assert.strictEqual(cal.data.mark.show, false)
  assert.ok([3, 4, 5, 6].every((n) => hasIcon(D(n), 'plane')), '跨天的每一天都有飞机')
  assert.ok(!hasIcon(D(7), 'plane'))
  assert.deepStrictEqual(cal.data.panel.marks.map((m) => [m.text, m.range]), [['去三亚', '第 1/4 天']])

  // 改：开始日往后挪一天，天数不变整体平移；换成回家
  cal.editMark(ev({ id: cal.data.panel.marks[0].id }))
  assert.strictEqual(cal.data.mark.title, '去三亚')
  assert.strictEqual(cal.data.mark.days, 4)
  cal.onMarkStart(ev({}, { value: D(4) }))
  assert.strictEqual(cal.data.mark.end, D(7))
  cal.pickType(ev({ key: 'home' }))
  assert.strictEqual(cal.data.mark.hint, '比如 回老家过节')
  cal.saveMark()
  await tick(20)
  assert.ok(!hasIcon(D(3), 'house') && !hasIcon(D(3), 'plane'), '原来第一天空出来了')
  assert.ok([4, 5, 6, 7].every((n) => hasIcon(D(n), 'house')))
  assert.strictEqual(peek('marks').length, 1)

  // 同一天三种以上：格子只放两个图标，多出来的露一个点，详情里列全
  await pickDay(D(5))
  for (const type of ['love', 'show']) {
    cal.newMark()
    cal.pickType(ev({ key: type }))
    cal.saveMark()
    await tick(20)
  }
  assert.strictEqual(cellOf(D(5)).icons.length, 2)
  assert.strictEqual(cellOf(D(5)).more, true)
  assert.deepStrictEqual(cal.data.panel.marks.map((m) => m.text), ['去三亚', '纪念日', '电影演出'], '没写字的显示类型名')

  // 删：确认后格子上的图标跟着消失
  for (const m of cal.data.panel.marks.slice()) {
    cal.editMark(ev({ id: m.id }))
    cal.removeMark()
    await tick(20)
  }
  assert.strictEqual(peek('marks').length, 0)
  assert.ok([4, 5, 6, 7].every((n) => !cellOf(D(n)).icons.some((x) => x.icon === 'house')))

  // 纪念日：在一起是爱心（设置里的日期，不能点进去改），生日是蛋糕（点进去编辑）
  await pickDay(date.nextOccurrence({ date: '2024-05-20', repeat: true }, T).date)
  const together = cal.data.panel.anns.find((a) => a.title === '在一起纪念日')
  assert.deepStrictEqual([together.icon, together.id], ['heart', ''])
  assert.ok(hasIcon(cal.data.selected, 'heart'))
  const navCount = nav.length
  cal.openAnn(ev({ id: '' }))
  assert.strictEqual(nav.length, navCount, '在一起纪念日不跳')
  let bae = load('pages/anniversary-edit/index')
  bae.onLoad({})
  bae.onTitle(ev({}, { value: '妈妈生日' }))
  bae.pickKind(ev({ key: 'birthday' }))
  bae.onDate(ev({}, { value: D(12) }))
  bae.save()
  await tick(5)
  const bday = peek('anniversaries').find((a) => a.title === '妈妈生日')
  await pickDay(D(12))
  assert.ok(cal.data.panel.anns.some((a) => a.title === '妈妈生日' && a.icon === 'cake'), '生日是蛋糕')
  assert.ok(hasIcon(D(12), 'cake'))
  cal.openAnn(ev({ id: bday._id }))
  assert.strictEqual(nav[nav.length - 1], `navigateTo /pages/anniversary-edit/index?id=${bday._id}`)
  bae = load('pages/anniversary-edit/index')
  bae.onLoad({ id: bday._id })
  bae.remove()
  await tick(5)

  // 爱心想每年都记得：带着日期和名字去新建纪念日
  await pickDay(D(10))
  cal.newMark()
  cal.pickType(ev({ key: 'love' }))
  cal.onMarkTitle(ev({}, { value: '第一次牵手' }))
  cal.markToAnniversary()
  assert.strictEqual(cal.data.mark.show, false)
  const toAnn = nav[nav.length - 1]
  assert.strictEqual(toAnn, `navigateTo /pages/anniversary-edit/index?date=${D(10)}&title=${encodeURIComponent('第一次牵手')}`)
  const q = {}
  toAnn.split('?')[1].split('&').forEach((kv) => {
    const [k, v] = kv.split('=')
    q[k] = v
  })
  const ae2 = load('pages/anniversary-edit/index')
  ae2.onLoad(q)
  assert.strictEqual(ae2.data.form.title, '第一次牵手')
  assert.strictEqual(ae2.data.form.date, D(10))
  ae2.onLoad({ date: D(10), title: '第一次牵手' })
  assert.strictEqual(ae2.data.form.title, '第一次牵手', '微信已经解码过的参数也认')
  assert.strictEqual(peek('marks').length, 0, '转纪念日不另存标记')
  console.log('ok  日历标记：跨天出远门、改日期和类型、多个时格子露点、删除，纪念日显示各自图标，爱心转成纪念日')

  // 7.8 任务：本机只有一个身份，发给对方后自己直接确认
  const te2 = load('pages/task-edit/index')
  te2.onLoad({})
  te2.onInput(ev({ name: 'title' }, { value: '按摩 20 分钟' }))
  te2.pickPoints(ev({ v: 20 }))
  te2.onFav(ev({}, { value: true }))
  te2.save()
  await tick(20)
  let tasks = peek('tasks')
  assert.strictEqual(tasks.length, 1)
  assert.strictEqual(tasks[0].assignee, R1)
  assert.strictEqual(tasks[0].status, 'open')
  const plans2 = load('pages/plans/index')
  plans2.onLoad()
  plans2.onShow()
  await tick(30)
  plans2.onMode(ev({}, { key: 'tasks' }))
  assert.strictEqual(plans2.data.tasks.waiting.length, 1)
  assert.strictEqual(plans2.data.tasks.favs.length, 1)
  const otherBefore = (storage[P + 'local:couple'][0].points || {})[R1] || 0
  plans2.confirmTask(ev({ id: tasks[0]._id, group: 'waiting' }))
  await tick(450)
  assert.strictEqual(plans2.data.tasks.done.length, 1)
  assert.strictEqual(storage[P + 'local:couple'][0].points[R1], otherBefore + 20, '确认后对方得分')
  plans2.republish(ev({ id: tasks[0]._id }))
  await tick(30)
  assert.strictEqual(peek('tasks').length, 2, '常用任务一键再发')
  console.log('ok  任务：发布、收藏、确认后对方 +20、一键再发')

  // 7.9 积分页
  const pts = load('pages/points/index')
  pts.onShow()
  await tick(40)
  assert.ok(pts.data.ledger.length >= 5, '积分明细')
  pts.openNew()
  pts.onSheetInput(ev({ name: 'title' }, { value: '请吃一顿火锅' }))
  pts.pickCost(ev({ v: 100 }))
  pts.saveReward()
  await tick(30)
  assert.strictEqual(pts.data.mine.length, 1)
  assert.strictEqual(pts.data.mine[0].cost, 100)
  console.log(`ok  积分页：我 ${pts.data.balance.me} 分、对方 ${pts.data.balance.other} 分，${pts.data.ledger.length} 条明细，上架奖励`)

  // 7.9 首页秒开：启动时先用本机存的身份和情侣信息，首页不等云端；第一次显示不重复拉身份
  const BOOT_KEY = P + 'boot-v1'
  assert.strictEqual(storage[BOOT_KEY].me, R0, '身份存到本机')
  assert.ok(storage[BOOT_KEY].couple.togetherSince, '情侣信息存到本机')
  const server = require(path.join(ROOT, 'services', 'server.js'))
  const realMain = server.main
  const calls = []
  let slow = 0
  server.main = (e) => {
    calls.push(e.action)
    return tick(slow).then(() => realMain(e))
  }
  const firstApp = appCfg
  const relaunch = () => {
    delete require.cache[require.resolve(path.join(ROOT, 'app.js'))]
    require(path.join(ROOT, 'app.js'))
    return appCfg
  }
  const countBoot = () => calls.filter((a) => a === 'bootstrap').length
  calls.length = 0
  slow = 300
  let relaunched = relaunch()
  assert.strictEqual(relaunched.globalData.me, R0, '启动时马上有身份')
  let h = load('pages/home/index')
  h.onShow()
  assert.strictEqual(h.data.ready, true, '有本机数据：首页马上显示')
  assert.strictEqual(h.data.loader, '', '有本机数据不出加载页')
  assert.ok(h.data.together.days > 800)
  await tick(700)
  assert.strictEqual(countBoot(), 1, '第一次显示直接用启动时的身份请求')
  h.onHide()
  h.onShow()
  await tick(450)
  assert.strictEqual(countBoot(), 2, '再回到首页刷新一次身份和积分')
  h.onHide()
  console.log('ok  首页秒开：本机有数据时不等云端，第一次显示不重复拉身份')

  // 本机什么都没有（第一次装、清了缓存）且网络慢：200ms 后出加载页，至少停 600ms，数据到了淡出、内容露出来
  Object.keys(storage)
    .filter((k) => k.indexOf(P + 'cache:') === 0 || k === BOOT_KEY)
    .forEach((k) => delete storage[k])
  calls.length = 0
  slow = 500
  relaunched = relaunch()
  assert.strictEqual(relaunched.globalData.couple, null, '本机没存过就等云端')
  h = load('pages/home/index')
  h.onShow()
  assert.strictEqual(h.data.ready, false)
  await tick(100)
  assert.strictEqual(h.data.loader, '', '200ms 内不出加载页，快的话不闪')
  await tick(200)
  assert.strictEqual(h.data.loader, 'on', '等久了出加载页')
  await tick(350)
  assert.strictEqual(h.data.ready, false, '加载页至少停一会儿')
  await tick(300)
  assert.strictEqual(h.data.ready, true, '数据到了内容露出来')
  assert.strictEqual(h.data.loader, 'off', '加载页正在淡出')
  assert.ok(h.data.together.days > 800)
  await tick(500)
  assert.strictEqual(h.data.loader, '', '淡出后移除加载页')
  assert.strictEqual(storage[BOOT_KEY].me, R0, '云端回来后存到本机，下次秒开')
  assert.strictEqual(countBoot(), 1)
  h.onHide()
  console.log('ok  加载页：网络慢时出现，至少停 600ms，数据到了淡出')

  // 切换功能不震动；其他按钮照常
  let buzz = 0
  const realVibrate = wx.vibrateShort
  wx.vibrateShort = () => {
    buzz += 1
  }
  require(path.join(ROOT, 'custom-tab-bar', 'index.js'))
  compCfg.methods.go.call({ data: { selected: 0 } }, ev({ index: 2 }))
  assert.strictEqual(nav[nav.length - 1], 'switchTab /pages/map/index')
  h.goTab(ev({ index: 3 }))
  h.goCalendar()
  assert.strictEqual(nav[nav.length - 1], 'switchTab /pages/calendar/index')
  assert.strictEqual(buzz, 0, '底栏切换、首页跳到别的功能都不震动')
  h.goSettings()
  assert.strictEqual(buzz, 1, '普通按钮照常震动')
  wx.vibrateShort = realVibrate
  console.log('ok  切换功能不震动')

  server.main = realMain
  appCfg = firstApp

  // 下拉刷新（自定义，露出加载动画）：下拉就挂上动图；松手刷新，至少停 800ms 再收起；收回后摘掉动图；没拉到位松手不刷新
  home.onRefresherPulling()
  assert.strictEqual(home.data.pulling, true, '下拉时挂上动图')
  home.onRefresherRefresh()
  assert.strictEqual(home.data.refreshing, true)
  await tick(300)
  assert.strictEqual(home.data.refreshing, true, '数据回来了也至少停 800ms')
  await tick(700)
  assert.strictEqual(home.data.refreshing, false, '刷新完收起')
  home.onRefresherDone()
  assert.strictEqual(home.data.pulling, true, '收回动画放完前动图还在')
  await tick(350)
  assert.strictEqual(home.data.pulling, false, '收回后摘掉动图')
  home.onRefresherPulling()
  home.onRefresherDone()
  await tick(350)
  assert.strictEqual(home.data.pulling, false)
  assert.strictEqual(home.data.refreshing, false, '没拉到位不刷新')
  console.log('ok  下拉刷新：露出加载动画，至少停 800ms，收回后摘掉动图')

  // 微信通知：设置页显示每类还能收几条；点「开启通知」三类一起请求；
  // 切换功能时只给勾了「总是保持」、条数不多的那几类续上（不会弹窗）；关掉总开关就提示去打开
  // dbm 就是上面的 services/db.js
  const notifyM = require(path.join(ROOT, 'services', 'notify.js'))
  const realSubscribe = dbm.subscribe
  const asked = []
  const setting = { mainSwitch: true, itemSettings: {} }
  dbm.isCloud = true
  dbm.subscribe = (kinds) => {
    const n = clone(app.globalData.couple.notify)
    kinds.forEach((k) => {
      n.subs[app.globalData.me][k] += 1
    })
    return Promise.resolve(n)
  }
  wx.getSetting = (o) => {
    o.success({ subscriptionsSetting: clone(setting) })
    o.complete()
  }
  wx.requestSubscribeMessage = (o) => {
    asked.push(o.tmplIds)
    const res = {}
    o.tmplIds.forEach((id) => {
      res[id] = 'accept'
    })
    o.success(res)
  }
  const meRole = app.globalData.me
  const otherRole = meRole === R0 ? R1 : R0
  const ids = [{ kind: 'order', id: 'T1' }, { kind: 'task', id: 'T2' }, { kind: 'remind', id: 'T3' }]
  const subsWith = (mine) => ({ [meRole]: mine, [otherRole]: { order: 2, task: 2, remind: 2 } })
  app.setCouple({ notify: { ids, subs: subsWith({ order: 0, task: 0, remind: 0 }) } })
  const ns = load('pages/settings/index')
  ns.onLoad({})
  ns.onShow()
  await tick(5)
  assert.ok(ns.data.notify && !ns.data.notify.on)
  assert.deepStrictEqual(ns.data.notify.counts.map((c) => `${c.text}${c.n}`), ['点菜0', '任务0', '提醒0'])
  assert.strictEqual(ns.data.notify.otherOn, true)
  notifyM.topUp()
  assert.strictEqual(asked.length, 0, '没勾总是允许：切换功能不请求，免得突然弹窗')
  ns.askNotify()
  await tick(5)
  assert.deepStrictEqual(asked[0], ['T1', 'T2', 'T3'])
  assert.deepStrictEqual(ns.data.notify.counts.map((c) => c.n), [1, 1, 1])
  assert.strictEqual(ns.data.notify.on, true)
  setting.itemSettings = { T1: 'accept', T2: 'accept' }
  await notifyM.refresh()
  compCfg.methods.go.call({ data: { selected: 0 } }, ev({ index: 1 }))
  await tick(5)
  assert.deepStrictEqual(asked[1], ['T1', 'T2'], '切换功能只续勾了总是允许的那几类')
  assert.deepStrictEqual(notifyM.state().counts.map((c) => c.n), [2, 2, 1])
  app.setCouple({ notify: { ids, subs: subsWith({ order: notifyM.LOW, task: notifyM.LOW, remind: 1 }) } })
  notifyM.topUp()
  await tick(5)
  assert.strictEqual(asked.length, 2, '条数够多了不再请求')
  setting.mainSwitch = false
  await notifyM.refresh()
  app.setCouple({ notify: { ids, subs: subsWith({ order: 0, task: 0, remind: 0 }) } })
  notifyM.topUp()
  assert.strictEqual(asked.length, 2, '关掉了总开关不请求')
  ns.onShow()
  await tick(5)
  assert.strictEqual(ns.data.notify.blocked, true)
  dbm.isCloud = false
  dbm.subscribe = realSubscribe
  delete wx.getSetting
  delete wx.requestSubscribeMessage
  await notifyM.refresh()
  ns.onShow()
  await tick(5)
  assert.strictEqual(ns.data.notify, null, '本机模式不显示通知')
  console.log('ok  微信通知：开启、显示条数、切换功能时只给总是允许的续上、关掉了提示去打开')

  // 8. 解除身份
  const st = load('pages/settings/index')
  st.onLoad({})
  await tick(5)
  st.unbind()
  await tick(5)
  assert.strictEqual(app.globalData.me, null)
  console.log('ok  解除身份')

  const unexpected = toasts.filter((t) => t !== '已设为封面')
  if (unexpected.length) console.log('提示信息：', unexpected)
  console.log('\n全部通过')
  // 首页计时器用了 setInterval，主动退出
  process.exit(0)
}

main().catch((e) => {
  console.error('\n失败：', e)
  process.exit(1)
})
