// 微信通知（订阅消息）：对方点菜、派任务、纪念日快到时，微信里通知你
// 一次性订阅：每点一次「允许」，那类通知只能多收一条，云函数记着每人每类还剩几条
// 弹窗里勾了「总是保持以上选择」之后，再请求就不弹窗、直接算允许；
// 所以切换功能这种常用的点击里顺手请求一次把条数攒起来（只请求已经总是允许的模板，不会突然弹窗）
// 注意：wx.requestSubscribeMessage 只能在点击事件里同步调用，前面不能有 await
const db = require('./db')

const LOW = 10 // 某类剩余少于这么多条才顺手补
let always = {} // 模板 id → 'accept' | 'reject' | 'ban'，只有勾了「总是保持」的模板才有
let mainOn = true // 微信设置里「接收通知」总开关
let topping = false

function info() {
  // App() 注册过程中（onLaunch、第一次 onShow）getApp() 还拿不到实例，这时当作还没有数据
  const app = getApp()
  const g = (app && app.globalData) || {}
  const n = (g.couple && g.couple.notify) || { ids: [], subs: {} }
  return { me: g.me, ids: n.ids || [], subs: n.subs || {} }
}

function left(subs, me, kind) {
  return (subs[me] && subs[me][kind]) || 0
}

// 读微信设置里的订阅状态（启动、回到前台、打开设置页时刷新）
function refresh() {
  return new Promise((resolve) => {
    if (!db.isCloud || !wx.getSetting) return resolve(state())
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const s = res.subscriptionsSetting || {}
        mainOn = s.mainSwitch !== false
        always = s.itemSettings || {}
      },
      complete: () => resolve(state())
    })
  })
}

// 设置页显示用
// ready：配置好了模板；on：每类都还有剩余；auto：每类都勾了总是允许；blocked：关掉了总开关或拒收了某类
function state() {
  const { me, ids, subs } = info()
  const ready = db.isCloud && !!me && ids.length > 0
  const counts = ids.map((x) => ({ kind: x.kind, n: left(subs, me, x.kind) }))
  return {
    ready,
    counts,
    on: ready && counts.every((c) => c.n > 0),
    auto: ready && mainOn && ids.every((x) => always[x.id] === 'accept'),
    blocked: ready && (!mainOn || ids.some((x) => always[x.id] === 'reject' || always[x.id] === 'ban'))
  }
}

// 把允许了的几类报给云函数，拿回最新条数
function report(ids, res) {
  const kinds = ids.filter((x) => res[x.id] === 'accept').map((x) => x.kind)
  if (!kinds.length) return Promise.resolve(null)
  return db.subscribe(kinds).then((notify) => {
    getApp().setCouple({ notify })
    return notify
  })
}

// 「开启通知」按钮：会弹窗，一次最多 3 个模板
function ask() {
  const { ids } = info()
  const list = ids.slice(0, 3)
  return new Promise((resolve, reject) => {
    if (!list.length) return resolve(null)
    wx.requestSubscribeMessage({
      tmplIds: list.map((x) => x.id),
      success: (res) => report(list, res).then(resolve, reject),
      fail: reject
    })
  }).then((r) => refresh().then(() => r))
}

// 常用点击里调用：只请求勾了总是允许、而且剩余不多的那几类，不会弹窗
function topUp() {
  if (topping || !db.isCloud || !mainOn || !wx.requestSubscribeMessage) return
  const { me, ids, subs } = info()
  if (!me) return
  const list = ids.filter((x) => always[x.id] === 'accept' && left(subs, me, x.kind) < LOW).slice(0, 3)
  if (!list.length) return
  topping = true
  wx.requestSubscribeMessage({
    tmplIds: list.map((x) => x.id),
    success: (res) => {
      report(list, res)
        .catch(() => null)
        .then(() => {
          topping = false
        })
    },
    fail: () => {
      topping = false
    }
  })
}

// 「发一条试试」：用掉自己一条提醒
function test() {
  return db.notifyTest('remind').then((notify) => {
    getApp().setCouple({ notify })
    return notify
  })
}

module.exports = { refresh, state, ask, topUp, test, LOW }
