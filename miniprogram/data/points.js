// 积分规则（云函数 cloudfunctions/api/index.js 里的 RULES 是同一份，改的话两边一起改）
const RULES = { mood: 5, trip: 10, province: 20 }

const RULE_TEXT = [
  { icon: 'clipboard-check', text: '完成任务，对方确认后', value: '按任务' },
  { icon: 'smile', text: '每天写下当天的心情', value: `+${RULES.mood}` },
  { icon: 'map-pin', text: '记录一次足迹', value: `+${RULES.trip}` },
  { icon: 'map', text: '第一次点亮一个省份', value: `+${RULES.province}` }
]

// 心情：图标来自 Lucide，颜色都是低饱和度的
const MOODS = [
  { key: 'great', label: '超开心', icon: 'laugh', color: '#E0A43C' },
  { key: 'happy', label: '开心', icon: 'smile', color: '#5CB4E0' },
  { key: 'calm', label: '平静', icon: 'meh', color: '#8FA3B3' },
  { key: 'sad', label: '难过', icon: 'frown', color: '#6C7FB8' },
  { key: 'angry', label: '生气', icon: 'angry', color: '#A9545C' }
]

const MOOD = {}
MOODS.forEach((m) => {
  MOOD[m.key] = m
})

module.exports = { RULES, RULE_TEXT, MOODS, MOOD }
