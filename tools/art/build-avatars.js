// 把形象原图 <角色>/<角色>-<心情>.png（放在项目外，默认 ../couple-miniapp-art，可用环境变量 ART_DIR 改；原图一般很大，不放进项目目录）裁成头像、压缩后放进小程序，并生成清单 data/avatars.js
// 用法：node tools/art/build-avatars.js（依赖 sharp，安装方法见 tools/deps.js）；角色目录名用 cloudfunctions/api/settings.js 里 roles 的键
// 心情的文件名：great 超开心 / happy 开心 / calm 平静 / sad 难过 / angry 生气
const fs = require('fs')
const path = require('path')
require('../deps')('art', module)
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const ART = process.env.ART_DIR || path.join(ROOT, '..', 'couple-miniapp-art')
const OUT = path.join(ROOT, 'miniprogram', 'assets')
const MOODS = ['great', 'happy', 'calm', 'sad', 'angry']
const SIZE = 320 // 头像边长（像素），页面上最大显示 160rpx，二倍图够用

async function main() {
  const manifest = {}
  // 找不到原图目录就停下：照样写一份空清单会把已有的形象图清掉
  if (!fs.existsSync(ART)) {
    console.error(`找不到形象原图目录 ${ART}（用环境变量 ART_DIR 指定）；没有生成任何东西，data/avatars.js 没动`)
    process.exit(1)
  }
  const roles = fs.readdirSync(ART).filter((d) => fs.statSync(path.join(ART, d)).isDirectory())
  // 文件夹名就是身份键，要和 cloudfunctions/api/settings.js 的 roles 对得上，否则头像显示不出来
  const known = require(path.join(ROOT, 'cloudfunctions', 'api', 'settings.js')).roles
  const unknown = roles.filter((r) => known.indexOf(r) < 0)
  if (unknown.length) {
    console.error(`${ART} 里的 ${unknown.join('、')} 不是 settings.js 里的身份（${known.join('、')}）；没有生成任何东西`)
    process.exit(1)
  }
  for (const role of roles) {
    const dir = path.join(ART, role)
    const crop = JSON.parse(fs.readFileSync(path.join(dir, 'crop.json'), 'utf8'))
    const outDir = path.join(OUT, role)
    fs.mkdirSync(outDir, { recursive: true })
    manifest[role] = {}
    for (const mood of MOODS) {
      const src = path.join(dir, `${role}-${mood}.png`)
      if (!fs.existsSync(src)) continue
      const meta = await sharp(src).metadata()
      // 原图尺寸和裁剪框不一致时按比例换算，保证不同表情的头像大小、位置一样
      const k = meta.width / (crop.baseWidth || meta.width)
      const box = {
        left: Math.round(crop.left * k),
        top: Math.round(crop.top * k),
        width: Math.round(crop.size * k),
        height: Math.round(crop.size * k)
      }
      const file = path.join(outDir, `${mood}.png`)
      await sharp(src)
        .extract(box)
        .resize(SIZE, SIZE)
        .png({ palette: true, quality: 90, effort: 10 })
        .toFile(file)
      manifest[role][mood] = `/assets/${role}/${mood}.png`
      console.log(`${role}/${mood}.png  ${(fs.statSync(file).size / 1024).toFixed(1)}KB`)
    }
  }
  const banner = '// 由 tools/art/build-avatars.js 生成，请勿手改。列出每个角色已经有哪些心情的头像\n'
  fs.writeFileSync(path.join(ROOT, 'miniprogram', 'data', 'avatars.js'), banner + 'module.exports = ' + JSON.stringify(manifest, null, 2) + '\n')
  console.log('manifest', JSON.stringify(manifest))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
