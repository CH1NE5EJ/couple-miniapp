const db = require('../../services/db')
const date = require('../../utils/date')
const ui = require('../../utils/ui')
const files = require('../../services/files')
const period = require('../../utils/period')
const { MOOD } = require('../../data/points')
const { MARKS, MARK, ANN_ICON, MARK_DAYS } = require('../../data/marks')
const { hasAvatar } = require('../../utils/avatar')
const refresh = require('../../behaviors/refresh')
const roles = require('../../utils/roles')

const app = getApp()
const WEEK = ['一', '二', '三', '四', '五', '六', '日']
// 格子里最多放几个图标，再多的只露一个小点，点开详情看全部
const CELL_ICONS = 2

// 一个月的格子：固定 6 行 7 列，周一开头
function monthCells(ym) {
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const start = date.addDays(date.fmt(first), -offset)
  const cells = []
  for (let i = 0; i < 42; i++) cells.push(date.addDays(start, i))
  return cells
}

function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return date.fmt(d).slice(0, 7)
}

// 纪念日在某段日期里落在哪几天（每年重复的、农历的都算）
function annDays(anns, from, to) {
  const out = {}
  anns.forEach((a) => {
    let cursor = from
    for (let i = 0; i < 3; i++) {
      const occ = date.nextOccurrence(a, cursor)
      if (occ.past || occ.date > to || occ.date < from) break
      // 同一天同名的纪念日只列一次（列表用标题当 key）
      const list = (out[occ.date] = out[occ.date] || [])
      if (!list.some((x) => x.title === a.title)) list.push({ title: a.title, id: a._id || '', icon: ANN_ICON[a.kind] || 'heart' })
      if (!a.repeat) break
      cursor = date.addDays(occ.date, 1)
    }
  })
  return out
}

// 标记落在这段日期里的哪几天：跨天的每一天都算，按开始日、再按添加先后排
function markDays(marks, from, to) {
  const out = {}
  marks
    .filter((m) => MARK[m.type] && m.start && (m.end || m.start) >= from && m.start <= to)
    .sort((a, b) => (a.start === b.start ? (a.createdAt || 0) - (b.createdAt || 0) : a.start < b.start ? -1 : 1))
    .forEach((m) => {
      const last = (m.end || m.start) > to ? to : m.end || m.start
      for (let d = m.start < from ? from : m.start; d <= last; d = date.addDays(d, 1)) {
        ;(out[d] = out[d] || []).push(m)
      }
    })
  return out
}

function markText(d) {
  return `${date.md(d)} ${date.weekday(d)}`
}

Page({
  behaviors: [refresh],

  data: {
    week: WEEK,
    month: '',
    monthTitle: '',
    cells: [],
    anim: '',
    selected: '',
    panel: null,
    isThisMonth: true,
    markTypes: MARKS,
    mark: { show: false, id: '', type: 'trip', title: '', start: '', end: '', startText: '', endText: '', days: 1, hint: '' }
  },

  onLoad() {
    const t = date.today()
    this.diary = []
    this.setData({ month: t.slice(0, 7), selected: t })
  },

  onShow() {
    ui.showTab(this, 1)
    this.today = date.today()
    this.useCache()
    this.render()
    app
      .requireMember()
      .then((res) => {
        if (!res) return
        return this.loadAll().then(() => this.render())
      })
      .catch((e) => ui.fail(e))
  },

  loadAll() {
    return Promise.all([this.loadMonth(), db.list('periods'), db.list('anniversaries'), db.list('marks')])
  },

  onPullDownRefresh() {
    this.loadAll()
      .then(() => this.render())
      .catch((e) => ui.fail(e))
      .then(() => this.stopRefresh())
  },

  range() {
    const cells = monthCells(this.data.month)
    return { field: 'date', from: cells[0], to: cells[41] }
  },

  useCache() {
    this.diary = db.peek('diary', { range: this.range() }) || this.diary || []
  },

  loadMonth() {
    const month = this.data.month
    return db.list('diary', { range: this.range() }).then((list) => {
      if (month === this.data.month) this.diary = list
    })
  },

  render() {
    const t = this.today || date.today()
    const ym = this.data.month
    const cells = monthCells(ym)
    const from = cells[0]
    const to = cells[41]
    const couple = app.globalData.couple || {}
    const anns = (db.peek('anniversaries') || []).slice()
    if (couple.togetherSince) anns.push({ title: '在一起纪念日', date: couple.togetherSince, repeat: true })
    const annMap = annDays(anns, from, to)
    const markMap = markDays(db.peek('marks') || [], from, to)
    const periods = db.peek('periods') || []
    const info = period.analyze(periods, t)
    const marks = period.dayMarks(periods, info, from, to, t)

    const byDate = {}
    this.diary.forEach((d) => {
      ;(byDate[d.date] = byDate[d.date] || {})[d.createdBy] = d
    })
    const [me, other] = roles.pair(app.globalData.me)

    this.setData({
      monthTitle: `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`,
      isThisMonth: ym === t.slice(0, 7),
      cells: cells.map((d) => {
        const e = byDate[d] || {}
        // 纪念日在前、标记在后；同一种图标只放一个（纪念日和爱心标记同一天就一颗心）
        const icons = []
        ;(annMap[d] || []).forEach((a) => icons.push({ icon: a.icon, color: 'wine' }))
        ;(markMap[d] || []).forEach((m) => icons.push({ icon: MARK[m.type].icon, color: MARK[m.type].color }))
        const uniq = icons.filter((x, i) => icons.findIndex((y) => y.icon === x.icon) === i)
        return {
          date: d,
          day: Number(d.slice(8)),
          inMonth: d.slice(0, 7) === ym,
          today: d === t,
          future: d > t,
          selected: d === this.data.selected,
          period: marks[d] || '',
          icons: uniq.slice(0, CELL_ICONS),
          more: uniq.length > CELL_ICONS,
          // 两个人同一种心情时颜色相同，用角色当列表的 key
          moods: [me, other].filter((r) => e[r]).map((r) => ({ role: r, color: (MOOD[e[r].mood] || MOOD.calm).color }))
        }
      })
    })
    this.renderPanel(byDate, annMap, markMap, periods, info)
  },

  renderPanel(byDate, annMap, markMap, periods, info) {
    const d = this.data.selected
    if (!d) return this.setData({ panel: null })
    const t = this.today || date.today()
    const names = app.names()
    const [me, other] = roles.pair(app.globalData.me)
    const e = byDate[d] || {}
    const lunar = date.lunarOf(d)
    const toEntry = (role) => {
      const x = e[role]
      if (!x) return { role, name: names[role], empty: true, mine: role === me }
      const mood = MOOD[x.mood] || MOOD.calm
      return {
        role,
        name: names[role],
        mine: role === me,
        _id: x._id,
        moodLabel: mood.label,
        mood: mood.key,
        avatar: hasAvatar(role),
        text: x.text || '',
        events: x.events || [],
        photos: x.photos || []
      }
    }

    // 经期操作：落在某次记录里、正好在一次没结束的经期之后、或者都不是
    const rec = period.recordOn(periods, d, info)
    const last = periods.length ? periods.slice().sort((a, b) => (a.start < b.start ? 1 : -1))[0] : null
    let per
    if (rec) {
      per = {
        text: `经期第 ${date.diff(rec.start, d) + 1} 天` + (rec.end ? '' : '（还没记结束）'),
        id: rec._id,
        canEnd: !rec.end || rec.end !== d,
        canDelete: true
      }
    } else {
      per = { text: '', canStart: d <= t }
      if (this.data.cells.find((c) => c.date === d && c.period === 'predicted')) per.text = '预测的经期'
    }
    if (last && !last.end && !rec && d > last.start && date.diff(last.start, d) <= 14) {
      per = { text: '上次经期还没记结束', id: last._id, canEnd: true, canStart: false }
    }

    this.setData({
      panel: {
        date: d,
        title: `${date.md(d)} ${date.weekday(d)}`,
        lunar: lunar ? `农历${lunar.text}` : '',
        isToday: d === t,
        future: d > t,
        anns: annMap[d] || [],
        marks: (markMap[d] || []).map((m) => {
          const t = MARK[m.type]
          const days = date.diff(m.start, m.end || m.start) + 1
          return {
            id: m._id,
            icon: t.icon,
            color: t.color,
            text: m.title || t.label,
            range: days > 1 ? `第 ${date.diff(m.start, d) + 1}/${days} 天` : ''
          }
        }),
        period: per,
        entries: [toEntry(me), toEntry(other)]
      }
    })
  },

  // ---------- 交互 ----------
  pick(e) {
    const d = e.currentTarget.dataset.date
    ui.tick()
    if (d.slice(0, 7) !== this.data.month) {
      this.setData({ selected: d })
      return this.go(d < this.data.month ? -1 : 1)
    }
    this.setData({ selected: d })
    this.render()
  },

  prev() {
    this.go(-1)
  },

  next() {
    this.go(1)
  },

  backToday() {
    const t = date.today()
    this.setData({ selected: t })
    const diff = (Number(t.slice(0, 4)) - Number(this.data.month.slice(0, 4))) * 12 + Number(t.slice(5, 7)) - Number(this.data.month.slice(5, 7))
    if (diff) this.go(diff)
    else this.render()
  },

  // 翻月：格子从翻的方向滑进来
  go(n) {
    ui.tick()
    const month = shiftMonth(this.data.month, n)
    const sel = this.data.selected && this.data.selected.slice(0, 7) === month ? this.data.selected : month + '-01'
    this.setData({ month, selected: sel, anim: '' })
    this.useCache()
    this.render()
    setTimeout(() => this.setData({ anim: n > 0 ? 'slide-next' : 'slide-prev' }), 16)
    this.loadMonth()
      .then(() => this.render())
      .catch((e) => ui.fail(e))
  },

  touchStart(e) {
    const t = e.touches[0]
    this.touch = { x: t.clientX, y: t.clientY }
  },

  touchEnd(e) {
    const s = this.touch
    const t = e.changedTouches[0]
    this.touch = null
    if (!s || !t) return
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(dx < 0 ? 1 : -1)
  },

  write() {
    ui.tick('medium')
    const d = this.data.panel && !this.data.panel.future ? this.data.panel.date : date.today()
    wx.navigateTo({ url: `/pages/diary-edit/index?date=${d}` })
  },

  writeToday() {
    ui.tick('medium')
    wx.navigateTo({ url: `/pages/diary-edit/index?date=${date.today()}` })
  },

  preview(e) {
    const { urls, current } = e.currentTarget.dataset
    files.preview(urls, current)
  },

  // ---------- 经期 ----------
  periodStart() {
    const d = this.data.panel.date
    ui.tick('medium')
    db.add('periods', { start: d, end: '' })
      .then(() => this.afterPeriod('记下了经期开始'))
      .catch((e) => ui.fail(e))
  },

  periodEnd() {
    const p = this.data.panel
    ui.tick('medium')
    db.update('periods', p.period.id, { end: p.date })
      .then(() => this.afterPeriod('记下了经期结束'))
      .catch((e) => ui.fail(e))
  },

  periodDelete() {
    const p = this.data.panel
    ui.confirm('删除这次经期记录', '删除后预测会重新计算', '删除').then((ok) => {
      if (!ok) return
      db.remove('periods', p.period.id)
        .then(() => this.afterPeriod('已删除'))
        .catch((e) => ui.fail(e))
    })
  },

  afterPeriod(msg) {
    return db.list('periods').then(() => {
      this.render()
      ui.toast(msg)
    })
  },

  // 点纪念日：去编辑（在一起纪念日是设置里的日期，没有编号，不跳）
  openAnn(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    ui.tick()
    wx.navigateTo({ url: `/pages/anniversary-edit/index?id=${id}` })
  },

  // ---------- 标记（底部弹层） ----------
  openMark(m) {
    const t = MARK[m.type] || MARKS[0]
    this.setData({
      mark: {
        show: true,
        id: m._id || '',
        type: t.key,
        title: m.title || '',
        start: m.start,
        end: m.end || m.start,
        startText: markText(m.start),
        endText: markText(m.end || m.start),
        days: date.diff(m.start, m.end || m.start) + 1,
        hint: t.hint
      }
    })
    ui.hideTab(this, true)
  },

  newMark() {
    ui.tick('medium')
    this.openMark({ type: 'trip', start: this.data.panel.date })
  },

  editMark(e) {
    const m = (db.peek('marks') || []).find((x) => x._id === e.currentTarget.dataset.id)
    if (!m) return
    ui.tick()
    this.openMark(m)
  },

  closeMark() {
    this.setData({ 'mark.show': false })
    ui.hideTab(this, false)
  },

  pickType(e) {
    const t = MARK[e.currentTarget.dataset.key]
    ui.tick()
    this.setData({ 'mark.type': t.key, 'mark.hint': t.hint })
  },

  onMarkTitle(e) {
    this.setData({ 'mark.title': e.detail.value })
  },

  // 改了开始日：结束日跟着平移，保持原来的天数
  onMarkStart(e) {
    const start = e.detail.value
    const end = date.addDays(start, this.data.mark.days - 1)
    this.setData({ 'mark.start': start, 'mark.end': end, 'mark.startText': markText(start), 'mark.endText': markText(end) })
  },

  onMarkEnd(e) {
    const s = this.data.mark
    const end = e.detail.value < s.start ? s.start : e.detail.value
    this.setData({ 'mark.end': end, 'mark.endText': markText(end), 'mark.days': date.diff(s.start, end) + 1 })
  },

  saveMark() {
    const s = this.data.mark
    if (this.savingMark) return
    if (s.days > MARK_DAYS) return ui.toast(`一个标记最多跨 ${MARK_DAYS} 天`)
    const doc = { type: s.type, title: s.title.trim(), start: s.start, end: s.end }
    this.savingMark = true
    const task = s.id ? db.update('marks', s.id, doc) : db.add('marks', doc)
    task
      .then(() => {
        ui.tick('medium')
        this.closeMark()
        this.render()
      })
      .catch((err) => ui.fail(err))
      .then(() => {
        this.savingMark = false
      })
  },

  removeMark() {
    const s = this.data.mark
    ui.confirm('删除标记', `确定删除「${s.title.trim() || MARK[s.type].label}」吗`, '删除').then((ok) => {
      if (!ok) return
      db.remove('marks', s.id)
        .then(() => {
          this.closeMark()
          this.render()
        })
        .catch((err) => ui.fail(err))
    })
  },

  // 爱心想每年都记得：换成正式的纪念日（首页倒数、前一天提醒），带上日期和写好的名字
  markToAnniversary() {
    const s = this.data.mark
    ui.tick()
    this.closeMark()
    wx.navigateTo({ url: `/pages/anniversary-edit/index?date=${s.start}&title=${encodeURIComponent(s.title.trim())}` })
  }
})
