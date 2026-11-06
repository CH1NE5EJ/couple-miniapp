// 开发用：连上已开启自动化的开发者工具（cli auto --auto-port 9420），走一遍主流程并截图
// 用法：node tools/e2e/run.js
// 注意：会清空模拟器里的本机数据
const path = require('path')
const fs = require('fs')
require('../deps')('e2e', module)
const automator = require('miniprogram-automator')

// 这个脚本会清空数据、替你选身份、写测试数据：云端模式下不能跑，否则会污染真实数据库
const MP_ROOT = process.env.MP_ROOT || path.join(__dirname, '..', '..', 'miniprogram')
const { envId } = require(path.join(MP_ROOT, 'config.js'))
// 两个人的身份和默认称呼（tools/sync-server.js 从 cloudfunctions/api/settings.js 复制过来的那份）
const SETTINGS = require(path.join(MP_ROOT, 'services', 'settings.js'))
const [R0, R1] = SETTINGS.roles
const NAME = (r) => (SETTINGS.names && SETTINGS.names[r]) || r
if (envId) {
  console.error('云端模式下不能跑：config.js 里 envId 不为空。要跑请先临时清空 envId，跑完再改回来')
  process.exit(1)
}

// 截图放在项目目录外：写进项目目录会触发开发者工具重新编译，模拟器会重启
const SHOTS = process.env.SHOTS || path.join(__dirname, '..', '..', '..', '_e2e-shots', 'couple-miniapp')
fs.rmSync(SHOTS, { recursive: true, force: true })
fs.mkdirSync(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = (dataset, detail) => ({ currentTarget: { dataset: dataset || {} }, detail: detail || {} })
const problems = []
const note = (msg) => {
  problems.push(msg)
  console.log('!! ' + msg)
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.AUTO_PORT || 9420) })
  mp.on('console', (msg) => {
    if (msg.type === 'error' || msg.type === 'warn') note(`[${msg.type}] ${JSON.stringify(msg.args).slice(0, 400)}`)
  })
  mp.on('exception', (err) => note(`[exception] ${err.message}`))

  // 这版开发者工具的自动化通道在页面切换前后偶尔超时：超时就等一下重试
  const retry = async (label, fn, times) => {
    const max = times || 3
    for (let i = 0; i < max; i++) {
      try {
        return await fn()
      } catch (e) {
        const last = i === max - 1
        if (!/timeout/i.test(e.message) || last) {
          note(`${label}：${e.message}`)
          return undefined
        }
        await sleep(1500)
      }
    }
  }

  let n = 0
  const shot = async (name, wait) => {
    await sleep(wait || 1200)
    n += 1
    const file = path.join(SHOTS, `${String(n).padStart(2, '0')}-${name}.png`)
    await retry('截图 ' + name, () => mp.screenshot({ path: file }))
    console.log('shot', path.basename(file))
  }
  const page = () => retry('取当前页', () => mp.currentPage())
  // Page.callMethod 在这版工具里会报 No context found，改在逻辑层里直接调用页面方法
  const call = (method, arg) =>
    retry('调用 ' + method, () =>
      mp.evaluate(
        function (m, a) {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          if (typeof p[m] !== 'function') throw new Error(p.route + ' 没有方法 ' + m)
          p[m](a)
          return p.route
        },
        method,
        arg
      )
    )
  // 底栏是独立组件，用它自己的 go 方法切换，顺便测底栏逻辑
  const goTab = async (index) => {
    await retry('切换底栏', () =>
      mp.evaluate(function (i) {
        const pages = getCurrentPages()
        pages[pages.length - 1].getTabBar().go({ currentTarget: { dataset: { index: i } } })
      }, index)
    )
    await sleep(1000)
  }
  const data = async (key) => {
    const p = await page()
    return p ? retry('读数据 ' + key, () => p.data(key)) : undefined
  }
  // 跳转需要时间：最多等 4 秒
  const expectPath = async (want, label) => {
    let cur = ''
    for (let i = 0; i < 8; i++) {
      const p = await page()
      cur = p && p.path
      if (cur === want) return
      await sleep(500)
    }
    note(`${label}：期望在 ${want}，实际在 ${cur}`)
  }
  const find = async (selector, index) => {
    const p = await page()
    if (!p) return null
    const els = (await retry('查找 ' + selector, () => p.$$(selector))) || []
    return els[index || 0] || null
  }
  // 真实点击：找不到元素就记一笔
  const tap = async (selector, index, label) => {
    const el = await find(selector, index)
    if (!el) return note(`${label || selector}：找不到元素 ${selector}[${index || 0}]`)
    try {
      await el.tap()
    } catch (e) {
      // 点击触发页面跳转时，自动化工具偶尔收不到回执，等页面稳定后继续
      console.log(`   (${label || selector} 点击回执超时，继续)`)
    }
    await sleep(400)
  }
  const type = async (selector, index, value) => {
    const el = await find(selector, index)
    if (!el) return note(`找不到输入框 ${selector}[${index}]`)
    await retry('输入 ' + selector, () => el.input(value))
    await sleep(150)
  }

  // ---------- 0. 从干净状态开始 ----------
  await mp.callWxMethod('clearStorageSync')
  await mp.evaluate(function () {
    const app = getApp()
    app.globalData.me = null
    app.globalData.couple = null
    app.globalData.tabFrom = 0
    app.statsLoaded = false
    app.setupOpen = false
    return app.boot()
  })

  // ---------- 1. 首次进入：应自动跳到选身份 ----------
  await mp.reLaunch('/pages/home/index')
  let reached = false
  for (let i = 0; i < 8 && !reached; i++) {
    await sleep(500)
    const p = await page()
    reached = !!p && p.path === 'pages/settings/index'
  }
  if (!reached) {
    note('首次进入没有自动跳到选身份页')
    await mp.navigateTo('/pages/settings/index?setup=1')
    await sleep(800)
  }
  await shot('setup', 600)
  await tap('.who-card', 0, '选身份')
  await call('onSince', ev({}, { value: '2024-05-20' }))
  if ((await data('me')) !== R0) note(`点身份卡后 me 不是 ${R0}`)
  await shot('setup-picked', 900)
  await tap('.btn-primary', 0, '开始')
  await sleep(1200)
  await expectPath('pages/home/index', '点开始后')

  // ---------- 2. 纪念日 ----------
  await tap('.fab', 0, '首页加号')
  await sleep(900)
  await expectPath('pages/anniversary-edit/index', '首页加号')
  await type('.field-input', 0, `${NAME(R1)} 生日`)
  await tap('.chip', 1, '类型：生日')
  await call('onDate', ev({}, { value: '1998-03-15' }))
  const seg = await find('ui-segmented', 0)
  if (seg) {
    const items = await seg.$$('.seg-item')
    if (items[1]) await items[1].tap()
    else note('纪念日页分段控件里找不到选项')
  } else {
    // 自定义组件内部节点在页面层查不到，改为直接触发分段控件的 change
    await call('onCalendar', ev({}, { key: 'lunar' }))
  }
  await sleep(500)
  if ((await data('form.calendar')) !== 'lunar') note('点「农历」后 calendar 不是 lunar')
  await shot('anniversary-edit', 600)
  await tap('.btn-primary', 0, '保存纪念日')
  await sleep(1000)
  await expectPath('pages/home/index', '保存纪念日后')

  await mp.navigateTo('/pages/anniversary-edit/index')
  await sleep(700)
  await type('.field-input', 0, '第一次见面')
  await call('onDate', ev({}, { value: '2024-04-02' }))
  await tap('.btn-primary', 0, '保存第二个纪念日')
  await sleep(1000)
  await shot('home', 1800)
  const annCount = (await data('list')).length
  if (annCount !== 3) note(`首页纪念日应为 3 条（含在一起纪念日），实际 ${annCount}`)

  // ---------- 3. 足迹 ----------
  await goTab(2)
  await expectPath('pages/map/index', '底栏切到足迹')
  await shot('map-empty', 1800)

  const trips = [
    { region: ['浙江省', '杭州市'], code: ['330000', '330100'], place: '西湖', start: '2025-03-08', end: '2025-03-10', note: '第一次一起出远门，下了一整天的雨' },
    { region: ['四川省', '成都市'], code: ['510000', '510100'], place: '宽窄巷子', start: '2025-07-01', end: '2025-07-04' },
    { region: ['浙江省', '宁波市'], code: ['330000', '330200'], place: '东钱湖', start: '2025-10-02' },
    { region: ['云南省', '大理白族自治州'], code: ['530000', '532900'], place: '洱海', start: '2026-01-08', end: '2026-01-12' }
  ]
  for (let i = 0; i < trips.length; i++) {
    const t = trips[i]
    await tap('.fab', 0, '足迹加号')
    await sleep(900)
    await call('onRegion', ev({}, { value: t.region, code: t.code }))
    await type('.field-input', 0, t.place)
    await call('onStart', ev({}, { value: t.start }))
    if (t.end) await call('onEnd', ev({}, { value: t.end }))
    if (t.note) await type('.field-textarea', 0, t.note)
    if (i === 0) await shot('trip-edit', 600)
    await tap('.btn-primary', 0, '保存足迹')
    await expectPath('pages/map/index', '保存足迹后回到地图')
    await sleep(600)
    if (i === trips.length - 1) await shot('map-ripple', 200)
  }
  await shot('map-lit', 1500)
  const stats = await data('stats')
  if (stats.lit !== 3 || stats.trips !== 4) note(`足迹统计不对：${JSON.stringify(stats)}`)

  // 在地图上真实触摸浙江
  const pt = await retry('取浙江坐标', () => mp.evaluate(function () {
    const p = getCurrentPages().pop()
    return p.map ? p.map.byCode['330000'].c : null
  }))
  const canvas = await find('#map', 0)
  if (pt && canvas) {
    const touch = { identifier: 0, x: pt[0], y: pt[1], clientX: pt[0], clientY: pt[1], pageX: pt[0], pageY: pt[1] }
    await retry('触摸地图', () => canvas.touchstart({ touches: [touch], changedTouches: [touch] }))
    await retry('松开地图', () => canvas.touchend({ touches: [], changedTouches: [touch] }))
    await sleep(600)
    const sel = await data('selected')
    if (!sel || sel.code !== '330000') {
      // 自动化工具合成的画布触摸不一定带 x/y：改在逻辑层用同样的坐标调用触摸处理函数，验证识别省份的逻辑
      const hit = await retry('逻辑层模拟触摸', () =>
        mp.evaluate(function (x, y) {
          const pages = getCurrentPages()
          const p = pages[pages.length - 1]
          const t = { x: x, y: y }
          p.onMapStart({ touches: [t] })
          p.onMapEnd({ changedTouches: [t] })
          return p.data.selected && p.data.selected.code
        }, pt[0], pt[1])
      )
      console.log('   合成触摸没选中；逻辑层用同坐标点击结果：' + hit)
      if (hit !== '330000') note('用浙江的坐标点击，识别出的省份是 ' + hit)
    }
  } else note('拿不到地图实例或画布')
  await shot('map-selected', 1000)
  const shown = (await data('shown')) || []
  if (shown.length !== 2) note(`选中浙江后应显示 2 条，实际 ${shown.length}`)

  await tap('.post', 0, '打开足迹详情')
  await sleep(1000)
  await expectPath('pages/trip-detail/index', '点足迹卡片')
  await shot('trip-detail', 800)
  // 写一条点评（复用心情选择器）
  await tap('.review', 0, '点自己的点评卡片')
  await sleep(600)
  await call('onReviewMood', { detail: { key: 'great' } })
  await call('onReviewText', { detail: { value: '第一次一起出远门，值得' } })
  await shot('trip-review-sheet', 900)
  await tap('.review-form .btn-primary', 0, '保存点评')
  await shot('trip-reviewed', 1500)
  const myReview = (await data('reviews')) || []
  if (!myReview[0] || myReview[0].mood !== 'great') note('点评没有保存上：' + JSON.stringify(myReview[0]))
  await mp.navigateBack()
  await sleep(800)

  // ---------- 4. 计划 ----------
  await goTab(3)
  await expectPath('pages/plans/index', '底栏切到计划')
  await shot('plans-empty', 1200)
  await tap('.chip', 1, '计划分类：旅行')
  await tap('.fab', 0, '计划加号')
  await sleep(900)
  if ((await data('form.category')) !== 'travel') note('从「旅行」分类新建计划，类型没有预选旅行')
  await type('.field-input', 0, '明年春天去日本看樱花')
  for (const s of ['订机票', '办签证', '做攻略']) {
    await call('onNewItem', ev({}, { value: s }))
    await tap('.item-ok', 0, '添加步骤')
  }
  const itemCount = (await data('form.items')).length
  if (itemCount !== 3) note(`计划步骤应为 3 个，实际 ${itemCount}`)
  await shot('plan-edit', 600)
  await tap('.btn-primary', 0, '保存计划')
  await sleep(1000)
  await tap('.chip', 0, '计划分类：全部')
  await mp.navigateTo('/pages/plan-edit/index?category=study')
  await sleep(800)
  await type('.field-input', 0, '一起考驾照')
  await call('onDue', ev({}, { value: '2026-12-31' }))
  await tap('.btn-primary', 0, '保存第二个计划')
  await sleep(1200)
  const planList = (await data('shown')) || []
  if (planList.length !== 2) note(`计划列表应为 2 条，实际 ${planList.length}`)
  const sakuraIndex = planList.findIndex((p) => p.title.indexOf('樱花') >= 0)
  await tap('.plan', sakuraIndex, '展开计划')
  await sleep(600)
  await tap('.sub-row', 0, '勾第一个步骤')
  await shot('plans', 1200)
  // 勾完剩下两步：计划应自动完成并退场
  await tap('.sub-row', 1, '勾第二个步骤')
  await tap('.sub-row', 2, '勾第三个步骤')
  await sleep(1500)
  const after = (await data('shown')) || []
  if (after.length !== 1) note(`步骤全勾完后计划应退场，列表实际 ${after.length} 条`)
  await tap('.done-toggle', 0, '显示已完成')
  await shot('plans-done', 1200)

  // ---------- 5. 点菜 ----------
  await goTab(4)
  await expectPath('pages/menu/index', '底栏切到点菜')
  await shot('menu', 1500)
  const total = await data('total')
  if (total < 40) note(`预设菜谱只有 ${total} 道`)
  await tap('.learn-pill', 0, `标记 ${NAME(R0)} 学会第一道`)
  await tap('.learn-pill', 3, `标记 ${NAME(R1)} 学会第二道`)
  await tap('.step-plus', 0, '加第一道菜')
  await tap('.step-plus', 1, '加第二道菜')
  await tap('.step-plus', 1, '第二道再加一份')
  await sleep(800)
  const order = await data('order')
  if (order.count !== 3) note(`今日菜单应为 3 份，实际 ${order.count}`)
  await shot('menu-ordered', 800)
  await tap('.rand-btn', 0, '帮我们决定')
  await shot('menu-random', 4800)
  if (await data('rand.rolling')) note('随机抽菜 4.8 秒后还没停')
  const takeBtn = await find('.rand .btn-primary', 0)
  if (takeBtn) await takeBtn.tap().catch(() => null)
  else {
    note('随机弹层里找不到「就它了」按钮，改用方法调用')
    await call('takeRand')
  }
  await shot('menu-today', 1500)
  if ((await data('tab')) !== 'today') note('点「就它了」后没有切到今日菜单')
  await tap('.btn-primary', 0, '就吃这些')
  await shot('menu-confirmed', 1200)
  await tap('.history', 0, '以前吃过什么')
  await sleep(1000)
  await expectPath('pages/orders/index', '点历史')
  await shot('orders', 800)
  await mp.navigateBack()
  await sleep(600)

  // ---------- 5.5 日历：写心情、记经期 ----------
  await goTab(1)
  await expectPath('pages/calendar/index', '底栏切到日历')
  await shot('calendar-empty', 1500)
  await tap('.fab', 0, '日历加号：写今天')
  await expectPath('pages/diary-edit/index', '写心情页')
  // 心情选择器是公用组件，按钮在组件里，页面层点不到：直接触发选择
  await call('pickMood', { detail: { key: 'great' } })
  await type('.field-textarea', 0, '下班一起去江边散步，风很舒服')
  await call('onEventInput', ev({}, { value: '散步' }))
  await tap('.add-btn', 0, '添加小事')
  await shot('diary-edit', 600)
  await tap('.btn-primary', 0, '保存心情')
  await expectPath('pages/calendar/index', '保存心情后回到日历')
  const T = await mp.evaluate(function () {
    const d = new Date()
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
  })
  const back = (n) => {
    const d = new Date(T + 'T00:00:00')
    d.setDate(d.getDate() - n)
    const p = (x) => (x < 10 ? '0' + x : '' + x)
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
  }
  // 两次经期：29 天前开始、25 天前结束；昨天又开始
  for (const [d, act] of [[back(29), 'periodStart'], [back(25), 'periodEnd'], [back(1), 'periodStart']]) {
    await call('pick', { currentTarget: { dataset: { date: d } } })
    await sleep(500)
    await call(act)
    await sleep(700)
  }
  await call('backToday')
  await shot('calendar', 1500)

  // ---------- 5.6 任务 ----------
  await goTab(3)
  await expectPath('pages/plans/index', '底栏切到计划')
  await call('onMode', { detail: { key: 'tasks' } })
  await sleep(500)
  await tap('.fab', 0, '任务加号')
  await expectPath('pages/task-edit/index', '发任务页')
  await type('.field-input', 0, '做一顿晚饭')
  await tap('.chip', 2, '分值 20')
  await call('onFav', { detail: { value: true } })
  await shot('task-edit', 600)
  await tap('.btn-primary', 0, '发布任务')
  await expectPath('pages/plans/index', '发布任务后回到计划')
  await call('onMode', { detail: { key: 'tasks' } })
  await shot('tasks', 1200)
  await tap('.task .act', 0, '直接确认')
  await shot('tasks-confirmed', 1500)

  // ---------- 5.7 积分页 ----------
  await mp.navigateTo('/pages/points/index')
  await expectPath('pages/points/index', '积分页')
  await shot('points', 1500)
  await tap('.add-card', 0, '上架奖励')
  await sleep(500)
  await type('.sheet-form .field-input', 0, '请吃一顿火锅')
  await tap('.sheet-form .chip', 2, '100 分')
  await shot('points-sheet', 800)
  await tap('.sheet-form .btn-primary', 0, '上架')
  await sleep(800)
  await call('onTab', { detail: { key: 'ledger' } })
  await shot('points-ledger', 1000)
  await mp.navigateBack()
  await sleep(800)

  // ---------- 6. 首页统计 ----------
  await goTab(0)
  await shot('home-final', 1800)
  const st = await data('stats')
  if (st.provinces !== 3 || st.plansDone !== 1 || st.dishes !== 2) note(`首页统计不对：${JSON.stringify(st)}`)

  console.log('\n问题汇总：')
  console.log(problems.length ? problems.map((p, i) => `${i + 1}. ${p}`).join('\n') : '没有发现问题')
  mp.disconnect()
}

main().catch((e) => {
  console.error('失败', e)
  console.log(problems.join('\n'))
  process.exit(1)
})
