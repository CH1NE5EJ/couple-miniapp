// 足迹地图渲染器：Canvas 2D 画省份，支持入场扫光、点亮涟漪、选中抬起
const DATA = require('../data/china-map')

const THEME = {
  base: '#E2E7EB',
  border: '#F4F7F9',
  lit: ['#A0D4EE', '#5CB4E0', '#1F8BC1'], // 去过 1 次 / 2 次 / 3 次以上
  select: '#165E86',
  frame: '#D5DCE2',
  inset: '#F4F7F9',
  dash: '#8E99A4',
  dot: '#B5BEC6'
}

const INTRO_MS = 900
const RIPPLE_MS = 900
const SELECT_MS = 260

const ease = (t) => 1 - Math.pow(1 - t, 3)
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t)

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a, b, t) {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function litColor(count) {
  if (!count) return THEME.base
  return THEME.lit[Math.min(count, THEME.lit.length) - 1]
}

function now() {
  return Date.now()
}

class ChinaMap {
  // 画布宽高比，页面据此设置 canvas 高度
  static aspect() {
    const [x0, y0, x1, y1] = DATA.main
    return (y1 - y0) / (x1 - x0)
  }

  static provinces() {
    return DATA.provinces.map((p) => ({ code: p.code, name: p.name, short: p.short }))
  }

  constructor({ canvas, ctx, width, height, raf }) {
    this.canvas = canvas
    this.ctx = ctx
    this.w = width
    this.h = height
    this.raf = raf || ((fn) => canvas.requestAnimationFrame(fn))
    this.counts = {}
    this.anims = {}
    this.selected = null
    this.selStart = 0
    this.prevSelected = null
    this.introStart = null
    this.running = false
    this.layout()
  }

  layout() {
    const pad = 6
    const [x0, y0, x1, y1] = DATA.main
    const s = Math.min((this.w - pad * 2) / (x1 - x0), (this.h - pad * 2) / (y1 - y0))
    this.main = {
      s,
      ox: (this.w - (x1 - x0) * s) / 2 - x0 * s,
      oy: (this.h - (y1 - y0) * s) / 2 - y0 * s,
      bottom: (this.h + (y1 - y0) * s) / 2
    }

    // 南海诸岛小图放在台湾以东、海南以南的海面空白处
    const [a0, b0, a1, b1] = DATA.scs
    const iw = this.w * 0.1
    const is = iw / (a1 - a0)
    const ih = (b1 - b0) * is
    const ix = this.w - iw - pad
    const iy = this.main.bottom - ih
    this.inset = { s: is, ox: ix - a0 * is, oy: iy - b0 * is, rect: [ix, iy, iw, ih] }

    // 预先算好屏幕坐标，每帧只描路径
    const xform = (r, t) => {
      const out = new Float32Array(r.length)
      for (let i = 0; i < r.length; i += 2) {
        out[i] = r[i] * t.s + t.ox
        out[i + 1] = r[i + 1] * t.s + t.oy
      }
      return out
    }
    const [sx0, sy0, sx1, sy1] = DATA.scs
    this.shapes = DATA.provinces.map((p) => {
      const inInset = p.box[2] > sx0 && p.box[0] < sx1 && p.box[3] > sy0 && p.box[1] < sy1
      const c = [p.c[0] * s + this.main.ox, p.c[1] * s + this.main.oy]
      const bw = (p.box[2] - p.box[0]) * s
      const bh = (p.box[3] - p.box[1]) * s
      return {
        code: p.code,
        name: p.name,
        area: p.area,
        box: p.box,
        rings: p.rings,
        main: p.rings.map((r) => xform(r, this.main)),
        inset: inInset ? p.rings.map((r) => xform(r, this.inset)) : null,
        c,
        radius: Math.sqrt(bw * bw + bh * bh),
        order: 0
      }
    })
    const xs = this.shapes.map((p) => p.c[0])
    const minX = Math.min.apply(null, xs)
    const maxX = Math.max.apply(null, xs)
    this.shapes.forEach((p) => {
      p.order = (p.c[0] - minX) / (maxX - minX)
    })
    this.byCode = {}
    this.shapes.forEach((p) => {
      this.byCode[p.code] = p
    })
    this.hitOrder = this.shapes.slice().sort((a, b) => a.area - b.area)
    // 先画大省后画小省：即使设备不支持 evenodd，北京天津也不会被河北盖住
    this.drawOrder = this.hitOrder.slice().reverse()
    this.dash = DATA.nineDash.map((seg) => xform(seg, this.inset))
    this.dots = xform(DATA.dots, this.inset)
  }

  // counts: { '330000': 2, ... }，animate=true 时新点亮的省份走涟漪
  setCounts(counts, animate) {
    const t = now()
    Object.keys(this.byCode).forEach((code) => {
      const from = this.counts[code] || 0
      const to = counts[code] || 0
      if (from !== to && animate) {
        this.anims[code] = { from, to, start: t }
      }
    })
    this.counts = Object.assign({}, counts)
    this.kick()
  }

  playIntro() {
    this.introStart = now()
    this.kick()
  }

  select(code) {
    if (code === this.selected) return
    this.prevSelected = this.selected
    this.selected = code
    this.selStart = now()
    this.kick()
  }

  // 触点坐标（相对画布）→ 省份 code
  hitTest(x, y) {
    const [ix, iy, iw, ih] = this.inset.rect
    const inInset = x >= ix && x <= ix + iw && y >= iy && y <= iy + ih
    const t = inInset ? this.inset : this.main
    const px = (x - t.ox) / t.s
    const py = (y - t.oy) / t.s
    const tol = 14 / t.s // 小省份（港澳）给一点容差
    let near = null
    let nearD = Infinity
    for (const p of this.hitOrder) {
      const [x0, y0, x1, y1] = p.box
      if (px < x0 - tol || px > x1 + tol || py < y0 - tol || py > y1 + tol) continue
      if (pointInRings(px, py, p.rings)) return p.code
      if (p.area < 20000) {
        const d = Math.hypot(px - (x0 + x1) / 2, py - (y0 + y1) / 2)
        if (d < nearD) {
          nearD = d
          near = p.code
        }
      }
    }
    return near
  }

  kick() {
    if (this.running) return
    this.running = true
    const loop = () => {
      const busy = this.draw()
      if (busy) {
        this.raf(loop)
      } else {
        this.running = false
      }
    }
    this.raf(loop)
  }

  tracePath(rings) {
    const ctx = this.ctx
    ctx.beginPath()
    for (const r of rings) {
      ctx.moveTo(r[0], r[1])
      for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1])
      ctx.closePath()
    }
  }

  // 返回 true 表示还有动画在跑
  draw() {
    const ctx = this.ctx
    const t = now()
    let busy = false
    ctx.clearRect(0, 0, this.w, this.h)

    const introK = this.introStart === null ? 1 : (t - this.introStart) / INTRO_MS

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, this.w, this.main.bottom + 2)
    ctx.clip()
    ctx.lineJoin = 'round'

    for (const p of this.drawOrder) {
      // 入场：自西向东依次浮现
      const a = clamp01((introK - p.order * 0.55) / 0.45)
      if (a < 1) busy = true
      ctx.globalAlpha = ease(a)

      const anim = this.anims[p.code]
      const count = this.counts[p.code] || 0
      if (anim) {
        const k = clamp01((t - anim.start) / RIPPLE_MS)
        if (k >= 1) {
          delete this.anims[p.code]
        } else {
          busy = true
        }
        this.drawRipple(p, anim, ease(k))
      } else {
        this.tracePath(p.main)
        ctx.fillStyle = litColor(count)
        ctx.fill('evenodd')
      }
      ctx.strokeStyle = THEME.border
      ctx.lineWidth = 0.8
      this.tracePath(p.main)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // 选中：抬起 + 描边，旧的选中反向落下
    const sk = clamp01((t - this.selStart) / SELECT_MS)
    if (sk < 1) busy = true
    if (this.prevSelected && sk < 1) this.drawLift(this.byCode[this.prevSelected], 1 - ease(sk))
    if (this.selected) this.drawLift(this.byCode[this.selected], ease(sk))
    ctx.restore()

    this.drawInset(introK)
    if (introK < 1) busy = true
    return busy
  }

  drawRipple(p, anim, k) {
    const ctx = this.ctx
    const grow = anim.to > anim.from
    const fromColor = litColor(anim.from)
    const toColor = litColor(anim.to)
    this.tracePath(p.main)
    ctx.fillStyle = fromColor
    ctx.fill('evenodd')
    ctx.save()
    this.tracePath(p.main)
    ctx.clip('evenodd')
    ctx.beginPath()
    const r = p.radius * (grow ? k : 1 - k) + 0.01
    ctx.arc(p.c[0], p.c[1], r, 0, Math.PI * 2)
    ctx.fillStyle = grow ? toColor : fromColor
    if (!grow) {
      // 熄灭：先铺目标色，再让旧颜色收缩回中心
      this.tracePath(p.main)
      ctx.fillStyle = toColor
      ctx.fill('evenodd')
      ctx.beginPath()
      ctx.arc(p.c[0], p.c[1], r, 0, Math.PI * 2)
      ctx.fillStyle = fromColor
    }
    ctx.fill()
    // 涟漪外圈的一道亮边
    if (grow && k < 1) {
      ctx.beginPath()
      ctx.arc(p.c[0], p.c[1], r, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.restore()
  }

  drawLift(p, k) {
    if (!p || k <= 0) return
    const ctx = this.ctx
    const count = this.counts[p.code] || 0
    ctx.save()
    ctx.translate(0, -2 * k)
    ctx.shadowColor = `rgba(27,30,37,${0.28 * k})`
    ctx.shadowBlur = 14 * k
    ctx.shadowOffsetY = 4 * k
    this.tracePath(p.main)
    ctx.fillStyle = count ? litColor(count) : mix(THEME.base, '#C9D2D9', k)
    ctx.fill('evenodd')
    ctx.shadowColor = 'rgba(0,0,0,0)'
    ctx.strokeStyle = THEME.select
    ctx.globalAlpha = k
    ctx.lineWidth = 1.6
    this.tracePath(p.main)
    ctx.stroke()
    ctx.restore()
  }

  drawInset(introK) {
    const ctx = this.ctx
    const [x, y, w, h] = this.inset.rect
    const a = ease(clamp01((introK - 0.6) / 0.4))
    ctx.save()
    ctx.globalAlpha = a
    roundRect(ctx, x, y, w, h, 6)
    ctx.fillStyle = THEME.inset
    ctx.fill()
    ctx.strokeStyle = THEME.frame
    ctx.lineWidth = 1
    ctx.stroke()
    roundRect(ctx, x, y, w, h, 6)
    ctx.clip()
    for (const p of this.shapes) {
      if (!p.inset) continue
      this.tracePath(p.inset)
      ctx.fillStyle = litColor(this.counts[p.code] || 0)
      ctx.fill('evenodd')
    }
    ctx.fillStyle = THEME.dot
    for (let i = 0; i < this.dots.length; i += 2) {
      ctx.beginPath()
      ctx.arc(this.dots[i], this.dots[i + 1], 0.7, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = THEME.dash
    ctx.lineWidth = 1
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (const s of this.dash) {
      ctx.moveTo(s[0], s[1])
      ctx.lineTo(s[2], s[3])
    }
    ctx.stroke()
    ctx.restore()
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

// 奇偶规则，自动处理省界里的“洞”（如河北包着北京天津）
function pointInRings(x, y, rings) {
  let inside = false
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i]
      const yi = r[i + 1]
      const xj = r[j]
      const yj = r[j + 1]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

module.exports = { ChinaMap, THEME, pointInRings }
