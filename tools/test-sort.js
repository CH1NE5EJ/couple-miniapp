// 编辑页照片拖动排序（pages/trip-edit/sort.wxs）的逻辑测试
// WXS 在视图层运行，开发者工具的自动化触发不到，这里用假的组件对象把完整拖动走一遍
// 用法：node tools/test-sort.js
const assert = require('assert')
const path = require('path')

const sort = require(path.join(__dirname, '..', 'miniprogram', 'pages', 'trip-edit', 'sort.wxs'))

function cell(key) {
  return {
    key,
    style: {},
    classes: new Set(),
    getDataset: () => ({ key }),
    setStyle(s) {
      Object.assign(this.style, s)
    },
    addClass(c) {
      this.classes.add(c)
    },
    removeClass(c) {
      this.classes.delete(c)
    }
  }
}

const keys = ['a', 'b', 'c', 'd', 'e']
const cells = keys.map(cell).concat(cell('__add'))
const calls = []
let frames = []
const state = {}
const owner = {
  getState: () => state,
  selectAllComponents: (sel) => (sel === '.settling' ? cells.filter((c) => c.classes.has('settling')) : cells),
  callMethod: (name, args) => calls.push([name, args]),
  requestAnimationFrame: (fn) => frames.push(fn)
}
const byKey = (k) => cells.find((c) => c.key === k)
// 松手提交：照片、目标位置，以及拖动时看到的顺序
const expectEnd = (key, to) => {
  const c = calls.pop()
  assert.strictEqual(c[0], 'onDragEnd')
  assert.strictEqual(c[1].key, key)
  assert.strictEqual(c[1].to, to)
  assert.ok(Array.isArray(c[1].order) && c[1].order.indexOf(key) >= 0)
}
const pos = (k) => byKey(k).style.transform.replace(/ scale\(.*\)/, '')
// 页面滚动 scrollTop 时，pageY = clientY + scrollTop
let scrollTop = 0
const touch = (x, y) => ({ clientX: x, clientY: y, pageX: x, pageY: y + scrollTop })
const ev = (k, x, y) => ({ touches: [touch(x, y)], currentTarget: { dataset: { key: k } }, instance: byKey(k) })
const runFrames = (n) => {
  for (let i = 0; i < n && frames.length; i++) {
    const f = frames.shift()
    f()
  }
}

// 100px 格子、10px 间距、3 列；页面可视高度 600
const g = { order: keys.slice(), size: 100, gap: 10, cols: 3, vh: 600 }
sort.layout(g, null, owner)
assert.strictEqual(pos('a'), 'translate3d(0px,0px,0)')
assert.strictEqual(pos('d'), 'translate3d(0px,110px,0)')
assert.strictEqual(pos('__add'), 'translate3d(220px,110px,0)', '添加按钮排在最后一张后面')

// 没长按就移动：是在滚页面，不拦截
sort.start(ev('a', 50, 250), owner)
assert.strictEqual(sort.move(ev('a', 60, 400), owner), undefined)
sort.end(ev('a', 60, 400), owner)
assert.strictEqual(calls.length, 0)

// 长按 a，拖到第二行第二格（e 原来的位置）
sort.start(ev('a', 50, 250), owner)
sort.longpress(ev('a', 50, 250), owner)
assert.ok(byKey('a').classes.has('dragging'))
assert.deepStrictEqual(calls.shift(), ['onDragStart', undefined])
assert.strictEqual(sort.move(ev('a', 160, 250), owner), false, '拖动中阻止页面滚动')
// 到了 b 的位置：b 让到第一格
assert.strictEqual(pos('b'), 'translate3d(0px,0px,0)')
assert.deepStrictEqual(calls.shift(), ['onDragOver', undefined])
sort.move(ev('a', 160, 360), owner)
// a 在第 5 格（下标 4），b c d e 往前补位
assert.strictEqual(pos('e'), 'translate3d(0px,110px,0)')
assert.strictEqual(pos('d'), 'translate3d(220px,0px,0)')
sort.end(ev('a', 160, 360), owner)
assert.ok(!byKey('a').classes.has('dragging'))
assert.ok(byKey('a').classes.has('settling'), '吸附动画里仍压在上面')
assert.strictEqual(byKey('a').style.transform, 'translate3d(110px,110px,0)', '松手吸附到目标格')
expectEnd('a', 4)

// 拖出宫格下方很远：落在最后一张；下一次长按收掉上次的“压在上面”
calls.length = 0
sort.layout(Object.assign({}, g, { order: ['b', 'c', 'd', 'e', 'a'] }), null, owner)
sort.start(ev('b', 50, 250), owner)
sort.longpress(ev('b', 50, 250), owner)
assert.ok(!byKey('a').classes.has('settling'))
sort.move(ev('b', 50, 500), owner)
sort.end(ev('b', 50, 500), owner)
expectEnd('b', 4)
frames = []

// 拖一圈回到原位：不提交
calls.length = 0
sort.layout(Object.assign({}, g, { order: keys.slice() }), null, owner)
sort.start(ev('c', 250, 250), owner)
sort.longpress(ev('c', 250, 250), owner)
sort.move(ev('c', 50, 250), owner)
sort.move(ev('c', 250, 250), owner)
sort.end(ev('c', 250, 250), owner)
assert.ok(!calls.some((c) => c[0] === 'onDragEnd'))

// 拖动中第二根手指碰到别的照片：不打断、不串位
calls.length = 0
sort.layout(Object.assign({}, g, { order: keys.slice() }), null, owner)
sort.start(ev('a', 50, 250), owner)
sort.longpress(ev('a', 50, 250), owner)
sort.move(ev('a', 160, 250), owner)
sort.start(ev('c', 250, 250), owner)
sort.longpress(ev('c', 250, 250), owner)
assert.strictEqual(sort.move(ev('c', 260, 300), owner), undefined, '第二根手指的移动不处理')
sort.end(ev('c', 260, 300), owner)
assert.ok(byKey('a').classes.has('dragging'), '原来那张还在拖')
assert.ok(!byKey('c').classes.has('dragging'))
sort.end(ev('a', 160, 250), owner)
expectEnd('a', 1)

// 拖到屏幕下边缘：页面自动往下滚，照片跟着手指；到宫格最后一行就停
calls.length = 0
frames = []
const tall = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11']
tall.forEach((k) => cells.push(cell(k)))
const gt = { order: tall.slice(), size: 100, gap: 10, cols: 3, vh: 600 }
sort.layout(gt, null, owner)
scrollTop = 1000
sort.start(ev('p0', 50, 300), owner)
sort.longpress(ev('p0', 50, 300), owner)
sort.move(ev('p0', 50, 590), owner)
assert.ok(frames.length === 1, '进入边缘开始逐帧滚动')
runFrames(200)
const scrolls = calls.filter((c) => c[0] === 'dragScroll')
// 离最后一行还有 40px，靠边速度每帧 16px：16 + 16 + 8，分 3 帧滚到
assert.strictEqual(scrolls.length, 3, '逐帧滚动')
const lastTop = scrolls[scrolls.length - 1][1].top
assert.ok(lastTop > 1000, '往下滚')
// 最后一行 y = 3 * 110 = 330；手指在 590，起点 300，所以滚动距离 = 330 - 290 = 40
assert.strictEqual(lastTop - 1000, 40, '照片到宫格最后一行就不再滚')
assert.strictEqual(pos('p0'), 'translate3d(0px,330px,0)')
sort.end(ev('p0', 50, 590), owner)
expectEnd('p0', 9)
runFrames(5)
assert.strictEqual(frames.length, 0, '松手后不再滚')

// 拖到屏幕上边缘：往上滚，到宫格第一行停
calls.length = 0
frames = []
sort.layout(gt, null, owner)
sort.start(ev('p9', 50, 300), owner)
sort.longpress(ev('p9', 50, 300), owner)
sort.move(ev('p9', 50, 10), owner)
runFrames(200)
const ups = calls.filter((c) => c[0] === 'dragScroll')
assert.ok(ups.length > 0 && ups[ups.length - 1][1].top < 1000, '往上滚')
assert.strictEqual(pos('p9'), 'translate3d(0px,0px,0)')
sort.end(ev('p9', 50, 10), owner)
expectEnd('p9', 0)

// 照片已经拖到宫格第一行上面，手指在屏幕上边缘：不滚（更不能往下滚）
calls.length = 0
frames = []
sort.layout(gt, null, owner)
sort.start(ev('p3', 50, 300), owner)
sort.longpress(ev('p3', 50, 300), owner)
sort.move(ev('p3', 50, 20), owner)
runFrames(50)
assert.ok(!calls.some((c) => c[0] === 'dragScroll'), '照片在宫格上方时不滚动')
sort.end(ev('p3', 50, 20), owner)
frames = []

// 拖动中顺序被别处改了：松手时按新顺序摆，不提交过期的位置
calls.length = 0
sort.layout(Object.assign({}, g, { order: keys.slice() }), null, owner)
sort.start(ev('a', 50, 250), owner)
sort.longpress(ev('a', 50, 250), owner)
sort.move(ev('a', 160, 250), owner)
sort.layout(Object.assign({}, g, { order: ['e', 'd', 'c', 'b', 'a'] }), null, owner)
sort.end(ev('a', 160, 250), owner)
assert.ok(!calls.some((c) => c[0] === 'onDragEnd'))
assert.strictEqual(pos('e'), 'translate3d(0px,0px,0)')
assert.strictEqual(pos('a'), 'translate3d(110px,110px,0)')

// 多指：按编号认拖动的那根手指，另一根手指的位置不算
calls.length = 0
sort.layout(Object.assign({}, g, { order: keys.slice() }), null, owner)
const tid = (id, x, y) => Object.assign(touch(x, y), { identifier: id })
sort.start({ changedTouches: [tid(7, 50, 250)], touches: [tid(7, 50, 250)], currentTarget: { dataset: { key: 'a' } }, instance: byKey('a') }, owner)
sort.longpress({ touches: [tid(7, 50, 250)], currentTarget: { dataset: { key: 'a' } }, instance: byKey('a') }, owner)
sort.move({ touches: [tid(9, 400, 400), tid(7, 160, 250)], currentTarget: { dataset: { key: 'a' } }, instance: byKey('a') }, owner)
assert.strictEqual(pos('b'), 'translate3d(0px,0px,0)', '跟着 7 号手指走到第二格')
// 9 号手指抬起（7 号还按着）：不算松手
sort.end({ touches: [tid(7, 160, 250)], changedTouches: [tid(9, 400, 400)], currentTarget: { dataset: { key: 'a' } }, instance: byKey('a') }, owner)
assert.ok(byKey('a').classes.has('dragging'))
sort.end({ touches: [], changedTouches: [tid(7, 160, 250)], currentTarget: { dataset: { key: 'a' } }, instance: byKey('a') }, owner)
expectEnd('a', 1)

// 拖动中被拖的那张没了（刷新掉、被删）：拖动作废，后面还能正常拖
calls.length = 0
sort.layout(Object.assign({}, g, { order: keys.slice() }), null, owner)
sort.start(ev('a', 50, 250), owner)
sort.longpress(ev('a', 50, 250), owner)
sort.move(ev('a', 160, 250), owner)
sort.layout(Object.assign({}, g, { order: ['b', 'c', 'd', 'e'] }), null, owner)
assert.ok(!byKey('a').classes.has('dragging'))
assert.strictEqual(pos('b'), 'translate3d(0px,0px,0)')
sort.start(ev('c', 250, 250), owner)
sort.longpress(ev('c', 250, 250), owner)
assert.ok(byKey('c').classes.has('dragging'), '还能开始新的拖动')
sort.move(ev('c', 50, 250), owner)
sort.end(ev('c', 50, 250), owner)
expectEnd('c', 0)

// 拖动的那根手指的松手没收到：下一次按下时先把上一次作废
calls.length = 0
sort.layout(Object.assign({}, g, { order: keys.slice() }), null, owner)
sort.start({ changedTouches: [tid(3, 50, 250)], touches: [tid(3, 50, 250)], currentTarget: { dataset: { key: 'a' } }, instance: byKey('a') }, owner)
sort.longpress({ touches: [tid(3, 50, 250)], currentTarget: { dataset: { key: 'a' } }, instance: byKey('a') }, owner)
sort.start({ changedTouches: [tid(4, 250, 250)], touches: [tid(4, 250, 250)], currentTarget: { dataset: { key: 'c' } }, instance: byKey('c') }, owner)
assert.ok(!byKey('a').classes.has('dragging'), '上一次作废')
sort.longpress({ touches: [tid(4, 250, 250)], currentTarget: { dataset: { key: 'c' } }, instance: byKey('c') }, owner)
assert.ok(byKey('c').classes.has('dragging'))
sort.end({ touches: [], changedTouches: [tid(4, 250, 250)], currentTarget: { dataset: { key: 'c' } }, instance: byKey('c') }, owner)

// 添加按钮、只有一张照片时不能拖
calls.length = 0
sort.layout(Object.assign({}, g, { order: keys.slice() }), null, owner)
sort.start(ev('__add', 250, 160), owner)
sort.longpress(ev('__add', 250, 160), owner)
sort.layout(Object.assign({}, g, { order: ['a'] }), null, owner)
sort.start(ev('a', 50, 50), owner)
sort.longpress(ev('a', 50, 50), owner)
assert.strictEqual(calls.length, 0)

console.log('ok  拖动排序：长按才能拖、拖动中不滚页面、其他照片让位、松手吸附并提交、多指不串、边缘自动滚动')
