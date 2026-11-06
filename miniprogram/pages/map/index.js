const db = require('../../services/db')
const files = require('../../services/files')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const { ChinaMap } = require('../../utils/china-map')
const refresh = require('../../behaviors/refresh')
const roles = require('../../utils/roles')

const app = getApp()
const PROVINCES = ChinaMap.provinces()
const TOTAL = PROVINCES.length

function shortName(name) {
  return String(name || '').replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/, '')
}

function toCard(t) {
  const abroad = t.scope === 'abroad'
  const region = abroad
    ? [t.country, t.city].filter(Boolean).join(' · ')
    : [shortName(t.province), t.city && t.city !== t.province ? shortName(t.city) : ''].filter(Boolean).join(' · ')
  const days = t.endDate && t.endDate > t.startDate ? date.diff(t.startDate, t.endDate) + 1 : 1
  const dateText =
    days > 1
      ? `${date.dotted(t.startDate)} - ${date.md(t.endDate)} · ${days} 天`
      : `${date.dotted(t.startDate)} ${date.weekday(t.startDate)}`
  const reviews = t.reviews || {}
  return {
    _id: t._id,
    title: t.title || t.place || region || '一次旅行',
    note: String(t.note || '').trim(),
    region: t.title && t.place ? `${region} · ${t.place}` : region,
    dateText,
    startDate: t.startDate || '',
    people: (t.people || []).join('、'),
    // 宫格用缩略图（files.thumbs 按原图查），列表只显示前 9 张
    photos: t.photos || [],
    thumbs: t.thumbs || [],
    provinceCode: abroad ? '' : t.provinceCode || '',
    reviews: roles.ROLES.filter((r) => reviews[r]).map((r) => ({ role: r, mood: reviews[r].mood })),
    abroad
  }
}

Page({
  behaviors: [refresh],

  data: {
    mapH: 280,
    shown: [],
    selected: null,
    stats: { lit: 0, total: TOTAL, cities: 0, trips: 0, abroad: 0 },
    litShown: 0,
    loaded: false
  },

  onLoad() {
    this.counts = {}
    // 全部卡片放在页面实例上，不进视图层；视图层只拿当前显示的那些
    this.trips = []
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const width = info.windowWidth * (1 - 112 / 750)
    this.setData({ mapH: Math.round(width * ChinaMap.aspect()) })
  },

  onReady() {
    this.initMap()
  },

  // 本机数据没变就不重画；在这一页看完大图、关掉查看器回来的那次 onShow 不用再问云端
  onShow() {
    ui.showTab(this, 2)
    const cached = db.peek('trips')
    if (cached) this.render(cached)
    if (files.previewedFrom('pages/map/index')) return
    app
      .requireMember()
      .then((res) => res && db.list('trips'))
      .then((list) => list && this.render(list))
      .catch((e) => ui.fail(e))
  },

  // 编辑页保存途中被退出、之后才存好：由编辑页叫这里刷新
  refreshTrips() {
    const cached = db.peek('trips')
    if (cached) this.render(cached)
    db.list('trips')
      .then((list) => this.render(list))
      .catch(() => null)
  },

  onPullDownRefresh() {
    db.list('trips')
      .then((list) => this.render(list))
      .catch((e) => ui.fail(e))
      .then(() => this.stopRefresh())
  },

  initMap() {
    wx.createSelectorQuery()
      .select('#map')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        const r = res && res[0]
        if (!r || !r.node) return
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const dpr = info.pixelRatio || 2
        const canvas = r.node
        canvas.width = Math.round(r.width * dpr)
        canvas.height = Math.round(r.height * dpr)
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        this.canvasRect = { left: r.left, top: r.top }
        this.map = new ChinaMap({ canvas, ctx, width: r.width, height: r.height })
        this.map.setCounts(this.counts, false)
        this.map.playIntro()
      })
  },

  render(list) {
    // 每条的最后修改时间 + 名字都没变：和上次画的一样，跳过
    const sig = JSON.stringify(app.names()) + list.map((t) => `${t._id}:${t.updatedAt || t.createdAt || 0}`).join('|')
    if (sig === this.sig) return
    this.sig = sig
    const counts = {}
    const cities = {}
    let abroad = 0
    list.forEach((t) => {
      if (t.scope === 'abroad') {
        abroad += 1
        if (t.city || t.country) cities[`${t.country}/${t.city}`] = 1
        return
      }
      if (t.provinceCode) counts[t.provinceCode] = (counts[t.provinceCode] || 0) + 1
      if (t.city) cities[t.city] = 1
    })
    this.counts = counts
    // 地图已经在了：和上一次的差异走点亮/熄灭涟漪
    if (this.map) this.map.setCounts(counts, true)

    this.trips = list.map(toCard).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    const lit = Object.keys(counts).length
    this.setData({
      stats: { lit, total: TOTAL, cities: Object.keys(cities).length, trips: list.length, abroad },
      loaded: true
    })
    if (lit !== this.data.litShown) {
      ui.countUp(this.data.litShown, lit, 700, (v) => this.setData({ litShown: v }))
    }
    if (this.data.selected) {
      this.setData({ 'selected.count': counts[this.data.selected.code] || 0 })
    }
    this.applyFilter(false)
  },

  applyFilter(replay) {
    const sel = this.data.selected
    const shown = sel ? this.trips.filter((t) => t.provinceCode === sel.code) : this.trips
    if (!replay) return this.setData({ shown })
    // 先清空再填回，让卡片重新播一遍入场
    this.setData({ shown: [] }, () => setTimeout(() => this.setData({ shown }), 16))
  },

  onMapStart(e) {
    const t = e.touches[0]
    this.touch = t ? { x: this.pointX(t), y: this.pointY(t), at: Date.now() } : null
  },

  onMapEnd(e) {
    const s = this.touch
    const t = e.changedTouches && e.changedTouches[0]
    this.touch = null
    if (!s || !t || !this.map) return
    const x = this.pointX(t)
    const y = this.pointY(t)
    if (Math.abs(x - s.x) > 10 || Math.abs(y - s.y) > 10 || Date.now() - s.at > 500) return
    const code = this.map.hitTest(x, y)
    const cur = this.data.selected && this.data.selected.code
    this.select(code && code !== cur ? code : null)
  },

  // canvas 触点一般自带相对坐标 x/y，个别基础库没有时用页面坐标换算
  pointX(t) {
    return typeof t.x === 'number' ? t.x : t.pageX - (this.canvasRect ? this.canvasRect.left : 0)
  },

  pointY(t) {
    return typeof t.y === 'number' ? t.y : t.pageY - (this.canvasRect ? this.canvasRect.top : 0)
  },

  select(code) {
    ui.tick()
    if (this.map) this.map.select(code)
    const p = code ? PROVINCES.find((x) => x.code === code) : null
    this.setData({ selected: p ? { code, name: p.name, count: this.counts[code] || 0 } : null })
    this.applyFilter(true)
  },

  clearSelect() {
    this.select(null)
  },

  addHere() {
    ui.tick('medium')
    const sel = this.data.selected
    wx.navigateTo({ url: `/pages/trip-edit/index?province=${sel ? sel.code : ''}` })
  },

  add() {
    ui.tick('medium')
    wx.navigateTo({ url: '/pages/trip-edit/index' })
  },

  open(e) {
    ui.tick()
    wx.navigateTo({ url: `/pages/trip-detail/index?id=${e.currentTarget.dataset.id}` })
  }
})
