// 两个人的身份：键和默认称呼来自 services/settings.js（tools/sync-server.js 从 cloudfunctions/api/settings.js 复制）
// 页面里不要写死某个身份的键，都从这里取
const settings = require('../services/settings')

const ROLES = settings.roles

// 另一个人
const other = (role) => (role === ROLES[0] ? ROLES[1] : ROLES[0])

// 两个人各一份：{ 第一个人: fn(第一个人), 第二个人: fn(第二个人) }
const byRole = (fn) => {
  const out = {}
  ROLES.forEach((r) => {
    out[r] = fn(r)
  })
  return out
}

const defaultNames = byRole((r) => String((settings.names && settings.names[r]) || r))

// 还没选身份时按第一个人显示
const meOr = (me) => (ROLES.indexOf(me) >= 0 ? me : ROLES[0])

// 我在前、对方在后
const pair = (me) => {
  const m = meOr(me)
  return [m, other(m)]
}

module.exports = { ROLES, other, byRole, defaultNames, meOr, pair }
