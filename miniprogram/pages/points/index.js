const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const { RULE_TEXT } = require('../../data/points')
const refresh = require('../../behaviors/refresh')
const roles = require('../../utils/roles')

const app = getApp()
const COSTS = [20, 50, 100, 200, 500]
const KIND_ICON = { task: 'clipboard-check', mood: 'smile', trip: 'map-pin', province: 'map', redeem: 'gift' }

function when(ts) {
  const d = date.fmt(new Date(ts))
  const t = date.today()
  if (d === t) return '今天'
  if (d === date.addDays(t, -1)) return '昨天'
  return date.md(d)
}

Page({
  behaviors: [refresh],

  data: {
    tab: 'rewards',
    tabs: [
      { key: 'rewards', label: '奖励' },
      { key: 'redemptions', label: '兑换', badge: 0 },
      { key: 'ledger', label: '明细' }
    ],
    names: app.names(),
    me: roles.ROLES[0],
    other: roles.ROLES[1],
    balance: { me: 0, other: 0 },
    meShown: 0,
    rules: RULE_TEXT,
    rulesOpen: false,
    theirs: [],
    mine: [],
    toFulfill: [],
    waiting: [],
    done: [],
    ledger: [],
    ledgerWho: 'all',
    loaded: false,
    sheet: { show: false, id: '', title: '', cost: 50, costInput: '', note: '' },
    costs: COSTS
  },

  onShow() {
    const [me, other] = roles.pair(app.globalData.me)
    this.setData({ names: app.names(), me, other })
    this.render()
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => this.stopRefresh())
  },

  refresh() {
    return Promise.all([
      db.bootstrap().then((b) => app.setCouple(b.couple)),
      db.list('rewards'),
      db.list('redemptions'),
      db.list('points', { limit: 300 })
    ])
      .then(() => this.render())
      .catch((e) => ui.fail(e))
  },

  render() {
    const { me, other } = this.data
    const names = app.names()
    const pts = (app.globalData.couple && app.globalData.couple.points) || {}
    const balance = { me: pts[me] || 0, other: pts[other] || 0 }

    const rewards = db.peek('rewards') || []
    const theirs = rewards
      .filter((r) => r.createdBy !== me)
      .map((r) => ({ _id: r._id, title: r.title, note: r.note || '', cost: r.cost, lack: Math.max(0, r.cost - balance.me) }))
      .sort((a, b) => a.cost - b.cost)
    const mine = rewards
      .filter((r) => r.createdBy === me)
      .map((r) => ({ _id: r._id, title: r.title, note: r.note || '', cost: r.cost }))
      .sort((a, b) => a.cost - b.cost)

    const reds = (db.peek('redemptions') || []).map((r) => ({
      _id: r._id,
      title: r.title,
      cost: r.cost,
      byName: names[r.by] || r.by,
      ownerName: names[r.owner] || r.owner,
      when: when(r.createdAt),
      doneWhen: r.fulfilledAt ? when(r.fulfilledAt) : '',
      owner: r.owner,
      by: r.by,
      status: r.status
    }))
    const toFulfill = reds.filter((r) => r.status === 'pending' && r.owner === me)
    const waiting = reds.filter((r) => r.status === 'pending' && r.by === me)
    const done = reds.filter((r) => r.status === 'fulfilled').slice(0, 30)

    const who = this.data.ledgerWho
    const ledger = (db.peek('points', { limit: 300 }) || [])
      .filter((x) => who === 'all' || x.role === (who === 'me' ? me : other))
      .map((x) => ({
        _id: x._id,
        reason: x.reason,
        delta: x.delta,
        plus: x.delta > 0,
        name: names[x.role] || x.role,
        when: when(x.createdAt),
        icon: KIND_ICON[x.kind] || 'coins'
      }))

    this.setData({
      names,
      balance,
      theirs,
      mine,
      toFulfill,
      waiting,
      done,
      ledger,
      'tabs[1].badge': toFulfill.length,
      loaded: true
    })
    if (balance.me !== this.data.meShown) {
      ui.countUp(this.data.meShown, balance.me, 600, (v) => this.setData({ meShown: v }))
    }
  },

  onTab(e) {
    this.setData({ tab: e.detail.key })
  },

  toggleRules() {
    ui.tick()
    this.setData({ rulesOpen: !this.data.rulesOpen })
  },

  pickWho(e) {
    ui.tick()
    this.setData({ ledgerWho: e.currentTarget.dataset.key })
    this.render()
  },

  // ---------- 兑换 ----------
  redeem(e) {
    const r = this.data.theirs.find((x) => x._id === e.currentTarget.dataset.id)
    if (!r) return
    if (r.lack) return ui.toast(`还差 ${r.lack} 分`)
    ui.confirm('兑换奖励', `用 ${r.cost} 积分兑换「${r.title}」？`, '兑换').then((ok) => {
      if (!ok) return
      db.act('redeem', { id: r._id })
        .then(() => {
          ui.tick('heavy')
          ui.toast(`兑换成功，等${this.data.names[this.data.other]}兑现`)
          this.setData({ tab: 'redemptions' })
          return this.refresh()
        })
        .catch((err) => ui.fail(err))
    })
  },

  fulfill(e) {
    const id = e.currentTarget.dataset.id
    ui.tick('medium')
    db.act('fulfill', { id })
      .then(() => this.refresh())
      .catch((err) => ui.fail(err))
  },

  // ---------- 上架奖励（底部弹层） ----------
  openNew() {
    ui.tick('medium')
    this.setData({ sheet: { show: true, id: '', title: '', cost: 50, costInput: '', note: '' } })
  },

  openEdit(e) {
    const r = this.data.mine.find((x) => x._id === e.currentTarget.dataset.id)
    if (!r) return
    ui.tick()
    const preset = COSTS.indexOf(r.cost) >= 0
    this.setData({
      sheet: { show: true, id: r._id, title: r.title, cost: r.cost, costInput: preset ? '' : String(r.cost), note: r.note }
    })
  },

  closeSheet() {
    this.setData({ 'sheet.show': false })
  },

  onSheetInput(e) {
    this.setData({ [`sheet.${e.currentTarget.dataset.name}`]: e.detail.value })
  },

  pickCost(e) {
    ui.tick()
    this.setData({ 'sheet.cost': e.currentTarget.dataset.v, 'sheet.costInput': '' })
  },

  saveReward() {
    const s = this.data.sheet
    const title = s.title.trim()
    if (!title) return ui.toast('写一下奖励是什么')
    const cost = s.costInput ? Math.round(Number(s.costInput)) : s.cost
    if (!(cost >= 1 && cost <= 9999)) return ui.toast('积分要在 1 到 9999 之间')
    const doc = { title, cost, note: s.note.trim() }
    const task = s.id ? db.update('rewards', s.id, doc) : db.add('rewards', doc)
    task
      .then(() => {
        ui.tick('medium')
        this.closeSheet()
        this.render()
      })
      .catch((err) => ui.fail(err))
  },

  removeReward() {
    const s = this.data.sheet
    ui.confirm('下架奖励', `确定下架「${s.title}」吗`, '下架').then((ok) => {
      if (!ok) return
      db.remove('rewards', s.id)
        .then(() => {
          this.closeSheet()
          this.render()
        })
        .catch((err) => ui.fail(err))
    })
  }
})
