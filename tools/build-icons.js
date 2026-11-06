// 从 lucide-static 生成多色 SVG（小程序 image 不能用 CSS 改 SVG 颜色）
// 用法：node tools/build-icons.js <lucide-static/icons 目录> miniprogram/assets/icons
const fs = require('fs')
const path = require('path')

const [, , src, out] = process.argv
if (!src || !out) {
  console.error('usage: node build-icons.js <lucide icons dir> <out dir>')
  process.exit(1)
}

const COLORS = {
  ink: '#1B1E25',
  mute: '#9A9EA8',
  white: '#FFFFFF',
  accent: '#1F8BC1',
  wine: '#6E2B36'
}

const ICONS = [
  'heart', 'calendar-heart', 'map', 'map-pin', 'list-checks', 'cooking-pot', 'chef-hat',
  'plus', 'minus', 'x', 'check', 'camera', 'image-plus', 'chevron-right', 'chevron-left',
  'chevron-down', 'shuffle', 'trash-2', 'pencil', 'settings', 'users', 'clock', 'calendar',
  'plane', 'graduation-cap', 'house', 'history', 'gift', 'cake', 'sparkles', 'notebook-pen',
  'utensils', 'globe', 'route', 'circle-check', 'circle', 'flag', 'user-round', 'calendar-clock',
  'rotate-ccw', 'book-open', 'moon', 'soup', 'salad', 'beef', 'ice-cream-cone', 'wheat',
  'calendar-days', 'smile', 'laugh', 'meh', 'frown', 'angry', 'coins', 'star', 'trophy', 'hand-heart',
  'list-todo', 'badge-check', 'undo-2', 'timer', 'award', 'send', 'hourglass', 'ticket', 'clipboard-check', 'droplet', 'bell'
]

ICONS.forEach((name) => {
  const file = path.join(src, name + '.svg')
  const raw = fs
    .readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*class="[^"]*"/, '')
    .replace(/stroke-width="2"/, 'stroke-width="1.75"')
    .replace(/\n\s*/g, ' ')
    .trim()
  Object.entries(COLORS).forEach(([key, hex]) => {
    const dir = path.join(out, key)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name + '.svg'), raw.replace('currentColor', hex))
  })
})

fs.copyFileSync(path.join(src, '..', 'LICENSE'), path.join(out, 'LICENSE-lucide.txt'))
console.log(`${ICONS.length} icons x ${Object.keys(COLORS).length} colors -> ${out}`)
