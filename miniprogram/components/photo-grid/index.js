// 朋友圈式照片宫格：1 张按原比例显示大图；2、3 张一行；4 张排成 2×2；5 张以上三列
// 宫格里用缩略图（没有缩略图的旧照片用原图），点开用微信原生查看器看这一组的全部原图
// 用在列表里时：limit 只显示前几格（最后一格盖“+N”），lazy 滚到附近才加载，点照片不会触发外层卡片
const files = require('../../services/files')
const ui = require('../../utils/ui')

// 单张大图：长边占宽度的 66%，太宽太长的按比例截到范围内
const ONE = 66
// 离屏幕还有这么远（px）就开始加载
const AHEAD = 400

function oneBox(w, h) {
  if (!w || !h) return { w: 56, h: 56 }
  const r = w / h
  if (r >= 1) return { w: ONE, h: Math.round(ONE / Math.min(r, 2.2)) }
  return { w: Math.round(ONE * Math.max(r, 0.5)), h: ONE }
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    photos: { type: Array, value: [] },
    // [{ p: 原图, t: 缩略图 }]
    thumbs: { type: Array, value: [] },
    // 入场动画整体延后多少毫秒，跟页面其他元素排队
    delay: { type: Number, value: 0 },
    // 最多显示几格，0 表示全部显示
    limit: { type: Number, value: 0 },
    // 滚到屏幕附近才加载照片（长列表用）
    lazy: { type: Boolean, value: false },
    // 单张时用原图（详情页）；列表里用缩略图省流量
    hd: { type: Boolean, value: true }
  },
  data: { cells: [], layout: 'grid', box: { w: 56, h: 56 }, more: 0, visible: false },
  observers: {
    'photos, thumbs, limit, hd'(photos, thumbs, limit, hd) {
      this.build(photos, thumbs, limit, hd)
    }
  },
  lifetimes: {
    // 个别基础库初始化时不触发 observers，这里补一次
    attached() {
      const d = this.data
      if (!this.all && (d.photos || []).length) this.build(d.photos, d.thumbs, d.limit, d.hd)
    },
    detached() {
      if (this.io) this.io.disconnect()
      this.io = null
    }
  },
  methods: {
    build(photos, thumbs, limit, hd) {
      const all = (photos || []).filter(Boolean)
      this.all = all
      const tm = files.thumbs({ thumbs })
      const shown = limit > 0 ? all.slice(0, limit) : all
      const n = shown.length
      // 单张显示得大：详情页直接用原图（点开查看时也是这张，本机缓存能复用）
      const cells = shown.map((p) => ({ p, src: n === 1 && hd ? p : tm[p] || p }))
      const layout = n === 1 ? 'one' : n === 4 ? 'four' : 'grid'
      const more = all.length - n
      const same = this.data.cells.length === 1 && n === 1 && this.data.cells[0].p === shown[0]
      // 还没进屏幕时照片变了：根节点可能被重建（0 张 ↔ 有照片），旧的观察作废，渲染完重新观察
      if (!this.data.visible && this.io) {
        this.io.disconnect()
        this.io = null
      }
      this.setData(same ? { cells, more } : { cells, layout, more, box: oneBox(0, 0) }, () => this.watch())
    },

    // 不懒加载就直接显示；懒加载等宫格进入屏幕附近再显示，只等一次
    // 回调只认当前这一个观察（换过观察后，旧的迟到回调直接忽略）
    // nativeMode：交给系统原生观察器算，不开时基础库每次滚动都在 JS 里重算所有宫格（不认识这个参数的旧版本会忽略）
    watch() {
      if (this.data.visible || this.io || !this.data.cells.length) return
      if (!this.data.lazy || !this.createIntersectionObserver) return this.setData({ visible: true })
      const io = this.createIntersectionObserver({ nativeMode: true })
      this.io = io
      io.relativeToViewport({ top: AHEAD, bottom: AHEAD }).observe('.pg', (res) => {
        if (this.io !== io || !res || res.intersectionRatio <= 0) return
        io.disconnect()
        this.io = null
        this.setData({ visible: true })
      })
    },

    // 单张图拿到真实尺寸后，占位方块形变成照片的比例
    onOneLoad(e) {
      const { width, height } = e.detail || {}
      const box = oneBox(width, height)
      if (box.w !== this.data.box.w || box.h !== this.data.box.h) this.setData({ box })
    },

    // 查看器里是这一组的全部照片（列表只显示前几张时也能滑到后面的）
    open(e) {
      ui.tick()
      const all = this.all || []
      files.preview(all, all[e.currentTarget.dataset.index])
    }
  }
})
