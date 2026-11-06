// 开发用：把地图渲染器包成一个 HTML，方便用浏览器截图检查效果
// 用法：node tools/preview-map.js <out.html> [frameMs]
const fs = require('fs')
const path = require('path')

const [, , out, frameMs = '5000'] = process.argv
const root = path.join(__dirname, '..', 'miniprogram')
const data = fs.readFileSync(path.join(root, 'data', 'china-map.js'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'utils', 'china-map.js'), 'utf8')

const html = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#F6F5F1;font:12px sans-serif}canvas{display:block}</style>
<canvas id="c"></canvas><div id="log"></div>
<script>
const mods = {}
function define(name, fn) { const module = { exports: {} }; fn(module, module.exports, (n) => mods[n.split('/').pop()]); mods[name] = module.exports }
define('china-map-data', function (module, exports) { ${data} })
mods['china-map'] = mods['china-map-data']
define('renderer', function (module, exports, require) { ${renderer} })
const { ChinaMap } = mods.renderer
const W = 375, H = Math.round(W * ChinaMap.aspect())
const canvas = document.getElementById('c')
const dpr = 2
canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr)
// 截图需要确定的时刻：用假时钟
let fake = 0
Date.now = () => fake
const queue = []
const map = new ChinaMap({ canvas, ctx, width: W, height: H, raf: (fn) => queue.push(fn) })
map.playIntro()
map.setCounts({ '330000': 3, '310000': 1, '110000': 2, '510000': 1, '530000': 2, '460000': 1, '810000': 1, '440000': 1 }, false)
map.setCounts({ '330000': 3, '310000': 1, '110000': 2, '510000': 1, '530000': 2, '460000': 1, '810000': 1, '440000': 1, '650000': 1 }, true)
map.select('330000')
const until = ${Number(frameMs)}
while (queue.length && fake <= until) { const fn = queue.shift(); fn(); fake += 16 }
const hits = [[200, 200], [300, 220], [100, 150]].map(([x, y]) => x + ',' + y + '=' + map.hitTest(x, y))
document.getElementById('log').textContent = 'H=' + H + ' ' + hits.join(' ')
</script>`
fs.writeFileSync(out, html)
console.log('wrote', out)
