// 由 tools/sync-server.js 从 miniprogram/utils/date.js 复制，请勿手改
// 日期工具：全部用 'YYYY-MM-DD' 字符串在页面和数据库之间传递，按本地时区计算
const solarLunar = require('./solarlunar').default

const DAY = 86400000
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const pad = (n) => (n < 10 ? '0' + n : '' + n)

function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parse(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function today() {
  return fmt(new Date())
}

function addDays(s, n) {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return fmt(d)
}

// b - a 的天数
function diff(a, b) {
  return Math.round((parse(b) - parse(a)) / DAY)
}

function weekday(s) {
  return WEEK[parse(s).getDay()]
}

function md(s) {
  const d = parse(s)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function ymd(s) {
  const d = parse(s)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function dotted(s) {
  return String(s).replace(/-/g, '.')
}

function lunarOf(s) {
  const d = parse(s)
  const l = solarLunar.solar2lunar(d.getFullYear(), d.getMonth() + 1, d.getDate())
  if (l === -1) return null
  return { year: l.lYear, month: l.lMonth, day: l.lDay, leap: l.isLeap, text: `${l.monthCn}${l.dayCn}` }
}

// 农历某年某月某日 → 公历；那年该月没有三十就取当月最后一天
function lunarToSolar(year, month, day) {
  const max = solarLunar.monthDays(year, month)
  const r = solarLunar.lunar2solar(year, month, Math.min(day, max), false)
  if (r === -1) return null
  return `${r.cYear}-${pad(r.cMonth)}-${pad(r.cDay)}`
}

function solarInYear(s, year) {
  const d = parse(s)
  const m = d.getMonth()
  let day = d.getDate()
  // 2 月 29 日在平年按 2 月 28 日过
  if (m === 1 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) day = 28
  return fmt(new Date(year, m, day))
}

// 计算纪念日下一次（或唯一一次）是哪天
// ann: { date, repeat, calendar: 'solar' | 'lunar', lunarMonth, lunarDay }
function nextOccurrence(ann, from) {
  const base = from || today()
  if (!ann.repeat) {
    const days = diff(base, ann.date)
    return { date: ann.date, days, past: days < 0, nth: 0 }
  }
  const origin = parse(ann.date).getFullYear()
  if (ann.calendar === 'lunar' && ann.lunarMonth) {
    const ly = (lunarOf(base) || { year: parse(base).getFullYear() }).year
    for (let y = ly - 1; y <= ly + 1; y++) {
      const s = lunarToSolar(y, ann.lunarMonth, ann.lunarDay)
      if (s && diff(base, s) >= 0) {
        const originLunar = lunarOf(ann.date)
        return { date: s, days: diff(base, s), past: false, nth: y - (originLunar ? originLunar.year : origin) }
      }
    }
  }
  const y = parse(base).getFullYear()
  let s = solarInYear(ann.date, y)
  if (diff(base, s) < 0) s = solarInYear(ann.date, y + 1)
  return { date: s, days: diff(base, s), past: false, nth: parse(s).getFullYear() - origin }
}

// 在一起第 N 天（开始那天算第 1 天）
function dayCount(since, on) {
  return diff(since, on || today()) + 1
}

const MILESTONES = [
  100, 200, 300, 365, 500, 520, 666, 730, 777, 999, 1000, 1095, 1314, 1460, 1500, 1825, 2000,
  2500, 3000, 3344, 3650, 4000, 5000, 5200, 6666, 7300, 8888, 9999, 10000, 13140
]

// 下一个“第 N 天”里程碑
function nextMilestone(since, on) {
  const now = dayCount(since, on)
  const idx = MILESTONES.findIndex((n) => n >= now)
  if (idx < 0) return null
  const n = MILESTONES[idx]
  const prev = idx > 0 ? MILESTONES[idx - 1] : 1
  return {
    n,
    date: addDays(since, n - 1),
    left: n - now,
    progress: Math.max(0, Math.min(1, (now - prev) / (n - prev)))
  }
}

module.exports = {
  fmt,
  parse,
  today,
  addDays,
  diff,
  weekday,
  md,
  ymd,
  dotted,
  lunarOf,
  lunarToSolar,
  nextOccurrence,
  dayCount,
  nextMilestone
}
