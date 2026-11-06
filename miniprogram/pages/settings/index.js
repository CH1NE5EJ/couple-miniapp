const db = require('../../services/db')
const notify = require('../../services/notify')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const config = require('../../config')
const R = require('../../utils/roles')

const app = getApp()
const KIND_TEXT = { order: '点菜', task: '任务', remind: '提醒' }

Page({
  data: {
    setup: false,
    me: null,
    names: R.defaultNames,
    whoList: [],
    togetherSince: '',
    togetherTime: '',
    sinceText: '',
    today: '',
    isCloud: db.isCloud,
    envId: config.envId,
    busy: false,
    error: '',
    notify: null,
    notifyBusy: false
  },

  onLoad(q) {
    const setup = !!q.setup
    this.setData({ setup, today: date.today() })
    wx.setNavigationBarTitle({ title: setup ? '欢迎' : '设置' })
    if (setup && wx.hideHomeButton) wx.hideHomeButton()
    this.load()
  },

  // 从微信设置页回来时通知开关可能变了
  onShow() {
    notify.refresh().then(() => this.showNotify())
  },

  onUnload() {
    app.setupOpen = false
  },

  load() {
    app
      .ready()
      .then((res) => this.apply(res))
      .catch((e) => this.setData({ error: e.message || '连接不上云端' }))
  },

  retry() {
    this.setData({ error: '' })
    app.boot().then(
      (res) => this.apply(res),
      (e) => this.setData({ error: e.message || '连接不上云端' })
    )
  },

  apply({ me, couple }) {
    const names = couple.names || R.defaultNames
    const roles = couple.roles || []
    this.setData({
      me,
      names,
      error: '',
      togetherSince: couple.togetherSince || '',
      togetherTime: couple.togetherTime || '',
      sinceText: couple.togetherSince ? date.ymd(couple.togetherSince) : '',
      whoList: R.ROLES.map((role) => ({
        role,
        name: names[role],
        // 称呼输入框的标签用默认称呼
        label: R.defaultNames[role],
        initial: String(names[role] || role).slice(0, 1).toUpperCase(),
        taken: roles.indexOf(role) >= 0 && role !== me
      }))
    })
    this.showNotify()
  },

  // 通知卡片：每类还能收几条、对方开没开
  showNotify() {
    const s = notify.state()
    if (!s.ready) {
      if (this.data.notify) this.setData({ notify: null })
      return
    }
    const g = app.globalData
    const other = R.other(R.meOr(g.me))
    const subs = (g.couple.notify && g.couple.notify.subs && g.couple.notify.subs[other]) || {}
    const some = s.counts.some((c) => c.n > 0)
    let title = '还没开启'
    let hint = '每点一次「允许」，每类多收一条。弹窗里勾选「总是保持以上选择」，以后切换功能时会自动续上'
    if (s.blocked) {
      title = '通知被关掉了'
      hint = '你在微信里关掉了通知，或者拒收了其中一类'
    } else if (s.on) {
      title = s.auto ? '已开启，会自动续上' : '已开启'
      hint = s.auto ? '条数快用完时，切换功能会自动续上，不用再点' : '下次点的时候勾选「总是保持以上选择」，以后就会自动续上'
    } else if (some) {
      title = '有一类用完了'
      hint = '用完的那类收不到通知，点下面续上。勾选「总是保持以上选择」以后会自动续上'
    }
    const remind = s.counts.find((c) => c.kind === 'remind')
    this.setData({
      notify: {
        on: s.on,
        some,
        auto: s.auto,
        blocked: s.blocked,
        title,
        canTest: !!remind && remind.n > 0,
        hint,
        counts: s.counts.map((c) => ({ kind: c.kind, text: KIND_TEXT[c.kind] || c.kind, n: c.n })),
        otherName: app.names()[other],
        otherOn: s.counts.every((c) => subs[c.kind] > 0)
      }
    })
  },

  // 必须在点击里直接调起订阅弹窗，前面不能有异步操作
  askNotify() {
    if (this.data.notifyBusy) return
    this.setData({ notifyBusy: true })
    notify
      .ask()
      .then((r) => {
        ui.tick()
        ui.toast(r ? '好了，有事会在微信里通知你' : '这次没有允许')
      })
      .catch((err) => ui.fail(err, '没能开启通知'))
      .then(() => {
        this.setData({ notifyBusy: false })
        this.showNotify()
      })
  },

  openNotifySetting() {
    wx.openSetting({ withSubscriptions: true })
  },

  testNotify() {
    if (this.data.notifyBusy) return
    this.setData({ notifyBusy: true })
    notify
      .test()
      .then(() => ui.toast('发出去了，看看微信'))
      .catch((err) => ui.fail(err))
      .then(() => {
        this.setData({ notifyBusy: false })
        this.showNotify()
      })
  },

  pickRole(e) {
    const { role } = e.currentTarget.dataset
    if (role === this.data.me || this.data.busy) return
    const item = this.data.whoList.find((x) => x.role === role)
    if (item && item.taken) return ui.toast('这个身份已经被对方绑定了')
    ui.tick('medium')
    this.setData({ busy: true })
    db.bind(role)
      .then((res) => {
        app.globalData.me = res.me
        app.setCouple(res.couple)
        this.apply({ me: res.me, couple: app.globalData.couple })
      })
      .catch((err) => ui.fail(err))
      .then(() => this.setData({ busy: false }))
  },

  onSince(e) {
    const v = e.detail.value
    this.setData({ togetherSince: v, sinceText: date.ymd(v) })
    this.save({ togetherSince: v })
  },

  onTime(e) {
    this.setData({ togetherTime: e.detail.value })
    this.save({ togetherTime: e.detail.value })
  },

  clearTime() {
    this.setData({ togetherTime: '' })
    this.save({ togetherTime: '' })
  },

  onName(e) {
    const { role } = e.currentTarget.dataset
    const v = String(e.detail.value || '').trim()
    if (!v || v === this.data.names[role]) return
    this.save({ names: Object.assign({}, this.data.names, { [role]: v }) })
  },

  save(patch) {
    if (!this.data.me) return ui.toast('先选择你是谁')
    db.saveCouple(patch)
      .then((c) => {
        app.setCouple(c)
        this.apply({ me: this.data.me, couple: app.globalData.couple })
        ui.tick()
      })
      .catch((err) => ui.fail(err))
  },

  start() {
    if (!this.data.me) return ui.toast('先选择你是谁')
    ui.tick('medium')
    wx.switchTab({ url: '/pages/home/index' })
  },

  unbind() {
    ui.confirm('解除身份', '解除后这台微信需要重新选择身份，数据不会删除', '解除').then((ok) => {
      if (!ok) return
      db.unbind()
        .then((res) => {
          app.globalData.me = null
          app.setCouple(res.couple)
          this.apply({ me: null, couple: app.globalData.couple })
          this.setData({ setup: true })
        })
        .catch((err) => ui.fail(err))
    })
  }
})
