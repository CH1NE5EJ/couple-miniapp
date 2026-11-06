// 开发用：检查 WXML 标签是否配对、{{ }} 是否成对
// 用法：node tools/check-wxml.js miniprogram
const fs = require('fs')
const path = require('path')

const root = process.argv[2] || 'miniprogram'
const VOID = new Set(['image', 'input', 'icon', 'import', 'include', 'wxs'])
let problems = 0

function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walk(p)
    else if (p.endsWith('.wxml')) check(p)
  })
}

function check(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const opens = (src.match(/\{\{/g) || []).length
  const closes = (src.match(/\}\}/g) || []).length
  if (opens !== closes) report(file, `{{ 有 ${opens} 个，}} 有 ${closes} 个`)

  const stack = []
  const re = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let m
  while ((m = re.exec(src))) {
    const [all, name, , selfClose] = m
    const line = src.slice(0, m.index).split('\n').length
    if (all.startsWith('</')) {
      const top = stack.pop()
      if (!top || top.name !== name) {
        report(file, `第 ${line} 行 </${name}> 对不上 ${top ? '<' + top.name + '>（第 ' + top.line + ' 行）' : '（没有开标签）'}`)
        return
      }
    } else if (!selfClose && !VOID.has(name)) {
      stack.push({ name, line })
    }
  }
  if (stack.length) report(file, `没闭合：${stack.map((s) => `<${s.name}> 第 ${s.line} 行`).join('，')}`)
}

function report(file, msg) {
  problems += 1
  console.log(`${file}: ${msg}`)
}

walk(root)
console.log(problems ? `${problems} 个问题` : 'WXML 检查通过')
process.exit(problems ? 1 : 0)
