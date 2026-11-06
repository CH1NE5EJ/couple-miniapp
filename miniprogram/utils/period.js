// 经期推算：用最近几次的周期和天数取平均，数据不够时按常见值估计
// 注意：只是按日历推算，周期不规律时误差会很大，不能用来避孕
const date = require('./date')

const DEFAULT_CYCLE = 28
const DEFAULT_LENGTH = 5
const SAMPLE = 6 // 最多看最近 6 次
const OPEN_MAX = 10 // 只记了开始没记结束时，最多当作持续 10 天

const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')

function sorted(periods) {
  return (periods || []).filter((p) => isDate(p.start)).sort((a, b) => (a.start < b.start ? -1 : 1))
}

// 返回 null 表示还没有任何记录
function analyze(periods, today) {
  const t = today || date.today()
  const list = sorted(periods)
  if (!list.length) return null

  // 两次开始日的间隔就是一个周期；明显异常的不算（超过 45 天多半是中间漏记了一次）
  const gaps = []
  for (let i = 1; i < list.length; i++) {
    const g = date.diff(list[i - 1].start, list[i].start)
    if (g >= 15 && g <= 45) gaps.push(g)
  }
  const cycles = gaps.slice(-SAMPLE)
  const cycle = cycles.length ? Math.round(avg(cycles)) : DEFAULT_CYCLE

  const lens = list
    .filter((p) => isDate(p.end))
    .map((p) => date.diff(p.start, p.end) + 1)
    .filter((n) => n >= 1 && n <= 14)
    .slice(-SAMPLE)
  const length = lens.length ? Math.round(avg(lens)) : DEFAULT_LENGTH

  const last = list[list.length - 1]
  const sinceStart = date.diff(last.start, t)
  const ongoing = last.end ? t >= last.start && t <= last.end : sinceStart >= 0 && sinceStart < OPEN_MAX
  const expectedEnd = last.end || date.addDays(last.start, length - 1)

  const nextStart = date.addDays(last.start, cycle)
  const daysUntil = date.diff(t, nextStart)

  return {
    cycle,
    length,
    samples: cycles.length,
    last,
    ongoing,
    dayOfPeriod: ongoing ? sinceStart + 1 : 0,
    expectedEnd,
    nextStart,
    nextEnd: date.addDays(nextStart, length - 1),
    daysUntil,
    late: !ongoing && daysUntil < 0 ? -daysUntil : 0,
    // 晚了超过一个周期，多半是忘了记，不再按“推迟”提示
    stale: !ongoing && daysUntil < 0 && -daysUntil > cycle,
    // 当前周期走到第几天，用来画进度
    progress: Math.max(0, Math.min(1, sinceStart / cycle))
  }
}

// 给日历用：某天是已记录的经期、预测的经期，还是都不是
function dayMarks(periods, info, from, to, today) {
  const t = today || date.today()
  const marks = {}
  const list = sorted(periods)
  list.forEach((p, i) => {
    let end = p.end
    if (!end) {
      // 还没记结束：最后一条按平均天数（不超过今天）铺开，更早的按平均天数
      const len = info ? info.length : DEFAULT_LENGTH
      end = date.addDays(p.start, len - 1)
      if (i === list.length - 1 && info && info.ongoing && t > end) end = t
    }
    for (let d = p.start; d <= end; d = date.addDays(d, 1)) {
      if (d >= from && d <= to) marks[d] = 'period'
    }
  })
  // 预测接下来三次（已经推迟的就不画预测了）
  if (info && !info.late) {
    for (let k = 0; k < 3; k++) {
      const s = date.addDays(info.nextStart, k * info.cycle)
      for (let j = 0; j < info.length; j++) {
        const d = date.addDays(s, j)
        if (d >= from && d <= to && !marks[d]) marks[d] = 'predicted'
      }
    }
  }
  return marks
}

// 某天落在哪条记录里
function recordOn(periods, day, info) {
  const len = info ? info.length : DEFAULT_LENGTH
  return (
    sorted(periods).find((p) => {
      const end = p.end || date.addDays(p.start, Math.max(len, OPEN_MAX) - 1)
      return day >= p.start && day <= end
    }) || null
  )
}

module.exports = { analyze, dayMarks, recordOn, DEFAULT_CYCLE, DEFAULT_LENGTH }
