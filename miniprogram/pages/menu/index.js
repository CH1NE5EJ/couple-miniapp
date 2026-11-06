const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const { CATEGORIES, presetDishes } = require('../../data/dishes')
const refresh = require('../../behaviors/refresh')
const roles = require('../../utils/roles')

const app = getApp()
const CAT = {}
CATEGORIES.forEach((c) => {
  CAT[c.key] = c
})

Page({
  behaviors: [refresh],

  data: {
    tab: 'recipes',
    tabs: [
      { key: 'recipes', label: '菜谱' },
      { key: 'today', label: '今日菜单', badge: 0 }
    ],
    swapDir: 'right',
    cats: [{ key: 'all', label: '全部' }].concat(CATEGORIES),
    cat: 'all',
    who: 'all',
    whos: [],
    names: app.names(),
    groups: [],
    total: 0,
    order: { list: [], count: 0, status: 'open', byText: '' },
    todayText: '',
    rand: { show: false, name: '', sub: '', rolling: false, flip: false },
    loaded: false
  },

  onLoad() {
    this.dishes = []
    this.orderDoc = null
    this.seq = 0
  },

  onShow() {
    ui.showTab(this, 4)
    const names = app.names()
    const t = date.today()
    this.today = t
    this.setData({
      names,
      todayText: `${date.md(t)} ${date.weekday(t)}`,
      whos: [
        { key: 'all', label: '不限' },
        ...roles.ROLES.map((r) => ({ key: r, label: `${names[r]}会做` })),
        { key: 'none', label: '还没人会' }
      ]
    })
    const cachedDishes = db.peek('dishes')
    const cachedOrders = db.peek('orders')
    if (cachedOrders) this.orderDoc = cachedOrders.find((o) => o._id === 'd' + t) || null
    if (cachedDishes && cachedDishes.length) this.setDishes(cachedDishes)

    app
      .requireMember()
      .then((res) => {
        if (!res) return
        return Promise.all([this.loadDishes(res.couple), db.get('orders', 'd' + t)]).then(([dishes, order]) => {
          this.orderDoc = order
          this.setDishes(dishes)
        })
      })
      .catch((e) => ui.fail(e))
  },

  onPullDownRefresh() {
    Promise.all([db.list('dishes'), db.get('orders', 'd' + this.today)])
      .then(([dishes, order]) => {
        this.orderDoc = order
        this.setDishes(dishes)
      })
      .catch((e) => ui.fail(e))
      .then(() => this.stopRefresh())
  },

  // 第一次用：数据库里还没有菜，就写入预设菜谱
  loadDishes(couple) {
    return db.list('dishes').then((list) => {
      if (list.length || (couple && couple.seeded)) return list
      return db.seedDishes(presetDishes())
    })
  },

  setDishes(list) {
    this.dishes = list
    this.render()
  },

  render() {
    const { cat, who } = this.data
    const items = (this.orderDoc && this.orderDoc.items) || {}
    const counts = {}
    Object.keys(items).forEach((id) => {
      counts[id] = items[id].count
    })

    const match = (d) => {
      const l = d.learned || {}
      if (cat !== 'all' && d.category !== cat) return false
      if (roles.ROLES.indexOf(who) >= 0) return !!l[who]
      if (who === 'none') return !roles.ROLES.some((r) => l[r])
      return true
    }

    const names = app.names()
    let n = 0
    const groups = CATEGORIES.map((c) => {
      const dishes = this.dishes
        .filter((d) => d.category === c.key && match(d))
        .map((d) => ({
          _id: d._id,
          name: d.name,
          photo: d.photo || '',
          icon: c.icon,
          // 两个人各一个「会做」开关
          learn: roles.ROLES.map((r) => ({ role: r, name: names[r], on: !!(d.learned && d.learned[r]) })),
          count: counts[d._id] || 0,
          delay: 120 + Math.min(n++, 12) * 40
        }))
      return { key: c.key, label: c.label, dishes }
    }).filter((g) => g.dishes.length)

    this.setData({ groups, total: n, loaded: true })
    this.renderOrder()
  },

  renderOrder() {
    const names = app.names()
    const doc = this.orderDoc
    const items = (doc && doc.items) || {}
    const list = Object.keys(items)
      .map((id) => ({
        _id: id,
        name: items[id].name,
        count: items[id].count,
        at: items[id].at || 0,
        byText: (items[id].by || []).map((r) => names[r] || r).join('、')
      }))
      .sort((a, b) => a.at - b.at)
    const count = list.reduce((s, x) => s + x.count, 0)
    const by = {}
    list.forEach((x) => x.byText.split('、').forEach((n) => n && (by[n] = 1)))
    this.setData({
      order: { list, count, status: (doc && doc.status) || 'open', byText: Object.keys(by).join(' 和 ') },
      'tabs[1].badge': count
    })
  },

  onTab(e) {
    const key = e.detail.key
    this.setData({ tab: key, swapDir: key === 'today' ? 'right' : 'left' })
  },

  pickCat(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.cat) return
    ui.tick()
    this.setData({ cat: key, groups: [] }, () => this.render())
  },

  pickWho(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.who) return
    ui.tick()
    this.setData({ who: key, groups: [] }, () => this.render())
  },

  toggleLearn(e) {
    const { id, role } = e.currentTarget.dataset
    const d = this.dishes.find((x) => x._id === id)
    if (!d) return
    const learned = Object.assign(roles.byRole(() => false), d.learned)
    learned[role] = !learned[role]
    ui.tick(learned[role] ? 'medium' : 'light')
    const before = d.learned
    this.dishes = this.dishes.map((x) => (x._id === id ? Object.assign({}, x, { learned }) : x))
    this.render()
    db.update('dishes', id, { learned }).catch((err) => {
      ui.fail(err, '没保存上')
      this.dishes = this.dishes.map((x) => (x._id === id ? Object.assign({}, x, { learned: before }) : x))
      this.render()
    })
  },

  // 加减菜：本地先变，再以服务器返回为准；连点时只认最后一次返回
  adjust(id, name, delta) {
    ui.tick()
    const doc = this.orderDoc || { _id: 'd' + this.today, date: this.today, items: {}, status: 'open' }
    const items = Object.assign({}, doc.items)
    const cur = items[id]
    const next = (cur ? cur.count : 0) + delta
    const me = app.globalData.me
    if (next <= 0) delete items[id]
    else items[id] = Object.assign({ name, by: [me], at: Date.now() }, cur, { count: next })
    this.orderDoc = Object.assign({}, doc, { items, status: 'open' })
    this.render()

    const seq = ++this.seq
    db.orderItem(this.today, { _id: id, name }, delta)
      .then((fresh) => {
        if (seq !== this.seq) return
        this.orderDoc = fresh
        this.render()
      })
      .catch((err) => ui.fail(err, '没点上，再试一次'))
  },

  inc(e) {
    const { id, name } = e.currentTarget.dataset
    this.adjust(id, name, 1)
  },

  dec(e) {
    const { id, name } = e.currentTarget.dataset
    this.adjust(id, name, -1)
  },

  confirmOrder() {
    if (!this.orderDoc || this.data.order.status === 'done') return
    ui.tick('heavy')
    this.orderDoc = Object.assign({}, this.orderDoc, { status: 'done' })
    this.renderOrder()
    db.update('orders', this.orderDoc._id, { status: 'done' }).catch((err) => ui.fail(err))
  },

  clearOrder() {
    ui.confirm('清空今日菜单', '两个人点的菜都会清掉', '清空').then((ok) => {
      if (!ok || !this.orderDoc) return
      const id = this.orderDoc._id
      this.orderDoc = Object.assign({}, this.orderDoc, { items: {}, status: 'open' })
      this.render()
      db.update('orders', id, { items: {}, status: 'open' }).catch((err) => ui.fail(err))
    })
  },

  // ---------- 帮我们决定 ----------
  openRand() {
    ui.tick('medium')
    this.setData({ 'rand.show': true })
    ui.hideTab(this, true)
    setTimeout(() => this.roll(), 300)
  },

  closeRand() {
    clearTimeout(this.rollTimer)
    this.setData({ 'rand.show': false, 'rand.rolling': false })
    ui.hideTab(this, false)
  },

  roll() {
    const pool = []
    this.data.groups.forEach((g) => g.dishes.forEach((d) => pool.push(d)))
    const source = pool.length ? pool : this.dishes
    if (!source.length) return ui.toast('菜谱里还没有菜')

    // 有人会做的菜权重更高
    const weighted = []
    source.forEach((d) => {
      const w = d.learned && roles.ROLES.some((r) => d.learned[r]) ? 3 : 1
      for (let i = 0; i < w; i++) weighted.push(d)
    })
    const pick = weighted[Math.floor(Math.random() * weighted.length)]
    this.picked = pick

    let step = 0
    const steps = 16
    this.setData({ 'rand.rolling': true })
    const spin = () => {
      step += 1
      const last = step >= steps
      const d = last ? pick : source[Math.floor(Math.random() * source.length)]
      this.setData({ 'rand.name': d.name, 'rand.flip': !this.data.rand.flip })
      if (step % 3 === 0 || last) ui.tick('light')
      if (last) {
        const names = app.names()
        const l = pick.learned || {}
        const can = roles.ROLES.filter((r) => l[r])
        const sub = can.length === 2 ? '两个人都会做' : can.length === 1 ? `${names[can[0]]} 会做` : '还没人会，正好一起学'
        this.setData({ 'rand.rolling': false, 'rand.sub': sub })
        return
      }
      // 越转越慢，像转盘停下来
      this.rollTimer = setTimeout(spin, 45 + step * step * 1.6)
    }
    spin()
  },

  takeRand() {
    if (!this.picked || this.data.rand.rolling) return
    const d = this.picked
    this.closeRand()
    this.adjust(d._id, d.name, 1)
    setTimeout(() => this.setData({ tab: 'today', swapDir: 'right' }), 350)
  },

  // ---------- 跳转 ----------
  editDish(e) {
    ui.tick()
    wx.navigateTo({ url: `/pages/dish-edit/index?id=${e.currentTarget.dataset.id}` })
  },

  addDish() {
    ui.tick('medium')
    const cat = this.data.cat === 'all' ? '' : this.data.cat
    wx.navigateTo({ url: `/pages/dish-edit/index?category=${cat}` })
  },

  goRecipes() {
    this.setData({ tab: 'recipes', swapDir: 'left' })
  },

  goHistory() {
    ui.tick()
    wx.navigateTo({ url: '/pages/orders/index' })
  }
})
