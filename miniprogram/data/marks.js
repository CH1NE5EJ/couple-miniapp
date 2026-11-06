// 日历标记：图标是 Lucide（components/icon），颜色只用 build-icons.js 生成的天蓝和酒红
// 云函数 api 的 MARK_KEYS 是同一份 key，增删类型要两边一起改
const MARKS = [
  { key: 'trip', label: '出远门', icon: 'plane', color: 'accent', hint: '比如 去三亚' },
  { key: 'love', label: '纪念日', icon: 'heart', color: 'wine', hint: '比如 第一次牵手' },
  { key: 'birthday', label: '生日', icon: 'cake', color: 'wine', hint: '比如 妈妈生日' },
  { key: 'date', label: '约会', icon: 'sparkles', color: 'wine', hint: '比如 去吃那家日料' },
  { key: 'show', label: '电影演出', icon: 'ticket', color: 'accent', hint: '比如 看演唱会' },
  { key: 'gift', label: '礼物', icon: 'gift', color: 'wine', hint: '比如 准备一个惊喜' },
  { key: 'home', label: '回家', icon: 'house', color: 'accent', hint: '比如 回老家过节' },
  { key: 'star', label: '重要的事', icon: 'star', color: 'accent', hint: '比如 搬家' }
]

const MARK = {}
MARKS.forEach((m) => {
  MARK[m.key] = m
})

// 纪念日（首页那份）在日历上用各自类型的图标
const ANN_ICON = { love: 'heart', birthday: 'cake', festival: 'gift', other: 'flag' }

// 一个标记最多跨几天（云函数 api 的 MARK_DAYS 是同一个数，改要两边一起改）
const MARK_DAYS = 90

module.exports = { MARKS, MARK, ANN_ICON, MARK_DAYS }
