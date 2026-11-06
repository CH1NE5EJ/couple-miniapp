// 把 DataV 省级 GeoJSON 预处理成小程序可直接画的整数坐标
// 用法：node tools/build-map.js <100000_full.json> miniprogram/data/china-map.js
// 投影：Albers 等积圆锥（标准纬线 25°N / 47°N，中央经线 105°E），国内地图常用
const fs = require('fs')

const [, , src, out] = process.argv
if (!src || !out) {
  console.error('usage: node build-map.js <geojson> <out.js>')
  process.exit(1)
}

const geo = JSON.parse(fs.readFileSync(src, 'utf8'))

const D = Math.PI / 180
const PHI1 = 25 * D
const PHI2 = 47 * D
const LAM0 = 105 * D
const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1)
const RHO0 = Math.sqrt(C) / N
const SCALE = 10000
const TOL = 6 // 简化容差（投影单位），屏幕上约 0.2px
const MIN_AREA = 600 // 小于此面积的岛屿环直接丢弃
const SCS_LAT = 17.5 // 低于此纬度的归入南海小图

function project(lng, lat) {
  const rho = Math.sqrt(C - 2 * N * Math.sin(lat * D)) / N
  const theta = N * (lng * D - LAM0)
  return [rho * Math.sin(theta) * SCALE, -(RHO0 - rho * Math.cos(theta)) * SCALE]
}

function sqSegDist(p, a, b) {
  let x = a[0]
  let y = a[1]
  let dx = b[0] - x
  let dy = b[1] - y
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x = b[0]
      y = b[1]
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }
  dx = p[0] - x
  dy = p[1] - y
  return dx * dx + dy * dy
}

function simplify(points, tol) {
  if (points.length <= 4) return points
  const sqTol = tol * tol
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxD = 0
    let idx = 0
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > sqTol) {
      keep[idx] = 1
      stack.push([first, idx], [idx, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

function area(points) {
  let s = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    s += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1])
  }
  return Math.abs(s / 2)
}

function polygonsOf(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

function flat(points) {
  const arr = []
  points.forEach((p) => arr.push(Math.round(p[0]), Math.round(p[1])))
  return arr
}

const bbox = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
function grow(b, x, y) {
  if (x < b.x0) b.x0 = x
  if (y < b.y0) b.y0 = y
  if (x > b.x1) b.x1 = x
  if (y > b.y1) b.y1 = y
}

const mainBox = bbox()
const scsBox = bbox()
const provinces = []
const dots = []
const nineDash = []
let rawPoints = 0
let keptPoints = 0

geo.features.forEach((f) => {
  const p = f.properties
  const isDash = String(p.adcode).endsWith('_JD')
  const rings = []
  let candidates = []

  polygonsOf(f.geometry).forEach((poly) => {
    poly.forEach((ring) => {
      rawPoints += ring.length
      const pts = ring.slice(0, -1).map(([lng, lat]) => project(lng, lat))
      const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length
      const simple = simplify(pts, isDash ? 3 : TOL)
      candidates.push({ pts: simple, area: area(pts), avgLat })
    })
  })

  if (isDash) {
    // 每一段虚线是细长多边形，小图里不到 1px 宽，取最远两点当线段来描
    candidates.forEach((c) => {
      let best = [c.pts[0], c.pts[0]]
      let bestD = -1
      c.pts.forEach((a) =>
        c.pts.forEach((b) => {
          const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
          if (d > bestD) {
            bestD = d
            best = [a, b]
          }
        })
      )
      nineDash.push(flat(best))
      c.pts.forEach(([x, y]) => grow(scsBox, x, y))
    })
    return
  }

  const largest = candidates.reduce((a, b) => (b.area > a.area ? b : a))
  candidates.forEach((c) => {
    if (c.avgLat < SCS_LAT) {
      // 南海岛礁：太小画不出形状，记成点
      if (c.area < MIN_AREA * 4 || c.pts.length < 4) {
        const cx = c.pts.reduce((s, q) => s + q[0], 0) / c.pts.length
        const cy = c.pts.reduce((s, q) => s + q[1], 0) / c.pts.length
        dots.push(Math.round(cx), Math.round(cy))
        return
      }
    } else if (c !== largest && (c.area < MIN_AREA || c.pts.length < 4)) {
      return
    }
    rings.push(flat(c.pts))
    keptPoints += c.pts.length
    if (c.avgLat >= SCS_LAT) c.pts.forEach(([x, y]) => grow(mainBox, x, y))
  })

  const b = bbox()
  rings.forEach((r) => {
    for (let i = 0; i < r.length; i += 2) grow(b, r[i], r[i + 1])
  })
  const centroid = p.centroid || p.center
  const [cx, cy] = project(centroid[0], centroid[1])

  provinces.push({
    code: String(p.adcode),
    name: p.name,
    short: p.name.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/, ''),
    c: [Math.round(cx), Math.round(cy)],
    box: [b.x0, b.y0, b.x1, b.y1],
    area: Math.round(largest.area),
    rings
  })
})

const pad = (b, k) => {
  const dx = (b.x1 - b.x0) * k
  const dy = (b.y1 - b.y0) * k
  return [Math.round(b.x0 - dx), Math.round(b.y0 - dy), Math.round(b.x1 + dx), Math.round(b.y1 + dy)]
}

const data = {
  main: pad(mainBox, 0.01),
  scs: pad(scsBox, 0.06),
  provinces,
  dots,
  nineDash
}

const banner =
  '// 由 tools/build-map.js 生成，请勿手改\n' +
  '// 底图数据：阿里云 DataV.GeoAtlas 省级边界（areas_v3/bound/100000_full.json），Albers 投影后简化\n'
fs.writeFileSync(out, banner + 'module.exports = ' + JSON.stringify(data) + '\n')

console.log(
  `provinces=${provinces.length} rings=${provinces.reduce((s, p) => s + p.rings.length, 0)} ` +
    `points ${rawPoints} -> ${keptPoints} dots=${dots.length / 2} dash=${nineDash.length} ` +
    `size=${(fs.statSync(out).size / 1024).toFixed(1)}KB main=${data.main} scs=${data.scs}`
)
