// 心情选择器：写心情、旅行点评共用。心情选项来自 data/points.js 的 MOODS，头像用 ui-mood-face
const { MOODS } = require('../../data/points')

Component({
  properties: {
    role: { type: String, value: '' },
    value: { type: String, value: '' },
    size: { type: Number, value: 96 }
  },
  data: { moods: MOODS },
  methods: {
    pick(e) {
      const key = e.currentTarget.dataset.key
      try {
        wx.vibrateShort({ type: 'medium' })
      } catch (err) {
        // 部分机型不支持
      }
      this.triggerEvent('change', { key })
    }
  }
})
