const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const files = require('../../services/files')
const { RULES } = require('../../data/points')
const roles = require('../../utils/roles')

const app = getApp()
const MAX_PHOTOS = 9

Page({
  data: {
    id: '',
    date: '',
    dateText: '',
    isToday: false,
    today: '',
    form: { mood: '', text: '', events: [], photos: [] },
    eventInput: '',
    maxPhotos: MAX_PHOTOS,
    bonus: RULES.mood,
    me: roles.meOr(app.globalData.me),
    focus: '',
    saving: false,
    progress: ''
  },

  onLoad(q) {
    this.removed = []
    this.setData({ me: roles.meOr(app.globalData.me) })
    const t = date.today()
    this.setData({ today: t })
    this.setDate(q.date && q.date <= t ? q.date : t)
  },

  setDate(d) {
    this.setData({
      date: d,
      dateText: `${date.ymd(d)} ${date.weekday(d)}`,
      isToday: d === this.data.today
    })
    this.loadMine(d)
  },

  // 找这天自己写过的那条（先看缓存，再问服务器）
  loadMine(d) {
    const me = app.globalData.me
    const find = (list) => (list || []).find((x) => x.date === d && x.createdBy === me)
    const cached = find(db.peek('diary')) || null
    this.fill(cached)
    db.list('diary', { range: { field: 'date', from: d, to: d } })
      .then((list) => {
        if (this.data.date === d) this.fill(find(list) || null)
      })
      .catch((e) => ui.fail(e))
  },

  fill(doc) {
    wx.setNavigationBarTitle({ title: doc ? '改一改心情' : '写下心情' })
    this.setData({
      id: doc ? doc._id : '',
      form: doc
        ? { mood: doc.mood || '', text: doc.text || '', events: doc.events || [], photos: doc.photos || [] }
        : { mood: '', text: '', events: [], photos: [] }
    })
  },

  onDate(e) {
    this.setDate(e.detail.value)
  },

  pickMood(e) {
    // 心情选择器组件传 detail.key；兼容直接带 data-key 的调用
    this.setData({ 'form.mood': (e.detail && e.detail.key) || e.currentTarget.dataset.key })
  },

  onFocus(e) {
    this.setData({ focus: e.currentTarget.dataset.name })
  },

  onBlur() {
    this.setData({ focus: '' })
  },

  onText(e) {
    this.setData({ 'form.text': e.detail.value })
  },

  onEventInput(e) {
    this.setData({ eventInput: e.detail.value })
  },

  addEvent() {
    const v = this.data.eventInput.trim()
    if (!v) return
    if (this.data.form.events.indexOf(v) >= 0) return this.setData({ eventInput: '' })
    ui.tick()
    this.setData({ 'form.events': this.data.form.events.concat(v).slice(0, 12), eventInput: '' })
  },

  removeEvent(e) {
    ui.tick()
    const v = e.currentTarget.dataset.v
    this.setData({ 'form.events': this.data.form.events.filter((x) => x !== v) })
  },

  choosePhotos() {
    const left = MAX_PHOTOS - this.data.form.photos.length
    if (left <= 0) return ui.toast(`最多 ${MAX_PHOTOS} 张`)
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        ui.tick()
        this.setData({ 'form.photos': this.data.form.photos.concat(res.tempFiles.map((f) => f.tempFilePath)) })
      },
      fail: (err) => {
        if (!/cancel/.test(err.errMsg || '')) ui.fail(new Error('选图失败，检查一下相册权限'))
      }
    })
  },

  previewPhoto(e) {
    files.preview(this.data.form.photos, this.data.form.photos[e.currentTarget.dataset.index])
  },

  removePhoto(e) {
    ui.tick()
    const photos = this.data.form.photos.slice()
    const [p] = photos.splice(e.currentTarget.dataset.index, 1)
    if (db.countNew([p]) === 0) this.removed.push(p)
    this.setData({ 'form.photos': photos })
  },

  save() {
    const f = this.data.form
    if (!f.mood) return ui.toast('先选一个心情')
    // 输入框里还没点添加的小事也算进去
    const pending = this.data.eventInput.trim()
    const events = pending && f.events.indexOf(pending) < 0 ? f.events.concat(pending) : f.events
    const total = db.countNew(f.photos)
    this.setData({ saving: true, progress: total ? `上传照片 0/${total}` : '保存中' })
    db.upload(f.photos, (done) => this.setData({ progress: `上传照片 ${done}/${total}` }))
      .then((photos) => {
        const doc = { date: this.data.date, mood: f.mood, text: f.text.trim(), events, photos }
        return this.data.id ? db.update('diary', this.data.id, doc) : db.add('diary', doc)
      })
      .then((res) => {
        db.removeFiles(this.removed).catch(() => null)
        const got = (res && res._awards) || []
        if (got.length) {
          ui.tick('heavy')
          ui.toast(`心情记下了，+${got.reduce((s, a) => s + a.delta, 0)} 积分`)
        } else {
          ui.tick('medium')
        }
        setTimeout(() => wx.navigateBack(), got.length ? 900 : 0)
      })
      .catch((e) => {
        ui.fail(e, '保存失败')
        this.setData({ saving: false, progress: '' })
      })
  },

  remove() {
    ui.confirm('删除这天的心情', '照片也会一起删除', '删除').then((ok) => {
      if (!ok) return
      db.remove('diary', this.data.id)
        .then(() => wx.navigateBack())
        .catch((e) => ui.fail(e))
    })
  }
})
