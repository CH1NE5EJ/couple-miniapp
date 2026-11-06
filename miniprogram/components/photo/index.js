// 显示一张照片
// 云文件不能直接放进组件里的 image（会被当成相对路径），先存进本机再显示（下次打开直接读本机）；
// 存不了的用临时链接，临时链接只有十几分钟有效，加载失败就换一条新链接重试一次；失败情况记到云端，方便远程排查
const files = require('../../services/files')
const cache = require('../../services/img-cache')
const diag = require('../../services/diag')

const kindOf = (u) => (files.isCloud(u) ? 'fileID' : /^https:/.test(u || '') ? 'https' : 'local')

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    src: { type: String, value: '' },
    mode: { type: String, value: 'aspectFill' },
    // 兼容旧写法，组件里不做懒加载
    lazy: { type: Boolean, value: false },
    // 铺满最近的定位父元素，加载完淡入（给其他组件里用，组件间样式不互通）
    fill: { type: Boolean, value: false },
    custom: { type: String, value: '' }
  },
  data: { url: '', loaded: false },
  observers: {
    src(v) {
      this.show(v)
    }
  },
  lifetimes: {
    // 个别基础库初始化时不触发 observers，这里补一次
    attached() {
      if (this.data.src && !this.data.url) this.show(this.data.src)
    }
  },
  methods: {
    show(v, fresh) {
      if (!fresh) this.retried = false
      if (!v) return this.setData({ url: '', loaded: false })
      const hit = fresh ? '' : files.isCloud(v) ? cache.local(v) : v
      if (hit) return this.setData({ url: hit })
      this.setData({ url: '', loaded: false })
      files.load(v, { fresh: !!fresh }).then((u) => {
        if (this.data.src !== v) return
        if (u) this.setData({ url: u })
        else diag.report('photo-no-url', { fresh: !!fresh })
      })
    },

    onLoad(e) {
      if (!this.data.loaded) this.setData({ loaded: true })
      if (kindOf(this.data.url) === 'https') diag.report('image-ok', { kind: 'https' })
      const d = (e && e.detail) || {}
      this.triggerEvent('load', { width: d.width || 0, height: d.height || 0 })
    },

    onError(e) {
      const v = this.data.src
      const kind = kindOf(this.data.url)
      diag.report('image-error', { kind, retried: !!this.retried, err: ((e && e.detail && e.detail.errMsg) || '').slice(0, 160) })
      if (!files.isCloud(v) || this.retried) return
      // 本机文件被清理了：删掉缓存记录重新下载；临时链接多半是过期了：换一条新的
      this.retried = true
      if (kind === 'local') cache.drop(v)
      else files.invalidate(v)
      this.show(v, true)
    }
  }
})
