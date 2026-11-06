const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const roles = require('../../utils/roles')

const app = getApp()

const CATEGORIES = [
  { key: 'travel', label: '旅行', icon: 'plane' },
  { key: 'study', label: '学习', icon: 'graduation-cap' },
  { key: 'life', label: '生活', icon: 'house' },
  { key: 'other', label: '其他', icon: 'sparkles' }
]

Page({
  data: {
    id: '',
    form: { title: '', category: 'travel', owner: 'both', due: '', desc: '', items: [], done: false },
    categories: CATEGORIES,
    owners: [],
    dueText: '',
    newItem: '',
    today: '',
    focus: '',
    saving: false
  },

  onLoad(q) {
    const names = app.names()
    this.setData({
      today: date.today(),
      owners: [
        { key: 'both', label: '一起' },
        ...roles.ROLES.map((r) => ({ key: r, label: names[r] }))
      ]
    })
    if (q.id) {
      wx.setNavigationBarTitle({ title: '编辑计划' })
      const doc = (db.peek('plans') || []).find((d) => d._id === q.id)
      if (doc) this.fill(doc)
      else db.get('plans', q.id).then((d) => d && this.fill(d), (e) => ui.fail(e))
    } else if (q.category) {
      this.setData({ 'form.category': q.category })
    }
  },

  fill(doc) {
    this.setData({
      id: doc._id,
      form: {
        title: doc.title || '',
        category: doc.category || 'other',
        owner: doc.owner || 'both',
        due: doc.due || '',
        desc: doc.desc || '',
        items: (doc.items || []).map((x) => Object.assign({}, x)),
        done: !!doc.done
      }
    })
    this.setDue(doc.due || '')
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

  pickCat(e) {
    ui.tick()
    this.setData({ 'form.category': e.currentTarget.dataset.key })
  },

  onOwner(e) {
    this.setData({ 'form.owner': e.detail.key })
  },

  onDue(e) {
    this.setDue(e.detail.value)
  },

  setDue(v) {
    this.setData({ 'form.due': v, dueText: v ? `${date.ymd(v)} ${date.weekday(v)}` : '' })
  },

  clearDue() {
    ui.tick()
    this.setDue('')
  },

  onItemInput(e) {
    this.setData({ [`form.items[${e.currentTarget.dataset.index}].text`]: e.detail.value })
  },

  onNewItem(e) {
    this.setData({ newItem: e.detail.value })
  },

  addItem() {
    const text = this.data.newItem.trim()
    if (!text) return
    ui.tick()
    this.setData({
      'form.items': this.data.form.items.concat({ id: db.uid(), text, done: false }),
      newItem: ''
    })
  },

  removeItem(e) {
    const i = e.currentTarget.dataset.index
    ui.tick()
    this.setData({ [`form.items[${i}].leaving`]: true })
    setTimeout(() => {
      const items = this.data.form.items.filter((x) => !x.leaving)
      this.setData({ 'form.items': items })
    }, 300)
  },

  save() {
    const f = this.data.form
    const title = f.title.trim()
    if (!title) return ui.toast('写一下计划是什么')
    // 输入框里还没点添加的那一项也算进去
    const pending = this.data.newItem.trim()
    const items = f.items
      .filter((x) => !x.leaving && x.text.trim())
      .map((x) => ({ id: x.id, text: x.text.trim(), done: !!x.done }))
    if (pending) items.push({ id: db.uid(), text: pending, done: false })

    const doc = { title, category: f.category, owner: f.owner, due: f.due, desc: f.desc.trim(), items }
    if (!this.data.id) Object.assign(doc, { done: false, doneAt: 0 })

    this.setData({ saving: true })
    const task = this.data.id ? db.update('plans', this.data.id, doc) : db.add('plans', doc)
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
    ui.confirm('删除计划', `确定删除「${this.data.form.title}」吗`, '删除').then((ok) => {
      if (!ok) return
      db.remove('plans', this.data.id)
        .then(() => wx.navigateBack())
        .catch((e) => ui.fail(e))
    })
  }
})
