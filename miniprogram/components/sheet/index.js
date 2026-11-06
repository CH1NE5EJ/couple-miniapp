// 底部弹层：入场从下方弹起，退场先播动画再卸载
const LEAVE_MS = 320

Component({
  options: { multipleSlots: true },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' }
  },
  data: { mounted: false, visible: false },
  observers: {
    show(v) {
      clearTimeout(this.timer)
      if (v) {
        this.setData({ mounted: true }, () => {
          this.timer = setTimeout(() => this.setData({ visible: true }), 20)
        })
      } else if (this.data.mounted) {
        this.setData({ visible: false })
        this.timer = setTimeout(() => this.setData({ mounted: false }), LEAVE_MS)
      }
    }
  },
  lifetimes: {
    detached() {
      clearTimeout(this.timer)
    }
  },
  methods: {
    close() {
      this.triggerEvent('close')
    },
    noop() {}
  }
})
