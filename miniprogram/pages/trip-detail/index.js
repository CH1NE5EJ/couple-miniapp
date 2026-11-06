const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const { MOOD } = require('../../data/points')
const roles = require('../../utils/roles')

const app = getApp()

Page({
  data: {
    trip: null,
    me: '',
    reviews: [],
    sheet: { show: false, mood: '', text: '', has: false },
    saving: false
  },

  onLoad(q) {
    this.id = q.id
  },

  onShow() {
    const doc = (db.peek('trips') || []).find((d) => d._id === this.id)
    if (doc) this.render(doc)
    db.get('trips', this.id).then(
      (d) => {
        if (d) this.render(d)
        else if (!doc) wx.navigateBack()
      },
      (e) => ui.fail(e)
    )
  },

  // 编辑页保存途中被退出、之后才存好：由编辑页叫这里刷新
  refreshTrips() {
    this.onShow()
  },

  render(t) {
    const abroad = t.scope === 'abroad'
    const region = abroad ? [t.country, t.city].filter(Boolean).join(' · ') : [t.province, t.city].filter(Boolean).join(' · ')
    const days = t.endDate && t.endDate > t.startDate ? date.diff(t.startDate, t.endDate) + 1 : 1
    const photos = t.photos || []
    this.setData({
      trip: {
        title: t.title || t.place || region || '一次旅行',
        region,
        place: t.title ? t.place : '',
        dateText:
          days > 1 ? `${date.ymd(t.startDate)} - ${date.md(t.endDate)}` : `${date.ymd(t.startDate)} ${date.weekday(t.startDate)}`,
        days,
        people: (t.people || []).map((n) => ({ name: n, initial: String(n).slice(0, 1).toUpperCase() })),
        note: t.note || '',
        photos,
        thumbs: t.thumbs || [],
        createdText: t.createdAt ? date.dotted(date.fmt(new Date(t.createdAt))) : ''
      }
    })
    wx.setNavigationBarTitle({ title: region || '足迹' })
    this.raw = t
    this.renderReviews(t)
  },

  // 两个人的点评：自己的排前面
  renderReviews(t) {
    const names = app.names()
    const [me, other] = roles.pair(app.globalData.me)
    const rv = t.reviews || {}
    const reviews = [me, other].map((role) => {
      const r = rv[role]
      const m = r && MOOD[r.mood]
      return {
        role,
        name: names[role],
        mine: role === me,
        has: !!m,
        mood: m ? m.key : '',
        label: m ? m.label : '',
        text: r ? r.text || '' : '',
        when: r && r.at ? date.md(date.fmt(new Date(r.at))) : ''
      }
    })
    this.setData({ me, reviews })
  },

  tapReview(e) {
    if (e.currentTarget.dataset.mine) this.openReview()
  },

  openReview() {
    ui.tick()
    const r = ((this.raw && this.raw.reviews) || {})[this.data.me]
    this.setData({ sheet: { show: true, mood: r ? r.mood : '', text: r ? r.text || '' : '', has: !!r } })
  },

  closeReview() {
    this.setData({ 'sheet.show': false })
  },

  onReviewMood(e) {
    this.setData({ 'sheet.mood': e.detail.key })
  },

  onReviewText(e) {
    this.setData({ 'sheet.text': e.detail.value })
  },

  // 写完从服务器拿最新的足迹（对方可能刚好也写了）
  refreshTrip() {
    return db.get('trips', this.id).then((d) => {
      if (d) this.render(d)
      db.list('trips').catch(() => null)
    })
  },

  saveReview() {
    const s = this.data.sheet
    if (!s.mood) return ui.toast('先选一个心情')
    if (this.data.saving) return
    this.setData({ saving: true })
    db.act('tripReview', { id: this.id, mood: s.mood, text: s.text })
      .then(() => {
        ui.tick('medium')
        this.closeReview()
        return this.refreshTrip()
      })
      .catch((e) => ui.fail(e, '点评没保存上'))
      .then(() => this.setData({ saving: false }))
  },

  removeReview() {
    ui.confirm('删除点评', '只删除你自己的点评', '删除').then((ok) => {
      if (!ok) return
      db.act('tripReview', { id: this.id, remove: true })
        .then(() => {
          this.closeReview()
          return this.refreshTrip()
        })
        .catch((e) => ui.fail(e))
    })
  },

  edit() {
    ui.tick()
    wx.navigateTo({ url: `/pages/trip-edit/index?id=${this.id}` })
  }
})
