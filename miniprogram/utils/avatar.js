// 心情头像：有小人的角色用小人的表情，没有的用图标
// 某个表情还没画时，先用已有的表情顶上，并标记 exact=false（界面上会加一个心情小徽章）
const AVATARS = require('../data/avatars')
const { MOOD } = require('../data/points')

function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * (1 - k)))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function hasAvatar(role) {
  const set = AVATARS[role]
  return !!set && Object.keys(set).length > 0
}

function moodFace(role, moodKey) {
  const m = MOOD[moodKey] || MOOD.calm
  const face = { mood: m.key, label: m.label, icon: m.icon, color: m.color, soft: tint(m.color, 0.2), avatar: '', exact: false }
  if (!hasAvatar(role)) return face
  const set = AVATARS[role]
  face.exact = !!set[m.key]
  face.avatar = set[m.key] || set.happy || set[Object.keys(set)[0]]
  return face
}

module.exports = { moodFace, hasAvatar, tint }
