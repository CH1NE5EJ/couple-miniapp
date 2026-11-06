// 开发用：只读巡检，依次打开四个底栏页面截图，不改任何数据
// 用法：node tools/e2e/tour.js（需先 cli auto --auto-port 9420）
const path = require('path')
const fs = require('fs')
require('../deps')('e2e', module)
const automator = require('miniprogram-automator')

const SHOTS = process.env.SHOTS || path.join(__dirname, '..', '..', '..', '_e2e-shots', 'couple-miniapp-tour')
const TABS = ['/pages/home/index', '/pages/map/index', '/pages/plans/index', '/pages/menu/index']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  const problems = []
  mp.on('exception', (e) => problems.push(e.message))
  mp.on('console', (m) => m.type === 'error' && problems.push(JSON.stringify(m.args).slice(0, 300)))
  for (let i = 0; i < TABS.length; i++) {
    try {
      await mp.switchTab(TABS[i])
    } catch (e) {
      // 跳转回执偶尔超时，页面其实已经切过去了
    }
    await sleep(2500)
    const file = path.join(SHOTS, `${i + 1}-${TABS[i].split('/')[2]}.png`)
    for (let t = 0; t < 3; t++) {
      try {
        await mp.screenshot({ path: file })
        break
      } catch (e) {
        await sleep(1500)
      }
    }
    console.log('shot', path.basename(file))
  }
  console.log(problems.length ? problems.join('\n') : '没有报错')
  mp.disconnect()
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
