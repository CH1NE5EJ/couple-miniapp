// 把仓库代码和一份私人配置（profile）合成一个可以部署、上传的项目文件夹。仓库里只放通用代码，私人的东西放在仓库外
// 用法：node tools/apply-profile.js <profile 目录> <输出目录> [--init]
//
// profile 目录的结构：
//   profile.json            { "project": { project.config.json 里要改的字段，比如 appid；嵌套的对象逐层合并 }, "title": "小程序标题" }
//   files/...               原样覆盖到输出目录的文件，路径和仓库一样，只放数据和素材：
//                           miniprogram/config.js、cloudfunctions/api/settings.js、miniprogram/data/avatars.js、
//                           miniprogram/assets/<身份>/*.png、miniprogram/assets/loading/*.gif ……
//
// 做的事：输出目录先变成和仓库一模一样（多余的文件删掉；仓库的 .git 不复制，输出目录自己的 .git 也不动），再盖上 files/，改 project.config.json 和 app.json 的标题，
// 最后在输出目录里运行 sync-server（小程序端拿到这份 profile 的 settings.js）
// 第一次往一个已有、但不是这个脚本生成的目录里写，要加 --init（防止误删别的文件夹）
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.resolve(__dirname, '..')
const MARK = '.profile-build.json'
// 输出目录里这些东西不删不盖：开发者工具自己的本机设置、本脚本的标记、依赖、输出目录自己的 Git 仓库（如果有）
const KEEP = new Set(['.git', 'project.private.config.json', MARK, 'node_modules'])
const SKIP = new Set(['.git', 'node_modules', 'project.private.config.json', MARK])

function fail(msg) {
  console.error('apply-profile: ' + msg)
  process.exit(1)
}

const args = process.argv.slice(2)
const init = args.includes('--init')
const [profileArg, outArg] = args.filter((a) => a !== '--init')
if (!profileArg || !outArg) fail('用法：node tools/apply-profile.js <profile 目录> <输出目录> [--init]')
const PROFILE = path.resolve(profileArg)
const OUT = path.resolve(outArg)

const inside = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
if (inside(OUT, REPO)) fail('输出目录不能是仓库本身，也不能在仓库里面')
if (inside(PROFILE, REPO)) fail('profile 要放在仓库外面，私人配置不进仓库')
if (inside(OUT, PROFILE) || inside(PROFILE, OUT)) fail('输出目录和 profile 目录不能互相包含')
const profileJson = path.join(PROFILE, 'profile.json')
if (!fs.existsSync(profileJson)) fail('找不到 ' + profileJson)
const profile = JSON.parse(fs.readFileSync(profileJson, 'utf8'))
const FILES = path.join(PROFILE, 'files')

if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !fs.existsSync(path.join(OUT, MARK)) && !init) {
  fail(`${OUT} 已经有文件、但不是这个脚本生成的。确认里面的东西可以被覆盖、删除（先备份）后，加 --init 再运行`)
}

// 1. 输出目录和仓库保持一致
function mirror(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  const names = fs.readdirSync(src).filter((n) => !SKIP.has(n))
  names.forEach((n) => {
    const s = path.join(src, n)
    const d = path.join(dst, n)
    if (fs.statSync(s).isDirectory()) {
      if (fs.existsSync(d) && !fs.statSync(d).isDirectory()) fs.rmSync(d, { force: true })
      mirror(s, d)
    } else {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) fs.rmSync(d, { recursive: true, force: true })
      fs.copyFileSync(s, d)
    }
  })
  const want = new Set(names)
  fs.readdirSync(dst).forEach((n) => {
    if (!want.has(n) && !KEEP.has(n)) fs.rmSync(path.join(dst, n), { recursive: true, force: true })
  })
}
mirror(REPO, OUT)

// 2. 盖上 profile 的文件
const overlaid = []
function overlay(src, dst) {
  fs.readdirSync(src).forEach((n) => {
    const s = path.join(src, n)
    const d = path.join(dst, n)
    if (fs.statSync(s).isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      overlay(s, d)
    } else {
      fs.copyFileSync(s, d)
      overlaid.push(path.relative(OUT, d))
    }
  })
}
if (fs.existsSync(FILES)) overlay(FILES, OUT)

// 3. 改 project.config.json 的字段和 app.json 的标题（只改字段，不整份替换，仓库新增的配置不会丢）
const patchJson = (file, fn) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  fn(data)
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}
// 逐层合并：profile 里写了 setting 的某一项，不会把仓库里 setting 的其他项冲掉
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const merge = (base, over) => {
  Object.keys(over).forEach((k) => {
    base[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k]
  })
  return base
}
if (profile.project) patchJson(path.join(OUT, 'project.config.json'), (d) => merge(d, profile.project))
if (profile.title) {
  patchJson(path.join(OUT, 'miniprogram', 'app.json'), (d) => {
    d.window = Object.assign({}, d.window, { navigationBarTitleText: profile.title })
  })
}

// 4. 小程序端和本机预览模式用这份 profile 的设置
execFileSync(process.execPath, [path.join(OUT, 'tools', 'sync-server.js')], { stdio: 'inherit' })

// 5. 核对：云函数和小程序端的身份一致
const fresh = (f) => {
  delete require.cache[require.resolve(f)]
  return require(f)
}
const cloudRoles = fresh(path.join(OUT, 'cloudfunctions', 'api', 'settings.js')).roles
const appRoles = fresh(path.join(OUT, 'miniprogram', 'services', 'settings.js')).roles
if (JSON.stringify(cloudRoles) !== JSON.stringify(appRoles)) fail('云函数和小程序端的 roles 对不上')

fs.writeFileSync(
  path.join(OUT, MARK),
  JSON.stringify({ builtAt: new Date().toISOString(), repo: REPO, profile: PROFILE, roles: cloudRoles, overlaid }, null, 2) + '\n'
)
console.log(`apply-profile: ${OUT} 已生成（身份 ${cloudRoles.join(' / ')}，覆盖了 ${overlaid.length} 个文件）`)
