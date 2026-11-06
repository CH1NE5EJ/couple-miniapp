const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const files = require('../../services/files')
const period = require('../../utils/period')
const { hasAvatar } = require('../../utils/avatar')
const { MOOD } = require('../../data/points')
const refresh = require('../../behaviors/refresh')
const roles = require('../../utils/roles')

const app = getApp()

// 没有本地数据、只能等云端时：等一小会儿还没好才出加载页（快的话不闪一下），出来了至少停一会儿再退
const LOADER_DELAY = 200
const LOADER_MIN = 600
const LOADER_OUT = 420

const KINDS = {
  love: { icon: 'heart', label: '恋爱' },
  birthday: { icon: 'cake', label: '生日' },
  festival: { icon: 'gift', label: '节日' },
  other: { icon: 'flag', label: '其他' }
}

Page({
  behaviors: [refresh],

  data: {
    names: app.names(),
    roles: roles.ROLES,
    together: null,
    daysShown: 0,
    milestone: null,
    list: [],
    loaded: false,
    stats: { provinces: 0, plans: 0, plansDone: 0, dishes: 0 },
    ticker: null,
    points: null,
    period: null,
    cover: '',
    coverReady: false,
    coverBusy: false,
    error: '',
    // 页面内容是否已经露出来；loader：'' 没有加载页，'on' 显示中，'off' 正在退出
    ready: false,
    loader: ''
  },

  onShow() {
    ui.showTab(this, 0)
    this.startTicker()
    const cached = db.peek('anniversaries')
    if (cached && app.globalData.couple) this.render(cached)
    else this.waitLoader()
    this.statsFromCache()
    // 第一次显示直接用启动时那次身份请求；之后每次回到首页再刷新一次（积分、封面可能被对方改了）
    if (this.shown) app.boot().catch(() => null)
    this.shown = true
    // 数据和身份同时拉，不等身份回来再发，省一轮往返；还没选身份时这些请求会被拒绝，结果不用
    const t = date.today()
    const lists = Promise.all([
      db.list('anniversaries'),
      db.list('periods'),
      db.list('diary', { range: { field: 'date', from: t, to: t } })
    ])
    lists.catch(() => null)
    // 每次启动拉一次其他三项，统计数字才准
    if (!app.statsLoaded) {
      app.statsLoaded = true
      Promise.all(['trips', 'plans', 'dishes'].map((c) => db.list(c)))
        .then(() => this.statsFromCache())
        .catch(() => {
          app.statsLoaded = false
        })
    }
    app
      .requireMember()
      .then((res) => {
        if (!res) return
        return lists.then(([list]) => {
          this.setData({ error: '' })
          this.render(list)
        })
      })
      .catch((e) => {
        this.setData({ error: e.message || '连接不上云端' })
        this.reveal()
      })
  },

  onHide() {
    this.stopTicker()
  },

  onUnload() {
    this.stopTicker()
    clearTimeout(this.loaderTimer)
  },

  // ---------- 加载页 ----------
  waitLoader() {
    if (this.data.ready || this.data.loader || this.loaderTimer) return
    this.loaderTimer = setTimeout(() => {
      this.loaderTimer = null
      if (this.data.ready) return
      this.loaderAt = Date.now()
      this.setData({ loader: 'on' })
    }, LOADER_DELAY)
  },

  // 内容露出来：加载页还没出来就直接显示；已经出来了停够 LOADER_MIN 再淡出，内容同时进场
  reveal() {
    if (this.data.ready) return
    clearTimeout(this.loaderTimer)
    this.loaderTimer = null
    if (this.data.loader !== 'on') return this.setData({ ready: true }, () => this.countDays())
    if (this.revealing) return
    this.revealing = true
    setTimeout(() => {
      this.revealing = false
      this.setData({ ready: true, loader: 'off' }, () => this.countDays())
      setTimeout(() => this.setData({ loader: '' }), LOADER_OUT)
    }, Math.max(0, LOADER_MIN - (Date.now() - this.loaderAt)))
  },

  // 天数从上次的值滚到现在的值，第一次从 0 开始；内容还没露出来时先不滚，同一个目标值只滚一次
  countDays() {
    const together = this.data.together
    if (!this.data.ready || !together || together.days === this.data.daysShown || this.countTo === together.days) return
    this.countTo = together.days
    const from = this.data.daysShown
    ui.countUp(from, together.days, from ? 400 : 1100, (v) => this.setData({ daysShown: v }))
  },

  // 相恋计时：每秒走一次，只更新这一小块数据
  startTicker() {
    this.stopTicker()
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    const step = () => {
      const c = app.globalData.couple || {}
      if (!c.togetherSince) {
        if (this.data.ticker) this.setData({ ticker: null })
        return
      }
      const start = date.parse(c.togetherSince)
      const hm = (c.togetherTime || '00:00').split(':').map(Number)
      start.setHours(hm[0] || 0, hm[1] || 0, 0, 0)
      const ms = Math.max(0, Date.now() - start.getTime())
      this.setData({
        ticker: {
          d: Math.floor(ms / 86400000),
          h: pad(Math.floor(ms / 3600000) % 24),
          m: pad(Math.floor(ms / 60000) % 60),
          s: pad(Math.floor(ms / 1000) % 60)
        }
      })
    }
    step()
    this.tickTimer = setInterval(step, 1000)
  },

  stopTicker() {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = null
  },

  onPullDownRefresh() {
    app
      .boot()
      .then(() => Promise.all(['anniversaries', 'trips', 'plans', 'dishes', 'periods'].map((c) => db.list(c))))
      .then(([anns]) => {
        this.render(anns)
        this.statsFromCache()
      })
      .catch((e) => ui.fail(e))
      .then(() => this.stopRefresh())
  },

  render(anns) {
    const couple = app.globalData.couple || {}
    const names = app.names()
    const t = date.today()
    const since = couple.togetherSince

    const items = anns.map((a) => this.toItem(a, t))
    if (since) {
      items.push(
        this.toItem({ _id: 'together', title: '在一起纪念日', kind: 'love', date: since, repeat: true, virtual: true }, t)
      )
    }
    items.sort((a, b) => a.order - b.order)

    let milestone = null
    if (since) {
      const m = date.nextMilestone(since, t)
      if (m) milestone = Object.assign(m, { dateText: `${date.dotted(m.date)} ${date.weekday(m.date)}` })
    }

    const together = since
      ? { days: date.dayCount(since, t), sinceText: date.dotted(since) + (couple.togetherTime ? ' ' + couple.togetherTime : '') }
      : null
    const [me, other] = roles.pair(app.globalData.me)
    const pts = couple.points || {}
    const points = { me: pts[me] || 0, other: pts[other] || 0, meName: names[me], otherName: names[other] }
    const cover = couple.cover || ''
    const coverChanged = cover !== this.data.cover
    this.setData({
      names,
      together,
      milestone,
      list: items,
      loaded: true,
      points,
      period: this.periodCard(t),
      moods: this.todayMoods(t, names),
      cover,
      // 换了图就重新播一遍淡入
      coverReady: coverChanged ? false : this.data.coverReady
    })

    this.reveal()
    this.countDays()
  },

  // 经期卡片：没有任何记录时不显示
  periodCard(t) {
    const info = period.analyze(db.peek('periods') || [], t)
    if (!info) return null
    const card = { progress: info.progress, num: '', unit: '', wine: false }
    if (info.ongoing) {
      card.title = '经期第 ' + info.dayOfPeriod + ' 天'
      card.sub = info.last.end ? '记录到 ' + date.md(info.last.end) + ' 结束' : '预计 ' + date.md(info.expectedEnd) + ' 前后结束'
      card.wine = true
    } else if (info.stale) {
      card.title = '很久没记录经期了'
      card.sub = '来了记得在日历里记一下，预测才准'
    } else if (info.late) {
      card.title = '比预计晚了 ' + info.late + ' 天'
      card.sub = '原本预计 ' + date.md(info.nextStart)
      card.wine = true
    } else {
      card.title = '下次经期预计'
      card.sub = date.md(info.nextStart) + ' ' + date.weekday(info.nextStart)
      card.num = info.daysUntil === 0 ? '今天' : info.daysUntil
      card.unit = info.daysUntil === 0 ? '' : '天后'
    }
    card.foot = info.samples
      ? '按最近 ' + info.samples + ' 个周期估算，平均 ' + info.cycle + ' 天一次，只是参考'
      : '记满两次后按你们自己的周期估算，现在先按 28 天算'
    return card
  },

  // 今天两个人的心情：有形象图的用小人表情，没有的用心情图标
  todayMoods(t, names) {
    const list = db.peek('diary', { range: { field: 'date', from: t, to: t } }) || []
    const [me, other] = roles.pair(app.globalData.me)
    return [me, other].map((role) => {
      const e = list.find((x) => x.createdBy === role)
      const m = e ? MOOD[e.mood] || MOOD.calm : null
      return {
        role,
        name: names[role],
        mine: role === me,
        mood: m ? m.key : '',
        label: m ? m.label : '',
        text: e ? e.text || '' : '',
        avatar: hasAvatar(role)
      }
    })
  },

  writeMood() {
    ui.tick('medium')
    wx.navigateTo({ url: '/pages/diary-edit/index?date=' + date.today() })
  },

  goPoints() {
    ui.tick()
    wx.navigateTo({ url: '/pages/points/index' })
  },

  // 切到别的功能页不震动
  goCalendar() {
    app.globalData.tabFrom = 0
    wx.switchTab({ url: '/pages/calendar/index' })
  },

  toItem(a, t) {
    const occ = date.nextOccurrence(a, t)
    const kind = KINDS[a.kind] || KINDS.other
    const lunar = a.calendar === 'lunar' && a.lunarText
    const when = a.repeat
      ? `每年 ${lunar ? '农历' + a.lunarText : date.md(a.date)}`
      : `${date.dotted(a.date)}`
    const next = occ.days === 0 ? '就是今天' : `${date.dotted(occ.date)} ${date.weekday(occ.date)}`

    let nthText = ''
    if (a.repeat && occ.nth > 0) nthText = a.kind === 'birthday' ? `${occ.nth} 岁` : `${occ.nth} 周年`

    let num = occ.days
    let unit = '天后'
    if (occ.days === 0) {
      num = '今天'
      unit = ''
    } else if (occ.past) {
      num = -occ.days
      unit = '天前'
    }

    return {
      _id: a._id,
      title: a.title,
      kind: a.kind || 'other',
      icon: kind.icon,
      virtual: !!a.virtual,
      sub: a.repeat ? `${when} · ${next}` : `${when} · 只一次`,
      nthText,
      num,
      unit,
      today: occ.days === 0,
      // 未来的按天数排在前面，已经过去的一次性纪念日排最后
      order: occ.past ? 100000 - occ.days : occ.days
    }
  },

  statsFromCache() {
    const trips = db.peek('trips') || []
    const plans = db.peek('plans') || []
    const dishes = db.peek('dishes') || []
    const provinces = {}
    trips.forEach((t) => {
      if (t.scope !== 'abroad' && t.provinceCode) provinces[t.provinceCode] = 1
    })
    this.setData({
      stats: {
        provinces: Object.keys(provinces).length,
        plans: plans.length,
        plansDone: plans.filter((p) => p.done).length,
        dishes: dishes.filter((d) => d.learned && roles.ROLES.some((r) => d.learned[r])).length
      }
    })
  },

  open(e) {
    const { id } = e.currentTarget.dataset
    ui.tick()
    if (id === 'together') return wx.navigateTo({ url: '/pages/settings/index' })
    wx.navigateTo({ url: `/pages/anniversary-edit/index?id=${id}` })
  },

  add() {
    ui.tick('medium')
    wx.navigateTo({ url: '/pages/anniversary-edit/index' })
  },

  // ---------- 首页封面 ----------
  onCoverLoad() {
    this.setData({ coverReady: true })
  },

  previewCover() {
    if (this.data.cover) files.preview([this.data.cover], this.data.cover)
  },

  editCover() {
    ui.tick()
    if (this.data.coverBusy) return
    if (!this.data.cover) return this.chooseCover()
    wx.showActionSheet({
      itemList: ['更换封面', '移除封面'],
      success: (r) => {
        if (r.tapIndex === 0) this.chooseCover()
        if (r.tapIndex === 1) this.removeCover()
      }
    })
  },

  chooseCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => this.cropCover(res.tempFiles[0].tempFilePath),
      fail: (err) => {
        if (!/cancel/.test(err.errMsg || '')) ui.fail(new Error('选图失败，检查一下相册权限'))
      }
    })
  },

  // 按封面区域的比例裁一下；裁剪接口不可用时直接用原图（显示时会居中铺满）
  cropCover(path) {
    if (!wx.cropImage) return this.uploadCover(path)
    wx.cropImage({
      src: path,
      cropScale: '5:4',
      success: (r) => this.uploadCover(r.tempFilePath),
      fail: (err) => {
        if (/cancel/.test(err.errMsg || '')) return
        this.uploadCover(path)
      }
    })
  },

  uploadCover(path) {
    const old = this.data.cover
    this.setData({ coverBusy: true })
    wx.showLoading({ title: '上传封面', mask: true })
    db.upload([path])
      .then(([fileID]) => db.saveCouple({ cover: fileID }))
      .then((couple) => {
        app.setCouple(couple)
        this.render(db.peek('anniversaries') || [])
        if (old) db.removeFiles([old]).catch(() => null)
        ui.tick('medium')
      })
      .catch((e) => ui.fail(e, '封面没换成功'))
      .then(() => {
        wx.hideLoading()
        this.setData({ coverBusy: false })
      })
  },

  removeCover() {
    ui.confirm('移除封面', '首页会回到没有照片的样子', '移除').then((ok) => {
      if (!ok) return
      const old = this.data.cover
      db.saveCouple({ cover: '' })
        .then((couple) => {
          app.setCouple(couple)
          this.render(db.peek('anniversaries') || [])
          db.removeFiles([old]).catch(() => null)
        })
        .catch((e) => ui.fail(e))
    })
  },

  goSettings() {
    ui.tick()
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  goTab(e) {
    const paths = ['/pages/home/index', '/pages/calendar/index', '/pages/map/index', '/pages/plans/index', '/pages/menu/index']
    app.globalData.tabFrom = 0
    wx.switchTab({ url: paths[e.currentTarget.dataset.index] })
  }
})
