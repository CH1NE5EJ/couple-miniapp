const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')

const KINDS = [
  { key: 'love', label: '恋爱', icon: 'heart' },
  { key: 'birthday', label: '生日', icon: 'cake' },
  { key: 'festival', label: '节日', icon: 'gift' },
  { key: 'other', label: '其他', icon: 'flag' }
]

Page({
  data: {
    id: '',
    form: { title: '', kind: 'love', date: '', calendar: 'solar', repeat: true, note: '' },
    kinds: KINDS,
    calendars: [
      { key: 'solar', label: '公历' },
      { key: 'lunar', label: '农历' }
    ],
    dateText: '',
    mdText: '',
    lunarText: '',
    focus: '',
    saving: false
  },

  onLoad(q) {
    if (q.id) {
      wx.setNavigationBarTitle({ title: '编辑纪念日' })
      const doc = (db.peek('anniversaries') || []).find((d) => d._id === q.id)
      if (doc) this.fill(doc)
      else db.get('anniversaries', q.id).then((d) => d && this.fill(d), (e) => ui.fail(e))
    } else {
      // 从日历的爱心标记转过来：带着日期和写好的名字
      if (q.title) {
        let title = q.title
        try {
          title = decodeURIComponent(title)
        } catch (e) {
          // 已经解码过的原样用
        }
        this.setData({ 'form.title': title.slice(0, 20) })
      }
      this.setDate(/^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : date.today())
    }
  },

  fill(doc) {
    this.setData({
      id: doc._id,
      form: {
        title: doc.title || '',
        kind: doc.kind || 'other',
        date: doc.date,
        calendar: doc.calendar || 'solar',
        repeat: doc.repeat !== false,
        note: doc.note || ''
      }
    })
    this.setDate(doc.date)
  },

  setDate(v) {
    const l = date.lunarOf(v)
    this.setData({
      'form.date': v,
      dateText: `${date.ymd(v)} ${date.weekday(v)}`,
      mdText: date.md(v),
      lunarText: l ? l.text : ''
    })
  },

  onFocus(e) {
    this.setData({ focus: e.currentTarget.dataset.name })
  },

  onBlur() {
    this.setData({ focus: '' })
  },

  onTitle(e) {
    this.setData({ 'form.title': e.detail.value })
  },

  onNote(e) {
    this.setData({ 'form.note': e.detail.value })
  },

  pickKind(e) {
    ui.tick()
    this.setData({ 'form.kind': e.currentTarget.dataset.key })
  },

  onDate(e) {
    this.setDate(e.detail.value)
  },

  onRepeat(e) {
    this.setData({ 'form.repeat': e.detail.value })
  },

  onCalendar(e) {
    this.setData({ 'form.calendar': e.detail.key })
  },

  save() {
    const f = this.data.form
    const title = f.title.trim()
    if (!title) return ui.toast('给纪念日起个名字')
    if (!f.date) return ui.toast('选一个日期')

    const doc = {
      title,
      kind: f.kind,
      date: f.date,
      repeat: f.repeat,
      calendar: f.repeat ? f.calendar : 'solar',
      note: f.note.trim(),
      lunarMonth: 0,
      lunarDay: 0,
      lunarText: ''
    }
    if (doc.calendar === 'lunar') {
      const l = date.lunarOf(f.date)
      if (!l) return ui.toast('这个日期超出农历换算范围')
      Object.assign(doc, { lunarMonth: l.month, lunarDay: l.day, lunarText: l.text })
    }

    this.setData({ saving: true })
    const task = this.data.id ? db.update('anniversaries', this.data.id, doc) : db.add('anniversaries', doc)
    task
      .then(() => {
        ui.tick('medium')
        wx.navigateBack()
      })
      .catch((e) => {
        ui.fail(e)
        this.setData({ saving: false })
      })
  },

  remove() {
    ui.confirm('删除纪念日', `确定删除「${this.data.form.title}」吗`, '删除').then((ok) => {
      if (!ok) return
      db.remove('anniversaries', this.data.id)
        .then(() => wx.navigateBack())
        .catch((e) => ui.fail(e))
    })
  }
})
