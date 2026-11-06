const db = require('../../services/db')
const ui = require('../../utils/ui')
const roles = require('../../utils/roles')

const app = getApp()
const POINTS = [5, 10, 20, 50, 100]

Page({
  data: {
    id: '',
    form: { title: '', points: 20, pointsInput: '', assignee: '', note: '', fav: false },
    pointsList: POINTS,
    assignees: [],
    locked: false,
    lockText: '',
    statusText: '',
    focus: '',
    saving: false
  },

  onLoad(q) {
    const names = app.names()
    const [me, other] = roles.pair(app.globalData.me)
    this.me = me
    this.setData({
      assignees: [
        { key: other, label: '给' + names[other] },
        { key: me, label: '给我自己' }
      ],
      'form.assignee': other
    })
    if (q.id) {
      wx.setNavigationBarTitle({ title: '任务' })
      const doc = (db.peek('tasks') || []).find((d) => d._id === q.id)
      if (doc) this.fill(doc)
      else db.get('tasks', q.id).then((d) => d && this.fill(d), (e) => ui.fail(e))
    }
  },

  fill(doc) {
    const preset = POINTS.indexOf(doc.points) >= 0
    let lockText = ''
    if (doc.status !== 'open') lockText = '已经提交或完成的任务，分值和给谁不能再改'
    else if (doc.createdBy !== this.me) lockText = '分值和给谁只有发布的人能改'
    const names = app.names()
    const statusText =
      doc.status === 'done' ? '已完成' : doc.status === 'submitted' ? `${names[doc.assignee]}已提交，等确认` : '还没完成'
    this.setData({
      id: doc._id,
      locked: !!lockText,
      lockText,
      statusText,
      form: {
        title: doc.title || '',
        points: doc.points || 0,
        pointsInput: preset ? '' : String(doc.points || 0),
        assignee: doc.assignee,
        note: doc.note || '',
        fav: !!doc.fav
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

  pickPoints(e) {
    if (this.data.locked) return
    ui.tick()
    this.setData({ 'form.points': e.currentTarget.dataset.v, 'form.pointsInput': '' })
  },

  onAssignee(e) {
    if (this.data.locked) return ui.toast(this.data.lockText)
    this.setData({ 'form.assignee': e.detail.key })
  },

  onFav(e) {
    this.setData({ 'form.fav': e.detail.value })
  },

  save() {
    const f = this.data.form
    const title = f.title.trim()
    if (!title) return ui.toast('写一下任务是什么')
    const points = f.pointsInput ? Math.round(Number(f.pointsInput)) : f.points
    if (!(points >= 0 && points <= 999)) return ui.toast('分值要在 0 到 999 之间')
    const doc = { title, note: f.note.trim(), fav: f.fav }
    if (!this.data.locked) Object.assign(doc, { points, assignee: f.assignee })

    this.setData({ saving: true })
    const task = this.data.id ? db.update('tasks', this.data.id, doc) : db.add('tasks', doc)
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
    ui.confirm('删除任务', `确定删除「${this.data.form.title}」吗？已经发出的积分不会收回`, '删除').then((ok) => {
      if (!ok) return
      db.remove('tasks', this.data.id)
        .then(() => wx.navigateBack())
        .catch((e) => ui.fail(e))
    })
  }
})
