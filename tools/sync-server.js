// 把云函数复制进小程序，给本机预览模式用：业务逻辑只有一份，改云函数后跑一下这个脚本
// 同时把云函数要用的日期、经期工具从 miniprogram/utils 复制进云函数（两边用同一份）
// 云函数里平铺在根目录：在 Windows 上用命令行部署，子目录里的文件云端找不到
// 用法：node tools/sync-server.js
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const fnDir = path.join(root, 'cloudfunctions', 'api')
const src = path.join(fnDir, 'index.js')
const out = path.join(root, 'miniprogram', 'services', 'server.js')

// [小程序 utils 里的文件, 云函数里的文件名]
const UTILS = [
  ['date.js', 'date.js'],
  ['period.js', 'period.js'],
  ['vendor/solarlunar.js', 'solarlunar.js'],
  ['vendor/LICENSE-solarlunar.txt', 'LICENSE-solarlunar.txt']
]
UTILS.forEach(([from, to]) => {
  let text = fs.readFileSync(path.join(root, 'miniprogram', 'utils', from), 'utf8')
  if (to.endsWith('.js')) {
    text = `// 由 tools/sync-server.js 从 miniprogram/utils/${from} 复制，请勿手改\n` + text.replace("require('./vendor/solarlunar')", "require('./solarlunar')")
  }
  fs.writeFileSync(path.join(fnDir, to), text)
})

// 部署设置（身份、称呼、通知模板）：小程序端（utils/roles.js）和本机预览模式都读这份复制
// server.js 和它都在 miniprogram/services 里，所以 require('./settings') 不用改
const settingsSrc = fs.readFileSync(path.join(fnDir, 'settings.js'), 'utf8')
fs.writeFileSync(
  path.join(root, 'miniprogram', 'services', 'settings.js'),
  '// 由 tools/sync-server.js 从 cloudfunctions/api/settings.js 复制，请勿手改（要改去改那份，再运行这个脚本）\n' + settingsSrc
)

let code = fs.readFileSync(src, 'utf8')
const replace = (from, to) => {
  if (code.indexOf(from) < 0) throw new Error('sync-server: 找不到 ' + from)
  code = code.replace(from, to)
}
replace("require('wx-server-sdk')", "require('./local-sdk')")
replace("const FILE_PREFIX = 'cloud://'", "const FILE_PREFIX = require('./local-sdk').FILE_PREFIX")
replace("require('./date')", "require('../utils/date')")
replace("require('./period')", "require('../utils/period')")

const banner =
  '// 由 tools/sync-server.js 从 cloudfunctions/api/index.js 生成，请勿手改\n' +
  '// 本机预览模式直接运行这份云函数逻辑，数据存在本地存储（见 local-sdk.js）\n'
fs.writeFileSync(out, banner + code)
console.log('synced', path.relative(root, out), '+ services/settings.js + cloudfunctions/api 里的日期、经期工具')
