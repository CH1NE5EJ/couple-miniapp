const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const files = require('../../services/files')
const { ChinaMap } = require('../../utils/china-map')
const roles = require('../../utils/roles')

const app = getApp()
const PROVINCES = ChinaMap.provinces()
const MAX_PHOTOS = 30
// 一次最多选几张：基础库 2.25.0 起 20 张，更早只能 9 张
const PICK_MAX = versionAtLeast(sdkVersion(), '2.25.0') ? 20 : 9

function sdkVersion() {
  try {
    return (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).SDKVersion || ''
  } catch (e) {
    return ''
  }
}

function versionAtLeast(v, min) {
  const a = String(v).split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < b.length; i++) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]
  }
  return true
}

Page({
  data: {
    id: '',
    scopes: [
      { key: 'cn', label: '国内' },
      { key: 'abroad', label: '海外' }
    ],
    form: {
      scope: 'cn',
      region: [],
      province: '',
      provinceCode: '',
      city: '',
      country: '',
      abroadCity: '',
      place: '',
      title: '',
      startDate: '',
      endDate: '',
      people: [],
      note: '',
      photos: []
    },
    regionText: '',
    startText: '',
    endText: '',
    pairs: [],
    others: [],
    otherInput: '',
    maxPhotos: MAX_PHOTOS,
    // 宫格：items 按加入的先后排、不随顺序变（拖动换位时格子只滑动、不重建），位置由 form.photos 的顺序算
    // 已存好的照片显示缩略图
    items: [],
    geo: { size: 0, gap: 0 },
    layout: null,
    gridH: 0,
    addXY: { x: 0, y: 0 },
    today: '',
    focus: '',
    saving: false,
    progress: ''
  },

  onLoad(q) {
    this.removed = []
    // { 原图: 缩略图 }
    this.thumbOf = {}
    // 这次编辑已经传上去的新照片 { 本地路径: { p, t } }：保存失败重试时复用；没保存就离开时删掉
    this.uploaded = {}
    this.saved = false
    this.unloaded = false
    this.attempt = 0
    this.clientKey = db.uid()
    // 每次真正提交出去的照片列表：回应丢了的话，云函数凭它认出“其实是自己上次存上的”，不误报冲突
    this.tried = []
    const names = app.names()
    this.setData({ today: date.today() })

    // 编辑：先用本机缓存秒开，同时一定再拿一次最新的（对方可能刚加过照片）；拿到之前不让改照片、不让保存
    if (q.id) {
      wx.setNavigationBarTitle({ title: '编辑足迹' })
      this.tripId = q.id
      const doc = (db.peek('trips') || []).find((d) => d._id === q.id)
      if (doc) this.fill(doc)
      this.refresh().then((ok) => {
        if (!ok && !doc) ui.fail(new Error('没读到这条足迹，检查一下网络'))
      })
      return
    }

    const people = roles.ROLES.map((r) => names[r])
    this.setData({ 'form.people': people })
    this.setStart(date.today())
    this.syncPeople(people)
    if (q.province) {
      const p = PROVINCES.find((x) => x.code === q.province)
      if (p) this.setRegion([p.name], [p.code])
    }
    if (q.title) this.setData({ 'form.title': decodeURIComponent(q.title) })
  },

  // 拿最新的那一条；返回是否拿到了（拿不到时 stale=true，保存前会再试）
  // 已经在改文字了就不覆盖文字，只换照片相关的（照片在读取完成前不让动）
  refresh() {
    this.loading = true
    return db
      .get('trips', this.tripId)
      .then(
        (d) => {
          this.stale = false
          if (!d) return true
          if (this.filledText !== undefined && d.updatedAt === this.filledAt) return true
          if (this.filledText === undefined || this.textOf(this.data.form) === this.filledText) this.fill(d)
          else this.fillPhotos(d)
          return true
        },
        () => {
          this.stale = true
          return false
        }
      )
      .then((ok) => {
        this.loading = false
        return ok
      })
  },

  // 表单里除照片以外的内容，用来判断用户有没有改过
  textOf(form) {
    const f = Object.assign({}, form)
    delete f.photos
    return JSON.stringify(f)
  },

  // 只换照片相关的：照片列表、缩略图、打开时的照片列表
  fillPhotos(doc) {
    this.thumbOf = files.thumbs(doc)
    this.basePhotos = (doc.photos || []).slice()
    this.filledAt = doc.updatedAt
    this.setPhotos(doc.photos || [])
  },

  fill(doc) {
    this.thumbOf = files.thumbs(doc)
    // 打开时的照片列表：保存时带给云函数，对方在这期间改过照片就拒绝（不会按旧列表删掉对方的照片）
    this.basePhotos = (doc.photos || []).slice()
    this.filledAt = doc.updatedAt
    this.setData({
      id: doc._id,
      form: {
        scope: doc.scope || 'cn',
        region: doc.province ? [doc.province, doc.city].filter(Boolean) : [],
        province: doc.province || '',
        provinceCode: doc.provinceCode || '',
        city: doc.scope === 'abroad' ? '' : doc.city || '',
        country: doc.country || '',
        abroadCity: doc.scope === 'abroad' ? doc.city || '' : '',
        place: doc.place || '',
        title: doc.title || '',
        startDate: doc.startDate || '',
        endDate: doc.endDate || '',
        people: doc.people || [],
        note: doc.note || '',
        photos: doc.photos || []
      }
    })
    this.setPhotos(doc.photos || [])
    this.setData({ regionText: doc.scope === 'abroad' ? '' : [doc.province, doc.city].filter(Boolean).join(' ') })
    this.setStart(doc.startDate || date.today())
    this.setEnd(doc.endDate || '')
    this.syncPeople(doc.people || [])
    this.filledText = this.textOf(this.data.form)
  },

  // 两个人固定成两个开关，其余同行的人单独列出
  syncPeople(people) {
    const names = app.names()
    const pair = roles.ROLES.map((r) => names[r])
    this.setData({
      'form.people': people,
      pairs: pair.map((n) => ({ name: n, on: people.indexOf(n) >= 0 })),
      others: people.filter((n) => pair.indexOf(n) < 0)
    })
  },

  onFocus(e) {
    this.setData({ focus: e.currentTarget.dataset.name })
  },

  onBlur() {
    this.setData({ focus: '' })
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.name}`]: e.detail.value })
  },

  onScope(e) {
    this.setData({ 'form.scope': e.detail.key })
  },

  onRegion(e) {
    this.setRegion(e.detail.value, e.detail.code || [])
  },

  setRegion(value, code) {
    const province = value[0] || ''
    const city = value[1] || ''
    let provinceCode = code[0] || ''
    if (!provinceCode) {
      const p = PROVINCES.find((x) => x.name === province)
      provinceCode = p ? p.code : ''
    }
    this.setData({
      'form.region': value,
      'form.province': province,
      'form.city': city,
      'form.provinceCode': provinceCode,
      regionText: [province, city].filter(Boolean).join(' ')
    })
  },

  onStart(e) {
    this.setStart(e.detail.value)
    if (this.data.form.endDate && this.data.form.endDate < e.detail.value) this.setEnd('')
  },

  setStart(v) {
    this.setData({ 'form.startDate': v, startText: `${date.dotted(v)} ${date.weekday(v)}` })
  },

  onEnd(e) {
    this.setEnd(e.detail.value)
  },

  setEnd(v) {
    const s = this.data.form.startDate
    const days = v && s ? date.diff(s, v) + 1 : 0
    this.setData({ 'form.endDate': v, endText: v ? `${date.dotted(v)} · ${days} 天` : '' })
  },

  clearEnd() {
    this.setEnd('')
  },

  togglePair(e) {
    ui.tick()
    const { name } = e.currentTarget.dataset
    const people = this.data.form.people.slice()
    const i = people.indexOf(name)
    if (i >= 0) people.splice(i, 1)
    else people.unshift(name)
    this.syncPeople(people)
  },

  onOtherInput(e) {
    this.setData({ otherInput: e.detail.value })
  },

  addOther() {
    const name = this.data.otherInput.trim()
    if (!name) return
    if (this.data.form.people.indexOf(name) >= 0) return this.setData({ otherInput: '' })
    ui.tick()
    this.syncPeople(this.data.form.people.concat(name))
    this.setData({ otherInput: '' })
  },

  removeOther(e) {
    ui.tick()
    const { name } = e.currentTarget.dataset
    this.syncPeople(this.data.form.people.filter((n) => n !== name))
  },

  // 量一下宫格宽度，算出格子边长和间距（px）
  // 取样式里的宽度：这时外层还在播入场动画（带缩放），量外框会偏小
  onReady() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.windowH = info.windowHeight
    wx.createSelectorQuery()
      .select('.grid')
      .fields({ computedStyle: ['width'] }, (r) => {
        const gap = Math.round((12 * info.windowWidth) / 750)
        const width = (r && parseFloat(r.width)) || info.windowWidth * 0.82
        this.setData({ geo: { size: Math.floor((width - gap * 2) / 3), gap } })
        this.setPhotos(this.data.form.photos)
      })
      .exec()
  },

  // 没保存就离开：这次已经传上去的新照片没人用了，删掉
  // 正在保存时离开：先不删，等保存有了结果再说（成功就都用上了，失败再清理）
  onUnload() {
    this.unloaded = true
    if (this.saved || this.data.saving) return
    this.cleanupUploads()
  },

  // 清理这次传了但没用上的照片：先看一眼所有足迹，任何一条在用的都不删
  // （保存可能其实成功了、只是回应丢了；看不了就宁可留着，也不冒删错的险）
  cleanupUploads() {
    const ids = []
    Object.keys(this.uploaded).forEach((k) => ids.push(this.uploaded[k].p, this.uploaded[k].t))
    this.uploaded = {}
    const mine = ids.filter(Boolean)
    if (!mine.length) return
    db.list('trips')
      .then((list) => {
        const used = new Set()
        ;(list || []).forEach((t) => {
          ;(t.photos || []).forEach((p) => used.add(p))
          ;(t.thumbs || []).forEach((x) => x && used.add(x.t))
        })
        const drop = mine.filter((id) => !used.has(id))
        return drop.length ? db.removeFiles(drop) : null
      })
      .catch(() => null)
  },

  // 正在保存，或者还在读取最新内容：照片先别动
  busy() {
    return this.data.saving || this.loading
  },

  // 照片顺序变了：更新顺序、宫格里每张的位置、封面标记和宫格高度
  setPhotos(photos) {
    const { size, gap } = this.data.geo
    const xy = (i) => ({ x: (i % 3) * (size + gap), y: Math.floor(i / 3) * (size + gap) })
    const old = {}
    this.data.items.forEach((it) => {
      old[it.key] = it
    })
    // 原有的保持原来的先后，新加的接在后面
    const keys = this.data.items.map((it) => it.key).filter((k) => photos.indexOf(k) >= 0)
    photos.forEach((p) => {
      if (keys.indexOf(p) < 0) keys.push(p)
    })
    const items = keys.map((k) => {
      const i = photos.indexOf(k)
      return Object.assign({ key: k, src: this.thumbOf[k] || k }, xy(i), { cover: i === 0 })
    })
    const slots = photos.length + (photos.length < MAX_PHOTOS ? 1 : 0)
    const rows = Math.ceil(slots / 3)
    this.setData({
      'form.photos': photos,
      items,
      addXY: xy(photos.length),
      gridH: size ? rows * size + (rows - 1) * gap : 0,
      // vh：页面可视高度，拖到上下边缘时自动滚动要用
      layout: size ? { order: photos, size, gap, cols: 3, vh: this.windowH || 0 } : null
    })
  },

  onDragStart() {
    ui.tick('medium')
  },

  onDragOver() {
    ui.tick()
  },

  // 拖到屏幕上下边缘时，sort.wxs 每帧请页面滚到指定位置
  dragScroll({ top }) {
    wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 0 })
  },

  // 拖完：把那张照片放到新位置；第一张就是封面
  // order：拖动时视图层看到的顺序；和现在的对不上（中途刷新过、删过）就不按它改，按现在的顺序摆回去
  onDragEnd({ key, to, order }) {
    const cur = this.data.form.photos
    const stale = cur.indexOf(key) < 0 || (Array.isArray(order) && order.join('\n') !== cur.join('\n'))
    // 正忙或过期：不改顺序，按原来的顺序把宫格摆回去
    if (this.busy() || stale) return this.setPhotos(cur)
    const photos = cur.filter((p) => p !== key)
    photos.splice(to, 0, key)
    this.setPhotos(photos)
  },

  choosePhotos() {
    if (this.busy()) return
    const left = MAX_PHOTOS - this.data.form.photos.length
    if (left <= 0) return ui.toast(`最多 ${MAX_PHOTOS} 张`)
    wx.chooseMedia({
      count: Math.min(left, PICK_MAX),
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        ui.tick()
        // 宫格按路径认照片，同一个路径只留一份
        const cur = this.data.form.photos
        const paths = res.tempFiles
          .map((f) => f.tempFilePath)
          .filter((p, i, all) => p && cur.indexOf(p) < 0 && all.indexOf(p) === i)
        this.setPhotos(cur.concat(paths).slice(0, MAX_PHOTOS))
      },
      fail: (err) => {
        if (!/cancel/.test(err.errMsg || '')) ui.fail(new Error('选图失败，检查一下相册权限'))
      }
    })
  },

  // 点缩略图设为封面（移到第一张）
  setCover(e) {
    if (this.busy()) return
    const i = this.data.form.photos.indexOf(e.currentTarget.dataset.key)
    if (i < 0) return
    if (i === 0) {
      files.preview(this.data.form.photos, this.data.form.photos[0])
      return
    }
    ui.tick()
    const photos = this.data.form.photos.slice()
    const [p] = photos.splice(i, 1)
    photos.unshift(p)
    this.setPhotos(photos)
    ui.toast('已设为封面')
  },

  removePhoto(e) {
    if (this.busy()) return
    const i = this.data.form.photos.indexOf(e.currentTarget.dataset.key)
    if (i < 0) return
    ui.tick()
    const photos = this.data.form.photos.slice()
    const [p] = photos.splice(i, 1)
    // 已经存好的照片，保存时连同缩略图一起从云端删掉
    if (db.countNew([p]) === 0) this.removed.push(p)
    if (this.thumbOf[p]) this.removed.push(this.thumbOf[p])
    this.setPhotos(photos)
  },

  save() {
    // 连点两下：第二下不算（两次保存会建出两条、互相删照片）
    if (this.data.saving) return
    if (this.loading) return ui.toast('正在读取最新内容，稍等一下')
    // 打开时没拿到最新的：先补拿一次；内容有变就让用户看一眼再存
    if (this.stale) {
      const at = this.filledAt
      return this.refresh().then((ok) => {
        if (!ok) return ui.toast('网络不好，没读到最新内容，稍后再存')
        if (this.filledAt !== at) return ui.toast('对方刚改过，已更新为最新内容，看一眼再保存')
        this.save()
      })
    }
    const f = this.data.form
    if (f.scope === 'cn' && !f.provinceCode) return ui.toast('选一下去了哪里')
    if (f.scope === 'abroad' && !f.country.trim()) return ui.toast('填一下国家或地区')
    if (!f.startDate) return ui.toast('选一下出发日期')

    const total = db.countNew(f.photos)
    // 上一次失败的上传可能还有零星回调回来，只认这一次的进度
    const attempt = ++this.attempt
    const progress = (text) => attempt === this.attempt && this.setData({ progress: text })
    let sent = null
    this.setData({ saving: true, progress: total ? `上传照片 0/${total}` : '保存中' })
    db.uploadPhotos(f.photos, this.thumbOf, this.uploaded, (done) => progress(`上传照片 ${done}/${total}`))
      .then(({ photos, thumbs }) => {
        sent = { photos, thumbs }
        progress('保存中')
        const abroad = f.scope === 'abroad'
        const doc = {
          scope: f.scope,
          province: abroad ? '' : f.province,
          provinceCode: abroad ? '' : f.provinceCode,
          city: abroad ? f.abroadCity.trim() : f.city,
          country: abroad ? f.country.trim() : '',
          place: f.place.trim(),
          title: f.title.trim(),
          startDate: f.startDate,
          endDate: f.endDate,
          people: f.people,
          note: f.note.trim(),
          photos,
          thumbs
        }
        // 这一页之前提交过的照片列表一起带上（回应丢了的那次其实可能已经存上）
        const tried = this.tried.slice(-4)
        this.tried.push(photos)
        if (this.data.id) {
          return db.update('trips', this.data.id, Object.assign({ basePhotos: this.basePhotos || [], triedPhotos: tried }, doc))
        }
        // 新建：同一次编辑里重试都带同一个 clientKey，云函数据此避免建出两条；新建时“打开时的照片”是空的
        return db.add('trips', Object.assign({ clientKey: this.clientKey, basePhotos: [], triedPhotos: tried }, doc))
      })
      .then((res) => {
        this.awards = (res && res._awards) || []
        this.saved = true
        // 要删的：编辑时删掉的旧照片，加上这次传了但最后没用上的新照片；保存进去的文件一个都不能删
        const keep = new Set(sent.photos.concat(sent.thumbs.map((x) => x.t)))
        const unused = []
        Object.keys(this.uploaded).forEach((k) => unused.push(this.uploaded[k].p, this.uploaded[k].t))
        this.uploaded = {}
        const drop = this.removed.concat(unused).filter((id) => id && !keep.has(id))
        return db.removeFiles(drop).catch(() => null)
      })
      .then(() => {
        const got = this.awards.reduce((s, a) => s + a.delta, 0)
        if (got) {
          ui.tick('heavy')
          ui.toast(`点亮了，+${got} 积分`)
        } else {
          ui.tick('medium')
        }
        // 保存途中已经离开了这一页：不能再返回（会多退一页），让现在显示的页面刷新一下
        if (!this.unloaded) return setTimeout(() => wx.navigateBack(), got ? 900 : 0)
        const pages = getCurrentPages()
        const top = pages[pages.length - 1]
        if (top && typeof top.refreshTrips === 'function') top.refreshTrips()
      })
      .catch((e) => {
        ui.fail(e, '保存失败')
        this.setData({ saving: false, progress: '' })
        // 保存途中离开、最后又没成功：这次传上去的照片清理掉（仍会先确认没有足迹在用）
        if (this.unloaded) this.cleanupUploads()
      })
  },

  remove() {
    if (this.data.saving) return
    ui.confirm('删除这次足迹', '照片也会一起删除，删除后不能恢复', '删除').then((ok) => {
      if (!ok) return
      db.remove('trips', this.data.id)
        .then(() => wx.navigateBack({ delta: 2 }))
        .catch((e) => ui.fail(e))
    })
  }
})
