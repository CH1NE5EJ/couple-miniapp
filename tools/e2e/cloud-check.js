// 开发用：云端连通性检查（需先 cli auto --auto-port 9420）
// 只调用 bootstrap 和一次 list：前者会自动建好集合，后者在没绑定身份时应被拒绝。不写任何业务数据
require('../deps')('e2e', module)
const automator = require('miniprogram-automator')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const callApi = (mp, data) =>
  mp.evaluate(function (d) {
    return wx.cloud.callFunction({ name: 'api', data: d }).then(
      (res) => res.result,
      (err) => ({ callError: String((err && err.errMsg) || err) })
    )
  }, data)

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  // 云端装依赖需要一点时间，最多等 2 分钟
  let boot = null
  for (let i = 0; i < 12; i++) {
    boot = await callApi(mp, { action: 'bootstrap' }).catch((e) => ({ callError: e.message }))
    if (boot && boot.ok) break
    console.log('等待云函数就绪…', JSON.stringify(boot).slice(0, 200))
    await sleep(10000)
  }
  console.log('bootstrap', JSON.stringify(boot))

  const me = boot && boot.ok ? boot.data.me : null
  console.log('这台开发者工具的微信身份：', me || '未绑定')
  const list = await callApi(mp, { action: 'list', collection: 'trips', limit: 1 }).catch((e) => ({ callError: e.message }))
  console.log('读数据', JSON.stringify(list).slice(0, 160))

  // 已绑定：能读到数据；未绑定：应该被拒绝
  const ok = boot && boot.ok && list && (me ? list.ok : list.code === 'not-member')
  console.log(ok ? '\n云端连通，权限正常' : '\n有问题，见上面的输出')
  mp.disconnect()
  process.exit(ok ? 0 : 1)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
