// 分段切换：底下一块滑块在选项之间平移，像形状变形一样跟过去
Component({
  properties: {
    items: { type: Array, value: [] }, // [{ key, label, badge }]
    value: { type: String, value: '' }
  },
  data: { index: 0 },
  observers: {
    'items, value'(items, value) {
      const i = items.findIndex((x) => x.key === value)
      this.setData({ index: i < 0 ? 0 : i })
    }
  },
  methods: {
    pick(e) {
      const { key } = e.currentTarget.dataset
      if (key === this.data.value) return
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (err) {
        // ignore
      }
      this.triggerEvent('change', { key })
    }
  }
})
