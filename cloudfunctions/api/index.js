// 云函数 api：小程序的所有读写都从这里走，只有绑定过身份的两个人能用
const cloud = require('wx-server-sdk')
// 每个部署自己的设置：两个人的身份键、默认称呼、通知模板（settings.js，只放数据）
const SETTINGS = require('./settings')
// 日期、经期推算和小程序端用同一份（tools/sync-server.js 从 miniprogram/utils 复制过来）
// 平铺在云函数根目录：在 Windows 上用命令行部署，子目录里的文件云端找不到；只有每天的提醒用到，用到时才加载
const utils = () => ({ date: require('./date'), period: require('./period') })

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTIONS = [
  'couple', 'trips', 'plans', 'dishes', 'orders', 'anniversaries',
  'tasks', 'rewards', 'redemptions', 'points', 'diary', 'periods', 'logs', 'marks'
]
const DATA = COLLECTIONS.slice(1)
// 积分流水和兑换记录只能通过专门的操作写入，通用增删改一律拒绝
const SERVER_ONLY = ['points', 'redemptions', 'logs']
// 只有创建者本人能改、能删
const OWNER_ONLY = ['diary', 'rewards']
const ROLES = SETTINGS.roles
// 身份键会出现在数据路径（points.<键>）和点菜筛选里：只能用字母、数字、_、-，也不能叫 all、none
const okRole = (r) => typeof r === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(r) && r !== 'all' && r !== 'none'
if (!Array.isArray(ROLES) || ROLES.length !== 2 || ROLES[0] === ROLES[1] || !ROLES.every(okRole)) {
  throw new Error('settings.js 里的 roles 要是两个不同的键，只能用字母、数字、_ 和 -，也不能叫 all 或 none')
}
const LOCKED = ['_id', '_openid', 'createdAt', 'createdBy']
const OPEN_ACTIONS = ['bootstrap', 'bind']
// 已存储文件的前缀：云端是云存储 fileID（本机预览模式会被替换成本地照片目录）
const FILE_PREFIX = 'cloud://'
// 集合有新增时把版本号加一，已经初始化过的环境会自动补建
const SCHEMA = 5

// 积分规则（小程序端 data/points.js 里有同一份，用来展示）
const RULES = { mood: 5, trip: 10, province: 20 }
const TASK_MAX = 999
// 心情只认这 5 种（小程序端 data/points.js 的 MOODS 是同一份）
const MOOD_KEYS = ['great', 'happy', 'calm', 'sad', 'angry']
const REWARD_MAX = 9999
// 日历标记只认这几种（小程序端 data/marks.js 是同一份），一个标记最多跨这么多天
const MARK_KEYS = ['trip', 'love', 'birthday', 'date', 'show', 'gift', 'home', 'star']
const MARK_DAYS = 90

// 微信通知（订阅消息）：模板 ID 和字段在 settings.js 里填，ID 空着的那类不发
// 发之前按字段类型截断、换格式，不合规则微信会拒发
const NOTIFY = SETTINGS.notify || {}
const NOTIFY_KINDS = Object.keys(NOTIFY)
// 点通知打开哪个版本：trial 体验版、formal 正式版、developer 开发版
const NOTIFY_STATE = SETTINGS.notifyState || 'trial'
// 对方连着点好几道菜：30 分钟内只通知一次
const ORDER_QUIET = 30 * 60 * 1000

function fail(code, msg) {
  const e = new Error(msg)
  e.code = code
  return e
}

const other = (role) => (role === ROLES[0] ? ROLES[1] : ROLES[0])
// 两个人各一份：{ 第一个人: fn(第一个人), 第二个人: fn(第二个人) }
const byRole = (fn) => ({ [ROLES[0]]: fn(ROLES[0]), [ROLES[1]]: fn(ROLES[1]) })
const defaultName = (role) => String((SETTINGS.names && SETTINGS.names[role]) || role)
const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)))
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '')
const isFile = (f) => typeof f === 'string' && f.indexOf(FILE_PREFIX) === 0

// 云函数跑在 UTC，按北京时间算“今天”
function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function clean(obj) {
  const out = {}
  Object.keys(obj || {}).forEach((k) => {
    if (!LOCKED.includes(k) && k !== '_awards') out[k] = obj[k]
  })
  return out
}

function checkCollection(name, write) {
  if (!DATA.includes(name)) throw fail('bad-collection', '未知的数据集合')
  if (write && SERVER_ONLY.includes(name)) throw fail('read-only', '这类记录不能直接修改')
}

function checkOwner(collection, doc, ctx) {
  if (OWNER_ONLY.includes(collection) && doc.createdBy && doc.createdBy !== ctx.me) {
    throw fail('not-owner', '只能改自己的')
  }
}

// 各集合的字段规则：任务状态只能走专门的操作，积分和价格限定范围
function sanitize(collection, doc, current, me) {
  const d = clean(doc)
  // 足迹的点评只能通过 tripReview 各写各的，编辑足迹时不能动；basePhotos / triedPhotos 只用来核对，不存
  if (collection === 'trips') {
    delete d.reviews
    delete d.basePhotos
    delete d.triedPhotos
    delete d.updatedBy
  }
  // 足迹缩略图 [{ p: 原图, t: 缩略图 }]：只认已存储的文件，而且原图要在这条足迹里
  if (collection === 'trips' && 'thumbs' in d) {
    const photos = d.photos || (current && current.photos) || []
    d.thumbs = (Array.isArray(d.thumbs) ? d.thumbs : [])
      .filter((x) => x && isFile(x.p) && isFile(x.t) && photos.includes(x.p))
      .map((x) => ({ p: x.p, t: x.t }))
  }
  if (collection === 'tasks') {
    delete d.status
    delete d.submittedAt
    delete d.doneAt
    if ('points' in d) d.points = clampInt(d.points, 0, TASK_MAX)
    if ('assignee' in d && !ROLES.includes(d.assignee)) delete d.assignee
    // 分值和执行人只有发布的人能改，而且只能在任务还没完成时改
    if (current && (current.status !== 'open' || current.createdBy !== me)) {
      delete d.points
      delete d.assignee
    }
  }
  if (collection === 'rewards' && 'cost' in d) d.cost = clampInt(d.cost, 1, REWARD_MAX)
  // 经期：开始日必须是日期，结束日可以留空（还没结束），结束不能早于开始
  if (collection === 'periods') {
    if ('start' in d && !isDate(d.start)) delete d.start
    if ('end' in d && d.end !== '' && !isDate(d.end)) delete d.end
    const start = d.start || (current && current.start)
    if (d.end && start && d.end < start) throw fail('bad-date', '结束日不能早于开始日')
  }
  // 日历标记：类型只认那几种；结束日空着就是当天，不能早于开始，最多跨 MARK_DAYS 天
  if (collection === 'marks') {
    if ('type' in d && !MARK_KEYS.includes(d.type)) throw fail('bad-type', '不认识这种标记')
    if ('title' in d) d.title = String(d.title || '').trim().slice(0, 20)
    if ('start' in d && !isDate(d.start)) throw fail('bad-date', '日期不对')
    if ('end' in d && d.end !== '' && !isDate(d.end)) throw fail('bad-date', '日期不对')
    const start = d.start || (current && current.start)
    if ('end' in d && !d.end) d.end = start
    const end = d.end || (current && current.end)
    if (start && end && end < start) throw fail('bad-date', '结束日不能早于开始日')
    if (start && end && (Date.parse(end) - Date.parse(start)) / 86400000 >= MARK_DAYS) {
      throw fail('bad-date', `一个标记最多跨 ${MARK_DAYS} 天`)
    }
  }
  return d
}

const sameSet = (a, b) => a.length === b.length && a.every((p) => b.includes(p))

// 编辑足迹时带着打开那一刻的照片列表（basePhotos）：和现在的对不上，说明对方在这期间加过或删过照片，
// 按旧列表保存会把对方的照片弄丢，所以拒绝，让用户重新打开再改（只比较有哪些照片，不管顺序）
// 这些情况放行：现在的照片就是这次要存的，或者是这一页之前某次提交过的（triedPhotos：上一次其实存上了、只是回应丢了）
// 返回 true 表示核对过（只有核对过的保存，云函数才会替它删掉移出去的照片文件）
function checkBasePhotos(collection, patch, current) {
  if (collection !== 'trips' || !patch) return false
  const now = current.photos || []
  // 旧版本小程序不带核对信息：照片没变（只改文字、调顺序）照常；改了照片就请它先更新，免得按旧列表弄丢对方的照片
  if (!Array.isArray(patch.basePhotos)) {
    if (Array.isArray(patch.photos) && !sameSet(now, patch.photos)) throw fail('upgrade', '请先更新小程序，再改足迹的照片')
    return false
  }
  const tried = Array.isArray(patch.triedPhotos) ? patch.triedPhotos.filter(Array.isArray).slice(-5) : []
  const known = [patch.basePhotos].concat(tried, Array.isArray(patch.photos) ? [patch.photos] : [])
  if (known.some((list) => sameSet(now, list))) return true
  throw fail('conflict', '对方刚改过这条足迹的照片，返回重新打开再改')
}

// 足迹改了照片：缩略图跟着照片列表走
// 核对过的保存（新版本）：移出这条足迹的原图和缩略图都没人用了，返回它们，更新完由调用方删掉文件
// 没核对的（旧版本小程序，不带 basePhotos，可能拿着旧列表）：什么都不删，缩略图记录也原样留着，免得删掉对方刚加的照片
function tripThumbs(patch, current, checked) {
  if (!('photos' in patch)) return []
  const before = (current.thumbs || []).filter((x) => x && isFile(x.t))
  if (!checked) {
    const given = 'thumbs' in patch ? patch.thumbs : []
    const has = new Set(given.map((x) => x.t))
    patch.thumbs = given.concat(before.filter((x) => !has.has(x.t)).map((x) => ({ p: x.p, t: x.t })))
    return []
  }
  const keep = new Set(patch.photos || [])
  if (!('thumbs' in patch)) patch.thumbs = before.filter((x) => keep.has(x.p)).map((x) => ({ p: x.p, t: x.t }))
  const used = new Set(patch.thumbs.map((x) => x.t))
  const thumbs = before.filter((x) => !keep.has(x.p) && !used.has(x.t)).map((x) => x.t)
  const originals = (current.photos || []).filter((p) => isFile(p) && !keep.has(p))
  return thumbs.concat(originals)
}

// 新建足迹的重试命中了已经存上的那一条：
// 对方在这期间改过它 -> 拒绝（按这一页的内容覆盖会弄丢对方的改动）；没人动过 -> 按这次提交的内容更新
// 积分按“每条足迹 / 每个省份”记账，重新走一遍也不会重复加，第一次没来得及加的这次补上
async function retryAdd(existing, ev, ctx) {
  if (existing.updatedBy && existing.updatedBy !== ctx.me) {
    throw fail('conflict', '这条足迹已经存上了，对方也改过，返回刷新看看')
  }
  const patch = Object.assign({}, ev.doc, { basePhotos: [] })
  const fresh = await handlers.update({ collection: 'trips', id: existing._id, patch }, ctx)
  const saved = Object.assign({}, existing, fresh)
  const awards = (await afterAdd('trips', saved, ctx)).filter(Boolean)
  return awards.length ? Object.assign({ _awards: awards }, saved) : saved
}

async function getDoc(collection, id) {
  try {
    const res = await db.collection(collection).doc(id).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

// 第一次调用时自动建集合和 couple/main 文档，省去控制台手动配置
async function ensureCouple() {
  let couple = await getDoc('couple', 'main')
  if (couple && couple.schema >= SCHEMA) return couple
  await Promise.all(COLLECTIONS.map((c) => db.createCollection(c).catch(() => null)))
  if (couple) {
    await db.collection('couple').doc('main').update({ data: { schema: SCHEMA } })
    couple.schema = SCHEMA
    return couple
  }
  try {
    await db.collection('couple').add({
      data: {
        _id: 'main',
        members: [],
        names: byRole(defaultName),
        togetherSince: '',
        togetherTime: '',
        points: byRole(() => 0),
        seeded: false,
        schema: SCHEMA,
        createdAt: Date.now()
      }
    })
  } catch (e) {
    // 另一台手机同时在初始化，以已经存在的为准
  }
  couple = await getDoc('couple', 'main')
  if (!couple) throw fail('init', '初始化数据库失败')
  return couple
}

// 每个人每类通知还能收几条（订阅一次加一条，发出去一条减一条）
function subsOf(couple, role) {
  const s = (couple.subs && couple.subs[role]) || {}
  const out = {}
  NOTIFY_KINDS.forEach((k) => {
    out[k] = Math.max(0, Number(s[k]) || 0)
  })
  return out
}

function view(couple, openid) {
  const member = couple.members.find((m) => m.openid === openid)
  const p = couple.points || {}
  return {
    me: member ? member.role : null,
    couple: {
      names: couple.names,
      togetherSince: couple.togetherSince,
      togetherTime: couple.togetherTime || '',
      cover: couple.cover || '',
      points: byRole((r) => p[r] || 0),
      seeded: !!couple.seeded,
      roles: couple.members.map((m) => m.role),
      notify: {
        ids: NOTIFY_KINDS.filter((k) => NOTIFY[k].id).map((k) => ({ kind: k, id: NOTIFY[k].id })),
        subs: byRole((r) => subsOf(couple, r))
      }
    }
  }
}

// ---------- 微信通知 ----------
const pad2 = (n) => (n < 10 ? '0' + n : '' + n)
const cnDate = (s) => {
  const [y, m, d] = String(s).split('-').map(Number)
  return `${y}年${m}月${d}日`
}
// 北京时间的日期和钟点
function cnClock(ms) {
  const d = new Date(ms + 8 * 3600 * 1000)
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    clock: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  }
}

// 按模板字段类型整理内容（类型就是字段名去掉数字：thing、time、phrase……），规则见订阅消息文档
function fieldValue(type, v) {
  if (type === 'time' || type === 'date') {
    const t = typeof v === 'number' ? cnClock(v) : { date: isDate(v) ? v : cnClock(Date.now()).date, clock: '09:00' }
    return type === 'time' ? `${cnDate(t.date)} ${t.clock}` : cnDate(t.date)
  }
  // 表情符号（四字节字符、变体选择符）模板字段不一定收，去掉
  const s = String(v == null ? '' : v)
    .replace(/[\uD800-\uDFFF️‍]/g, '')
    .trim()
  if (type === 'phrase') return s.replace(/[^一-龥]/g, '').slice(0, 5) || '提醒'
  if (type === 'name') {
    // 10 个以内纯汉字，或 20 个以内纯字母符号；混着写的只留汉字
    if (!/[一-龥]/.test(s)) return s.slice(0, 20) || '对方'
    return s.replace(/[^一-龥]/g, '').slice(0, 10) || '对方'
  }
  if (type === 'short_thing') return s.slice(0, 5) || '提醒'
  if (type === 'number') return (s.match(/\d+(\.\d+)?/) || ['0'])[0].slice(0, 32)
  if (type === 'character_string') return s.replace(/[^\x21-\x7e]/g, '').slice(0, 32) || '-'
  return s.slice(0, 20) || '-'
}

function fillTemplate(fields, msg) {
  const data = {}
  Object.keys(fields || {}).forEach((key) => {
    data[key] = { value: fieldValue(key.replace(/\d+$/, ''), msg[fields[key]]) }
  })
  return data
}

// 给 role 发一条通知；没配置模板、这类已经没有剩余条数就不发。发出去扣一条；对方关掉了通知（43101）清零
// 通知发不出去不影响本来的操作，失败记到 logs 方便排查
async function notify(couple, role, kind, msg) {
  const t = NOTIFY[kind]
  const member = couple.members.find((m) => m.role === role)
  if (!t || !t.id || !member) return null
  const subs = (couple.subs = couple.subs || {})
  const mine = (subs[role] = subs[role] || {})
  if (!(mine[kind] > 0)) return null
  const key = `subs.${role}.${kind}`
  const content = Object.assign({ time: Date.now(), date: cnClock(Date.now()).date }, msg)
  const base = {
    touser: member.openid,
    templateId: t.id,
    data: fillTemplate(t.fields, content),
    miniprogramState: NOTIFY_STATE,
    lang: 'zh_CN'
  }
  try {
    try {
      await cloud.openapi.subscribeMessage.send(Object.assign({ page: msg.page }, base))
    } catch (e) {
      // 跳转的页面要在线上版本里存在（41030）：还没发布正式版时去掉跳转再发
      if (e.errCode !== 41030 || !msg.page) throw e
      await cloud.openapi.subscribeMessage.send(base)
    }
  } catch (e) {
    if (e.errCode === 43101) {
      mine[kind] = 0
      await db.collection('couple').doc('main').update({ data: { [key]: 0 } }).catch(() => null)
    } else {
      const detail = `${e.errCode || ''} ${e.errMsg || e.message || ''}`.slice(0, 400)
      await db.collection('logs')
        .add({ data: { event: 'notify-failed', detail, sys: kind, by: role, createdAt: Date.now() } })
        .catch(() => null)
    }
    return false
  }
  mine[kind] -= 1
  await db.collection('couple').doc('main').update({ data: { [key]: _.inc(-1) } }).catch(() => null)
  return true
}

const nameOf = (couple, role) => (couple.names && couple.names[role]) || role

// 发布或改派的任务是给对方的
async function notifyAssigned(ctx, task) {
  if (!task.assignee || task.assignee === ctx.me || task.status !== 'open') return
  const who = nameOf(ctx.couple, ctx.me)
  await notify(ctx.couple, task.assignee, 'task', {
    title: task.title,
    who,
    note: task.points > 0 ? `${who}给你派了任务，完成得 ${task.points} 分` : `${who}给你派了任务`,
    status: '新任务',
    page: 'pages/plans/index'
  })
}

// 对方点了菜：30 分钟内连着点只通知第一道
async function notifyOrder(ctx, day, dishName) {
  const to = other(ctx.me)
  const last = (ctx.couple.quiet && ctx.couple.quiet[to]) || 0
  if (Date.now() - last < ORDER_QUIET) return
  const who = nameOf(ctx.couple, ctx.me)
  const sent = await notify(ctx.couple, to, 'order', {
    title: dishName || '新的菜',
    who,
    note: `${who}在点菜，去看看今天的菜单`,
    status: '点菜啦',
    date: day,
    page: 'pages/menu/index'
  })
  if (sent) await db.collection('couple').doc('main').update({ data: { ['quiet.' + to]: Date.now() } })
}

// 每天早上（定时触发器）：明天是纪念日或在一起第 N 天、经期预计后天开始，两个人都提醒
function reminders(couple, anns, periods, today) {
  const { date, period } = utils()
  const tomorrow = date.addDays(today, 1)
  const list = anns.filter((a) => isDate(a.date))
  if (isDate(couple.togetherSince)) list.push({ title: '在一起纪念日', kind: 'love', date: couple.togetherSince, repeat: true })
  const out = []
  list.forEach((a) => {
    const occ = date.nextOccurrence(a, tomorrow)
    if (occ.days !== 0) return
    const nth = a.repeat && occ.nth > 0 ? (a.kind === 'birthday' ? `${occ.nth} 岁` : `${occ.nth} 周年`) : ''
    const note = `明天 ${date.md(tomorrow)}${nth ? '，' + nth : ''}`
    out.push({ title: a.title || '纪念日', note, status: '明天', date: tomorrow, page: 'pages/home/index' })
  })
  if (isDate(couple.togetherSince)) {
    const m = date.nextMilestone(couple.togetherSince, tomorrow)
    if (m && m.left === 0) {
      out.push({ title: `在一起第 ${m.n} 天`, note: `明天 ${date.md(tomorrow)}`, status: '明天', date: tomorrow, page: 'pages/home/index' })
    }
  }
  const info = period.analyze(periods, today)
  if (info && !info.ongoing && info.daysUntil === 2) {
    const note = `预计 ${date.md(info.nextStart)} 开始，提前准备一下`
    out.push({ title: '经期预计后天开始', note, status: '快到了', date: info.nextStart, page: 'pages/calendar/index' })
  }
  return out
}

async function upcoming(couple, today) {
  const [anns, periods] = await Promise.all([
    db.collection('anniversaries').limit(1000).get(),
    db.collection('periods').limit(1000).get()
  ])
  return reminders(couple, anns.data, periods.data, today)
}

// 同一天只跑一次（触发器偶尔会重复触发）
async function daily() {
  const couple = await ensureCouple()
  const today = todayCN()
  if (couple.remindedOn === today) return []
  await db.collection('couple').doc('main').update({ data: { remindedOn: today } })
  const items = await upcoming(couple, today)
  // 同时发：云函数超时只有 3 秒，一条条等着发，冷启动时后面的可能来不及
  // （某人剩余条数不够时多发的那几条会被微信拒收，条数随之清零）
  const jobs = []
  couple.members.forEach((m) => {
    items.forEach((item) => {
      jobs.push(notify(couple, m.role, 'remind', item).then((ok) => ({ to: m.role, title: item.title, ok })))
    })
  })
  return Promise.all(jobs)
}

// 记一笔积分：流水的 _id 用业务键（某任务、某人某天的心情……），
// 同一件事重复记账会因为主键冲突直接失败，天然防重复加分
async function award(role, key, delta, reason, kind) {
  if (!delta || !ROLES.includes(role)) return null
  try {
    await db.collection('points').add({ data: { _id: key, role, delta, reason, kind, createdAt: Date.now() } })
  } catch (e) {
    return null
  }
  await db.collection('couple').doc('main').update({ data: { ['points.' + role]: _.inc(delta) } })
  return { role, delta, reason }
}

// 写心情、记足迹之后自动加分
async function afterAdd(collection, doc, ctx) {
  const out = []
  if (collection === 'diary' && doc.date === todayCN()) {
    out.push(await award(ctx.me, `mood:${ctx.me}:${doc.date}`, RULES.mood, '写下今天的心情', 'mood'))
  }
  if (collection === 'trips') {
    out.push(await award(ctx.me, `trip:${doc._id}`, RULES.trip, '记录一次足迹', 'trip'))
    if (doc.scope !== 'abroad' && doc.provinceCode) {
      const { total } = await db.collection('trips').where({ provinceCode: doc.provinceCode }).count()
      if (total === 1) {
        out.push(
          await award(ctx.me, `province:${doc.provinceCode}`, RULES.province, `第一次点亮${doc.province || '新省份'}`, 'province')
        )
      }
    }
  }
  return out.filter(Boolean)
}

const handlers = {
  bootstrap(ev, ctx) {
    return view(ctx.couple, ctx.openid)
  },

  async bind(ev, ctx) {
    const { couple, openid } = ctx
    if (!ROLES.includes(ev.role)) throw fail('bad-role', '身份不对')
    const taken = couple.members.find((m) => m.role === ev.role && m.openid !== openid)
    if (taken) throw fail('role-taken', '这个身份已经被另一个微信绑定了')
    const others = couple.members.filter((m) => m.openid !== openid)
    if (others.length >= 2) throw fail('full', '这里只属于两个人')
    const members = others.concat({ openid, role: ev.role, at: Date.now() })
    await db.collection('couple').doc('main').update({ data: { members: _.set(members) } })
    couple.members = members
    return view(couple, openid)
  },

  async unbind(ev, ctx) {
    const { couple, openid } = ctx
    const members = couple.members.filter((m) => m.openid !== openid)
    await db.collection('couple').doc('main').update({ data: { members: _.set(members) } })
    couple.members = members
    return view(couple, openid)
  },

  async saveCouple(ev, ctx) {
    const src = ev.patch || {}
    const patch = {}
    if (typeof src.togetherSince === 'string') patch.togetherSince = src.togetherSince.slice(0, 10)
    // 在一起的具体时刻（HH:mm），空字符串表示没填
    if (typeof src.togetherTime === 'string' && /^(\d{2}:\d{2})?$/.test(src.togetherTime)) {
      patch.togetherTime = src.togetherTime
    }
    // 首页封面：云存储 fileID，空字符串表示移除
    if (typeof src.cover === 'string' && (src.cover === '' || src.cover.indexOf(FILE_PREFIX) === 0)) {
      patch.cover = src.cover.slice(0, 300)
    }
    if (src.names) {
      patch.names = byRole((r) => String(src.names[r] || defaultName(r)).slice(0, 12))
    }
    const data = Object.assign({}, patch)
    if (data.names) data.names = _.set(data.names)
    await db.collection('couple').doc('main').update({ data })
    // 重新读一次再返回：两个保存请求同时发出时，不会拿开始时的旧数据覆盖界面
    const fresh = (await getDoc('couple', 'main')) || Object.assign(ctx.couple, patch)
    return view(fresh, ctx.openid).couple
  },

  // 可选：limit 条数；range 按 date 字段取一段（日历按月取心情）
  async list(ev) {
    checkCollection(ev.collection)
    let q = db.collection(ev.collection)
    const r = ev.range
    if (r && r.field === 'date' && isDate(r.from) && isDate(r.to)) {
      q = q.where({ date: _.gte(r.from).and(_.lte(r.to)) })
    }
    const limit = clampInt(ev.limit || 1000, 1, 1000)
    const res = await q.orderBy('createdAt', 'desc').limit(limit).get()
    return res.data
  },

  async get(ev) {
    checkCollection(ev.collection)
    return getDoc(ev.collection, ev.id)
  },

  async add(ev, ctx) {
    checkCollection(ev.collection, true)
    // 新建足迹带一次性的 clientKey，记录编号就由它生成：上一次其实已经存上、只是回应丢了，重试时数据库主键挡住第二条
    // （第二条会和第一条共用同一批照片，删其中一条就会把另一条的照片也删了）
    const key = ev.collection === 'trips' && ev.doc && typeof ev.doc.clientKey === 'string' ? ev.doc.clientKey.replace(/[^\w-]/g, '').slice(0, 48) : ''
    const fixedId = key ? `t_${ctx.me}_${key}` : ''
    if (fixedId) {
      const existing = await getDoc('trips', fixedId)
      if (existing) return retryAdd(existing, ev, ctx)
    }
    const now = Date.now()
    const doc = Object.assign(sanitize(ev.collection, ev.doc), { createdBy: ctx.me, createdAt: now, updatedAt: now })
    if (key) doc.clientKey = key
    if (ev.collection === 'tasks') {
      doc.status = 'open'
      doc.points = clampInt(doc.points, 0, TASK_MAX)
      if (!ROLES.includes(doc.assignee)) doc.assignee = other(ctx.me)
    }
    if (ev.collection === 'rewards') doc.cost = clampInt(doc.cost, 1, REWARD_MAX)
    if (ev.collection === 'periods') {
      if (!doc.start) throw fail('bad-date', '要有开始日期')
      doc.end = doc.end || ''
    }
    if (ev.collection === 'marks') {
      if (!doc.type) throw fail('bad-type', '先选一种标记')
      if (!doc.start) throw fail('bad-date', '要有日期')
      doc.end = doc.end || doc.start
      doc.title = doc.title || ''
    }
    let res
    try {
      res = await db.collection(ev.collection).add({ data: fixedId ? Object.assign({ _id: fixedId }, doc) : doc })
    } catch (e) {
      // 两次重试同时到了：另一次刚建好，按重试处理
      const existing = fixedId ? await getDoc('trips', fixedId) : null
      if (existing) return retryAdd(existing, ev, ctx)
      throw e
    }
    const saved = Object.assign({ _id: res._id }, doc)
    const awards = await afterAdd(ev.collection, saved, ctx)
    if (ev.collection === 'tasks') await notifyAssigned(ctx, saved)
    return awards.length ? Object.assign({ _awards: awards }, saved) : saved
  },

  // 顶层字段整体替换（对象字段用 _.set，避免和旧值深度合并）
  async update(ev, ctx) {
    checkCollection(ev.collection, true)
    const current = await getDoc(ev.collection, ev.id)
    if (!current) throw fail('not-found', '这条记录已经不在了')
    checkOwner(ev.collection, current, ctx)
    const checked = checkBasePhotos(ev.collection, ev.patch, current)
    const patch = Object.assign(sanitize(ev.collection, ev.patch, current, ctx.me), { updatedAt: Date.now() })
    // 足迹记下最后是谁改的（新建足迹重试时，靠它判断对方有没有动过）
    if (ev.collection === 'trips') patch.updatedBy = ctx.me
    const orphans = ev.collection === 'trips' ? tripThumbs(patch, current, checked) : []
    const data = {}
    Object.keys(patch).forEach((k) => {
      const v = patch[k]
      data[k] = v && typeof v === 'object' ? _.set(v) : v
    })
    await db.collection(ev.collection).doc(ev.id).update({ data })
    await removeFiles(orphans)
    // 任务改派给了对方
    if (ev.collection === 'tasks' && patch.assignee && patch.assignee !== current.assignee) {
      await notifyAssigned(ctx, Object.assign({}, current, patch))
    }
    return patch
  },

  async remove(ev, ctx) {
    checkCollection(ev.collection, true)
    const doc = await getDoc(ev.collection, ev.id)
    if (!doc) return true
    checkOwner(ev.collection, doc, ctx)
    const thumbs = (doc.thumbs || []).map((x) => x && x.t)
    const files = [].concat(doc.photos || [], thumbs, doc.photo ? [doc.photo] : [])
    await removeFiles(files)
    await db.collection(ev.collection).doc(ev.id).remove()
    return true
  },

  // 云存储默认只有上传者能读，对方的照片要由云函数（管理员身份）换成临时链接
  // 只有绑定的两个人能调用；一次最多 50 个
  // 给一次旅行写点评：每人一条，各写各的；remove=true 删掉自己的
  // 用路径更新 reviews.<我>，两个人同时写也不会互相覆盖
  async tripReview(ev, ctx) {
    const t = await getDoc('trips', ev.id)
    if (!t) throw fail('not-found', '这条足迹已经不在了')
    const key = 'reviews.' + ctx.me
    if (ev.remove) {
      await db.collection('trips').doc(ev.id).update({ data: { [key]: _.remove(), updatedAt: Date.now() } })
      return null
    }
    if (!MOOD_KEYS.includes(ev.mood)) throw fail('bad-mood', '先选一个心情')
    const review = { mood: ev.mood, text: String(ev.text || '').trim().slice(0, 500), at: Date.now() }
    await db.collection('trips').doc(ev.id).update({ data: { [key]: _.set(review), updatedAt: Date.now() } })
    return review
  },

  async fileUrls(ev) {
    const list = (ev.fileIDs || []).filter((f) => typeof f === 'string' && f.indexOf(FILE_PREFIX) === 0).slice(0, 50)
    if (!list.length) return {}
    const res = await cloud.getTempFileURL({ fileList: list.map((fileID) => ({ fileID, maxAge: 86400 })) })
    const out = {}
    ;(res.fileList || []).forEach((f) => {
      if (f.tempFileURL) out[f.fileID] = { url: f.tempFileURL, maxAge: f.maxAge || 3600 }
    })
    return out
  },

  // 真机诊断：图片加载失败、换链接失败等记一笔，方便远程排查（只记设备信息和错误，不记照片内容）
  async log(ev, ctx) {
    const cut = (v, n) => String(v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n)
    await db.collection('logs').add({
      data: { event: cut(ev.event, 40), detail: cut(ev.detail, 400), sys: cut(ev.sys, 300), by: ctx.me, createdAt: Date.now() }
    })
    return true
  },

  async removeFiles(ev) {
    await removeFiles(ev.fileIDs || [])
    return true
  },

  // 第一次进点菜页时写入预设菜谱（预设列表由小程序端传来）
  async seed(ev, ctx) {
    if (!ctx.couple.seeded) {
      const { total } = await db.collection('dishes').count()
      if (total === 0) {
        const now = Date.now()
        const list = (ev.dishes || []).slice(0, 120)
        await Promise.all(
          list.map((d, i) =>
            db.collection('dishes').add({
              data: Object.assign(clean(d), { preset: true, createdBy: null, createdAt: now - i, updatedAt: now })
            })
          )
        )
      }
      await db.collection('couple').doc('main').update({ data: { seeded: true } })
    }
    return handlers.list({ collection: 'dishes' })
  },

  // 今日菜单加减一道菜：用原子操作，两个人同时点也不会互相覆盖
  async orderItem(ev, ctx) {
    const { date, dish } = ev
    const delta = Number(ev.delta) || 0
    if (!isDate(date)) throw fail('bad-date', '日期不对')
    if (!dish || !/^[\w-]+$/.test(dish._id || '')) throw fail('bad-dish', '菜品不对')
    const id = 'd' + date
    const ref = db.collection('orders').doc(id)
    const key = 'items.' + dish._id
    const now = Date.now()

    let order = await getDoc('orders', id)
    if (!order) {
      if (delta <= 0) return null
      try {
        await db.collection('orders').add({
          data: { _id: id, date, items: {}, status: 'open', createdBy: ctx.me, createdAt: now, updatedAt: now }
        })
      } catch (e) {
        // 对方刚好先建了
      }
      order = await getDoc('orders', id)
    }
    // 数量一律用原子加减：两个人同时点同一道新菜，也不会互相覆盖成 1 份
    const cur = order && order.items ? order.items[dish._id] : null
    const data = { updatedAt: now, status: 'open' }
    data[key + '.count'] = _.inc(delta)
    data[key + '.name'] = String(dish.name || '').slice(0, 30)
    if (delta > 0) data[key + '.by'] = _.addToSet(ctx.me)
    if (!cur) data[key + '.at'] = now
    await ref.update({ data })
    // 加减之后看结果，减到 0 就把这道菜拿掉
    let fresh = await getDoc('orders', id)
    const item = fresh && fresh.items ? fresh.items[dish._id] : null
    if (item && !(item.count > 0)) {
      await ref.update({ data: { [key]: _.remove() } })
      fresh = await getDoc('orders', id)
    }
    if (delta > 0) await notifyOrder(ctx, date, data[key + '.name'])
    return fresh
  },

  // ---------- 任务 ----------
  // 做任务的人点“我完成了”
  async taskSubmit(ev, ctx) {
    const t = await getDoc('tasks', ev.id)
    if (!t) throw fail('not-found', '任务已经不在了')
    if (t.assignee !== ctx.me) throw fail('not-assignee', '这个任务不是给你的')
    if (t.status !== 'open') throw fail('bad-status', '任务状态变了，刷新一下')
    const patch = { status: 'submitted', submittedAt: Date.now(), updatedAt: Date.now() }
    await db.collection('tasks').doc(ev.id).update({ data: patch })
    await notify(ctx.couple, other(ctx.me), 'task', {
      title: t.title,
      who: nameOf(ctx.couple, ctx.me),
      note: `${nameOf(ctx.couple, ctx.me)}说做完了，等你确认`,
      status: '待确认',
      page: 'pages/plans/index'
    })
    return { task: Object.assign(t, patch), award: null }
  },

  // 另一个人确认（accept=true 发积分）或打回（accept=false 回到未完成）
  async taskConfirm(ev, ctx) {
    const t = await getDoc('tasks', ev.id)
    if (!t) throw fail('not-found', '任务已经不在了')
    if (t.assignee === ctx.me) throw fail('self-confirm', '要等对方来确认')
    const now = Date.now()
    if (!ev.accept) {
      if (t.status !== 'submitted') throw fail('bad-status', '任务状态变了，刷新一下')
      const patch = { status: 'open', submittedAt: 0, updatedAt: now }
      await db.collection('tasks').doc(ev.id).update({ data: patch })
      await notify(ctx.couple, t.assignee, 'task', {
        title: t.title,
        who: nameOf(ctx.couple, ctx.me),
        note: `${nameOf(ctx.couple, ctx.me)}打回了，再做做看`,
        status: '被打回',
        page: 'pages/plans/index'
      })
      return { task: Object.assign(t, patch), award: null }
    }
    // 对方忘了点“完成”也可以直接确认
    if (t.status === 'done') throw fail('bad-status', '已经确认过了')
    const patch = { status: 'done', doneAt: now, updatedAt: now }
    await db.collection('tasks').doc(ev.id).update({ data: patch })
    const a = await award(t.assignee, `task:${t._id}`, t.points, `完成任务：${t.title}`, 'task')
    await notify(ctx.couple, t.assignee, 'task', {
      title: t.title,
      who: nameOf(ctx.couple, ctx.me),
      note: a ? `${nameOf(ctx.couple, ctx.me)}确认了，积分 +${a.delta}` : `${nameOf(ctx.couple, ctx.me)}确认完成了`,
      status: '已完成',
      page: 'pages/plans/index'
    })
    return { task: Object.assign(t, patch), award: a }
  },

  // ---------- 奖励 ----------
  async redeem(ev, ctx) {
    const r = await getDoc('rewards', ev.id)
    if (!r) throw fail('not-found', '这个奖励已经下架了')
    if (r.createdBy === ctx.me) throw fail('own-reward', '不能兑换自己上架的奖励')
    const balance = (ctx.couple.points && ctx.couple.points[ctx.me]) || 0
    if (balance < r.cost) throw fail('not-enough', `积分不够，还差 ${r.cost - balance} 分`)
    const now = Date.now()
    const red = {
      rewardId: r._id,
      title: r.title,
      cost: r.cost,
      by: ctx.me,
      owner: r.createdBy,
      status: 'pending',
      createdBy: ctx.me,
      createdAt: now,
      updatedAt: now
    }
    const res = await db.collection('redemptions').add({ data: red })
    const a = await award(ctx.me, `redeem:${res._id}`, -r.cost, `兑换：${r.title}`, 'redeem')
    await notify(ctx.couple, r.createdBy, 'task', {
      title: r.title,
      who: nameOf(ctx.couple, ctx.me),
      note: `${nameOf(ctx.couple, ctx.me)}用 ${r.cost} 分兑换了，等你兑现`,
      status: '待兑现',
      page: 'pages/points/index'
    })
    return { redemption: Object.assign({ _id: res._id }, red), award: a }
  },

  // 上架奖励的人兑现之后标记
  async fulfill(ev, ctx) {
    const d = await getDoc('redemptions', ev.id)
    if (!d) throw fail('not-found', '这条兑换记录不在了')
    if (d.owner !== ctx.me) throw fail('not-owner', '要由上架奖励的人来兑现')
    if (d.status !== 'pending') return d
    const patch = { status: 'fulfilled', fulfilledAt: Date.now(), updatedAt: Date.now() }
    await db.collection('redemptions').doc(ev.id).update({ data: patch })
    return Object.assign(d, patch)
  },

  // ---------- 微信通知 ----------
  // 小程序端订阅成功（每点一次「允许」，那类就能多发一条）：kinds 是这次允许了的几类
  async subscribe(ev, ctx) {
    const kinds = Array.from(new Set(Array.isArray(ev.kinds) ? ev.kinds : [])).filter((k) => NOTIFY_KINDS.includes(k))
    if (kinds.length) {
      const data = {}
      // 同时发的几条里有的被拒收（清零）、有的成功（减一），记账可能变成负数，负数从 1 重新记
      const mine = subsOf(ctx.couple, ctx.me)
      const raw = (ctx.couple.subs && ctx.couple.subs[ctx.me]) || {}
      kinds.forEach((k) => {
        data[`subs.${ctx.me}.${k}`] = Number(raw[k]) < 0 ? mine[k] + 1 : _.inc(1)
      })
      await db.collection('couple').doc('main').update({ data })
    }
    const fresh = (await getDoc('couple', 'main')) || ctx.couple
    return view(fresh, ctx.openid).couple.notify
  },

  // 给自己发一条试试（用掉自己一条提醒）
  async notifyTest(ev, ctx) {
    const kind = NOTIFY_KINDS.includes(ev.kind) ? ev.kind : 'remind'
    const ok = await notify(ctx.couple, ctx.me, kind, {
      title: '通知试一下',
      who: nameOf(ctx.couple, ctx.me),
      note: '收到这条，说明通知能用了',
      status: '测试',
      page: 'pages/settings/index'
    })
    if (ok === null) throw fail('no-quota', '这类通知还没有可用条数，先点「开启通知」')
    if (!ok) throw fail('notify-failed', '发送失败，稍后再试')
    const fresh = (await getDoc('couple', 'main')) || ctx.couple
    return view(fresh, ctx.openid).couple.notify
  },

  // 看看某天早上会发哪些提醒（只看不发）；today 不填就是今天
  notifyPreview(ev, ctx) {
    return upcoming(ctx.couple, isDate(ev.today) ? ev.today : todayCN())
  },

  // 配置通知时用：看小程序的服务类目、类目下的公共模板和它的字段，把选好的模板加进「我的模板」
  async notifyAdmin(ev) {
    const sm = cloud.openapi.subscribeMessage
    if (ev.op === 'category') return sm.getCategory({})
    if (ev.op === 'titles') {
      return sm.getPubTemplateTitleList({ ids: String(ev.ids || ''), start: clampInt(ev.start, 0, 100000), limit: clampInt(ev.limit || 30, 1, 30) })
    }
    if (ev.op === 'keywords') return sm.getPubTemplateKeyWordsById({ tid: String(ev.tid || '') })
    if (ev.op === 'add') {
      const kidList = (Array.isArray(ev.kidList) ? ev.kidList : []).map(Number).filter((n) => n > 0).slice(0, 5)
      // 这个接口的参数名本身就是驼峰（kidList），关掉 SDK 自动转成下划线（kid_list），否则报缺参数
      return cloud
        .openapi({ convertCase: false })
        .subscribeMessage.addTemplate({ tid: String(ev.tid || ''), kidList, sceneDesc: String(ev.sceneDesc || '').slice(0, 15) })
    }
    if (ev.op === 'mine') return sm.getTemplateList({})
    throw fail('bad-op', '未知操作')
  }
}

// 一次最多删 50 个（足迹 30 张照片 + 30 张缩略图会超），分批删；某一批失败不影响其他批
async function removeFiles(list) {
  const fileList = Array.from(new Set(list.filter(isFile)))
  const chunks = []
  for (let i = 0; i < fileList.length; i += 50) chunks.push(fileList.slice(i, i + 50))
  await Promise.all(
    chunks.map((c) =>
      cloud.deleteFile({ fileList: c }).catch((e) => {
        console.error('deleteFile', e)
      })
    )
  )
}

exports.main = async (event) => {
  const { OPENID, SOURCE } = cloud.getWXContext()
  // 定时触发器（config.json，每天 9 点）：没有用户身份，小程序端调不到这里
  if (!OPENID && (SOURCE === 'wx_trigger' || (event && event.Type === 'Timer'))) {
    try {
      return { ok: true, data: await daily() }
    } catch (e) {
      console.error('daily', e)
      return { ok: false, code: e.code || 'error', msg: e.message || '服务出错了' }
    }
  }
  try {
    const fn = handlers[event.action]
    if (!fn) throw fail('bad-action', '未知操作')
    const couple = await ensureCouple()
    const member = couple.members.find((m) => m.openid === OPENID)
    const ctx = { openid: OPENID, couple, me: member ? member.role : null }
    if (!OPEN_ACTIONS.includes(event.action) && !ctx.me) {
      throw fail('not-member', '请先在设置里选择你的身份')
    }
    return { ok: true, data: await fn(event, ctx) }
  } catch (e) {
    // 业务上的拒绝（没绑定、身份被占等）不算故障，不进错误日志
    if (!e.code) console.error(event.action, e)
    return { ok: false, code: e.code || 'error', msg: e.message || '服务出错了' }
  }
}

// 测试用：tools/test-cloud.js 填上假的模板再测发通知
exports.NOTIFY = NOTIFY
