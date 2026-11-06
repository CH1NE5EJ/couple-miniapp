const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const refresh = require('../../behaviors/refresh')
const roles = require('../../utils/roles')

const app = getApp()

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'travel', label: '旅行', icon: 'plane' },
  { key: 'study', label: '学习', icon: 'graduation-cap' },
  { key: 'life', label: '生活', icon: 'house' },
  { key: 'other', label: '其他', icon: 'sparkles' }
]
const CAT = {}
CATEGORIES.forEach((c) => {
  CAT[c.key] = c
})

Page({
  behaviors: [refresh],

  data: {
    categories: CATEGORIES,
    cat: 'all',
    showDone: false,
    plans: [],
    shown: [],
    summary: { doing: 0, done: 0 },
    loaded: false,
    mode: 'plans',
    swapDir: 'left',
    modes: [
      { key: 'plans', label: '计划' },
      { key: 'tasks', label: '任务', badge: 0 }
    ],
    taskGroups: [
      { key: 'confirm', label: '等你确认' },
      { key: 'todo', label: '你要做的' },
      { key: 'waiting', label: '等对方' },
      { key: 'done', label: '已完成' }
    ],
    tasks: { confirm: [], todo: [], waiting: [], done: [], favs: [] },
    taskSummary: { todo: 0, confirm: 0 },
    showTaskDone: false,
    tasksLoaded: false
  },

  onLoad() {
    this.open = {}
  },

  onShow() {
    ui.showTab(this, 3)
    const cached = db.peek('plans')
    if (cached) this.render(cached)
    const cachedTasks = db.peek('tasks')
    if (cachedTasks) this.renderTasks(cachedTasks)
    app
      .requireMember()
      .then((res) => res && Promise.all([db.list('plans').then((list) => this.render(list)), this.loadTasks()]))
      .catch((e) => ui.fail(e))
  },

  onPullDownRefresh() {
    Promise.all([db.list('plans').then((list) => this.render(list)), this.loadTasks()])
      .catch((e) => ui.fail(e))
      .then(() => this.stopRefresh())
  },

  render(list) {
    this.raw = list
    const names = app.names()
    const t = date.today()
    const plans = list.map((p) => {
      const items = p.items || []
      const doneItems = items.filter((x) => x.done).length
      const owner = p.owner === 'both' || !p.owner ? '一起' : names[p.owner] || p.owner
      let due = ''
      let overdue = false
      if (p.due) {
        const left = date.diff(t, p.due)
        overdue = !p.done && left < 0
        due = left === 0 ? '今天截止' : left > 0 ? `${left} 天后截止` : `已过 ${-left} 天`
      }
      return {
        _id: p._id,
        title: p.title,
        desc: p.desc || '',
        category: p.category || 'other',
        catLabel: (CAT[p.category] || CAT.other).label,
        icon: (CAT[p.category] || CAT.other).icon,
        owner,
        due,
        overdue,
        done: !!p.done,
        items,
        total: items.length,
        doneItems,
        progress: items.length ? doneItems / items.length : p.done ? 1 : 0,
        open: !!this.open[p._id],
        dueKey: p.due || '9999-12-31',
        createdAt: p.createdAt || 0,
        doneAt: p.doneAt || 0,
        // 展开高度：每个子任务一行，加上描述和操作区
        openH: items.length * 88 + (p.desc ? Math.ceil(p.desc.length / 20) * 44 + 40 : 0) + 140
      }
    })
    // 未完成在前（有截止日的按截止日），完成的按完成时间
    plans.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (a.done) return b.doneAt - a.doneAt
      if (a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1
      return b.createdAt - a.createdAt
    })
    this.setData({
      plans,
      summary: { doing: plans.filter((p) => !p.done).length, done: plans.filter((p) => p.done).length },
      loaded: true
    })
    this.filter(false)
  },

  filter(replay) {
    const { plans, cat, showDone } = this.data
    const shown = plans.filter((p) => (cat === 'all' || p.category === cat) && (showDone || !p.done))
    if (!replay) return this.setData({ shown })
    this.setData({ shown: [] }, () => setTimeout(() => this.setData({ shown }), 16))
  },

  pickCat(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.cat) return
    ui.tick()
    this.setData({ cat: key })
    this.filter(true)
  },

  toggleShowDone() {
    ui.tick()
    this.setData({ showDone: !this.data.showDone })
    this.filter(true)
  },

  toggleOpen(e) {
    const id = e.currentTarget.dataset.id
    this.open[id] = !this.open[id]
    const i = this.data.shown.findIndex((p) => p._id === id)
    if (i >= 0) this.setData({ [`shown[${i}].open`]: this.open[id] })
  },

  // 乐观更新：界面先变，失败再回滚
  patch(id, patch) {
    const before = this.raw.find((p) => p._id === id)
    const next = this.raw.map((p) => (p._id === id ? Object.assign({}, p, patch) : p))
    this.render(next)
    return db.update('plans', id, patch).catch((err) => {
      ui.fail(err, '没保存上')
      this.render(this.raw.map((p) => (p._id === id ? before : p)))
    })
  },

  toggleDone(e) {
    const id = e.currentTarget.dataset.id
    const p = this.raw.find((x) => x._id === id)
    if (!p) return
    const done = !p.done
    ui.tick(done ? 'medium' : 'light')
    const patch = { done, doneAt: done ? Date.now() : 0 }
    // 整个计划勾完时，子任务也全部勾上
    if (done && p.items && p.items.length) patch.items = p.items.map((x) => Object.assign({}, x, { done: true }))
    this.commit(id, patch)
  },

  // 完成后如果当前不显示已完成：先让勾号播完，再让卡片退场，最后写入
  commit(id, patch) {
    const i = this.data.shown.findIndex((p) => p._id === id)
    if (patch.done && !this.data.showDone && i >= 0) {
      this.setData({ [`shown[${i}].done`]: true, [`shown[${i}].progress`]: 1 })
      setTimeout(() => ui.leave(this, 'shown', id, () => this.patch(id, patch)), 450)
      return
    }
    this.patch(id, patch)
  },

  toggleItem(e) {
    const { id, sid } = e.currentTarget.dataset
    const p = this.raw.find((x) => x._id === id)
    if (!p) return
    ui.tick()
    const items = (p.items || []).map((x) => (x.id === sid ? Object.assign({}, x, { done: !x.done }) : x))
    const allDone = items.length > 0 && items.every((x) => x.done)
    const patch = { items }
    if (allDone !== !!p.done) {
      patch.done = allDone
      patch.doneAt = allDone ? Date.now() : 0
      if (allDone) ui.tick('medium')
    }
    this.commit(id, patch)
  },

  edit(e) {
    ui.tick()
    wx.navigateTo({ url: `/pages/plan-edit/index?id=${e.currentTarget.dataset.id}` })
  },

  toTrip(e) {
    ui.tick('medium')
    const p = this.raw.find((x) => x._id === e.currentTarget.dataset.id)
    wx.navigateTo({ url: `/pages/trip-edit/index?title=${encodeURIComponent((p && p.title) || '')}` })
  },

  // ---------- 任务 ----------
  onMode(e) {
    const mode = e.detail.key
    this.setData({ mode, swapDir: mode === 'tasks' ? 'right' : 'left' })
    if (mode === 'tasks') this.renderTasks(db.peek('tasks') || [])
  },

  renderTasks(list) {
    this.rawTasks = list
    const names = app.names()
    const [me, other] = roles.pair(app.globalData.me)
    const card = (t) => ({
      _id: t._id,
      title: t.title,
      note: t.note || '',
      points: t.points || 0,
      fav: !!t.fav,
      status: t.status,
      forMe: t.assignee === me,
      toText: t.assignee === me ? '给我' : '给' + (names[t.assignee] || t.assignee),
      byText: (names[t.createdBy] || '') + '发布',
      leaving: false
    })
    const sorted = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const confirm = sorted.filter((t) => t.status === 'submitted' && t.assignee !== me).map(card)
    const todo = sorted.filter((t) => t.status === 'open' && t.assignee === me).map(card)
    const waiting = sorted
      .filter((t) => (t.status === 'submitted' && t.assignee === me) || (t.status === 'open' && t.assignee === other))
      .map(card)
    const done = sorted
      .filter((t) => t.status === 'done')
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
      .map(card)
    // 收藏的任务按标题去重，当常用模板
    const seen = {}
    const favs = sorted
      .filter((t) => t.fav && !seen[t.title] && (seen[t.title] = 1))
      .map((t) => ({ _id: t._id, title: t.title, points: t.points || 0 }))
    this.setData({
      tasks: { confirm, todo, waiting, done, favs },
      taskSummary: { todo: todo.length, confirm: confirm.length },
      'modes[1].badge': todo.length + confirm.length,
      tasksLoaded: true
    })
  },

  loadTasks() {
    return db.list('tasks').then((list) => this.renderTasks(list))
  },

  openTask(e) {
    ui.tick()
    wx.navigateTo({ url: `/pages/task-edit/index?id=${e.currentTarget.dataset.id}` })
  },

  // 卡片先退场再刷新列表
  leaveTask(group, id, then) {
    const list = this.data.tasks[group] || []
    const i = list.findIndex((x) => x._id === id)
    if (i >= 0) this.setData({ [`tasks.${group}[${i}].leaving`]: true })
    setTimeout(then, 320)
  },

  submitTask(e) {
    const { id, group } = e.currentTarget.dataset
    ui.tick('medium')
    db.act('taskSubmit', { id })
      .then(() => {
        const other = roles.other(roles.meOr(app.globalData.me))
        ui.toast('等' + app.names()[other] + '确认')
        this.leaveTask(group, id, () => this.loadTasks())
      })
      .catch((err) => ui.fail(err))
  },

  confirmTask(e) {
    const { id, group } = e.currentTarget.dataset
    ui.tick('heavy')
    db.act('taskConfirm', { id, accept: true })
      .then((res) => {
        const a = res && res.award
        if (a) ui.toast(app.names()[a.role] + ' +' + a.delta + ' 积分')
        this.leaveTask(group, id, () => this.loadTasks())
      })
      .catch((err) => ui.fail(err))
  },

  rejectTask(e) {
    const { id, group } = e.currentTarget.dataset
    ui.confirm('还没做好', '任务会回到未完成，对方可以重新提交', '打回').then((ok) => {
      if (!ok) return
      db.act('taskConfirm', { id, accept: false })
        .then(() => this.leaveTask(group, id, () => this.loadTasks()))
        .catch((err) => ui.fail(err))
    })
  },

  toggleFav(e) {
    const id = e.currentTarget.dataset.id
    const t = (this.rawTasks || []).find((x) => x._id === id)
    if (!t) return
    ui.tick()
    db.update('tasks', id, { fav: !t.fav })
      .then(() => this.renderTasks(db.peek('tasks') || []))
      .catch((err) => ui.fail(err))
  },

  // 常用任务一键再发一次
  republish(e) {
    const t = (this.rawTasks || []).find((x) => x._id === e.currentTarget.dataset.id)
    if (!t) return
    const names = app.names()
    ui.confirm('再发一次', `「${t.title}」+${t.points || 0} 分，给${names[t.assignee] || ''}`, '发布').then((ok) => {
      if (!ok) return
      db.add('tasks', { title: t.title, points: t.points, assignee: t.assignee, note: t.note || '', fav: false })
        .then(() => {
          ui.tick('medium')
          return this.loadTasks()
        })
        .catch((err) => ui.fail(err))
    })
  },

  toggleTaskDone() {
    ui.tick()
    this.setData({ showTaskDone: !this.data.showTaskDone })
  },

  add() {
    ui.tick('medium')
    if (this.data.mode === 'tasks') return wx.navigateTo({ url: '/pages/task-edit/index' })
    const cat = this.data.cat === 'all' ? '' : this.data.cat
    wx.navigateTo({ url: `/pages/plan-edit/index?category=${cat}` })
  }
})
