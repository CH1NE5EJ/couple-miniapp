const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')

const app = getApp()

Page({
  data: { list: [], loaded: false },

  onShow() {
    const cached = db.peek('orders')
    if (cached) this.render(cached)
    db.list('orders')
      .then((list) => this.render(list))
      .catch((e) => ui.fail(e))
  },

  render(orders) {
    const names = app.names()
    const t = date.today()
    const list = orders
      .filter((o) => o.items && Object.keys(o.items).length)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((o) => {
        const items = Object.keys(o.items).map((id) => o.items[id])
        const by = {}
        items.forEach((x) => (x.by || []).forEach((r) => (by[names[r] || r] = 1)))
        const ago = date.diff(o.date, t)
        return {
          _id: o._id,
          day: date.md(o.date),
          week: date.weekday(o.date),
          ago: ago === 0 ? '今天' : ago === 1 ? '昨天' : `${ago} 天前`,
          dishes: items.map((x) => (x.count > 1 ? `${x.name} ×${x.count}` : x.name)),
          by: Object.keys(by).join(' 和 '),
          done: o.status === 'done'
        }
      })
    this.setData({ list, loaded: true })
  }
})
