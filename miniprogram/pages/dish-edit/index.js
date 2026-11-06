const db = require('../../services/db')
const ui = require('../../utils/ui')
const { CATEGORIES } = require('../../data/dishes')
const roles = require('../../utils/roles')

const app = getApp()

Page({
  data: {
    id: '',
    form: { name: '', category: 'meat', learned: roles.byRole(() => false), note: '', photo: '' },
    categories: CATEGORIES,
    names: app.names(),
    roles: roles.ROLES,
    focus: '',
    saving: false
  },

  onLoad(q) {
    this.setData({ names: app.names() })
    this.oldPhoto = ''
    if (q.id) {
      wx.setNavigationBarTitle({ title: '编辑菜品' })
      const doc = (db.peek('dishes') || []).find((d) => d._id === q.id)
      if (doc) this.fill(doc)
      else db.get('dishes', q.id).then((d) => d && this.fill(d), (e) => ui.fail(e))
    } else if (q.category) {
      this.setData({ 'form.category': q.category })
    }
  },

  fill(doc) {
    this.oldPhoto = doc.photo || ''
    this.setData({
      id: doc._id,
      form: {
        name: doc.name || '',
        category: doc.category || 'meat',
        learned: roles.byRole((r) => !!(doc.learned && doc.learned[r])),
        note: doc.note || '',
        photo: doc.photo || ''
      }
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

  pickCat(e) {
    ui.tick()
    this.setData({ 'form.category': e.currentTarget.dataset.key })
  },

  toggleLearn(e) {
    const { role } = e.currentTarget.dataset
    const on = !this.data.form.learned[role]
    ui.tick(on ? 'medium' : 'light')
    this.setData({ [`form.learned.${role}`]: on })
  },

  choosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        ui.tick()
        this.setData({ 'form.photo': res.tempFiles[0].tempFilePath })
      },
      fail: (err) => {
        if (!/cancel/.test(err.errMsg || '')) ui.fail(new Error('选图失败，检查一下相册权限'))
      }
    })
  },

  removePhoto() {
    ui.tick()
    this.setData({ 'form.photo': '' })
  },

  save() {
    const f = this.data.form
    const name = f.name.trim()
    if (!name) return ui.toast('菜名还没写')
    this.setData({ saving: true })
    db.upload(f.photo ? [f.photo] : [])
      .then(([photo]) => {
        const doc = { name, category: f.category, learned: f.learned, note: f.note.trim(), photo: photo || '' }
        return this.data.id ? db.update('dishes', this.data.id, doc) : db.add('dishes', doc)
      })
      .then(() => {
        if (this.oldPhoto && this.oldPhoto !== f.photo) db.removeFiles([this.oldPhoto]).catch(() => null)
        ui.tick('medium')
        wx.navigateBack()
      })
      .catch((e) => {
        ui.fail(e)
        this.setData({ saving: false })
      })
  },

  remove() {
    ui.confirm('删除菜品', `确定从菜谱里删除「${this.data.form.name}」吗`, '删除').then((ok) => {
      if (!ok) return
      db.remove('dishes', this.data.id)
        .then(() => wx.navigateBack())
        .catch((e) => ui.fail(e))
    })
  }
})
