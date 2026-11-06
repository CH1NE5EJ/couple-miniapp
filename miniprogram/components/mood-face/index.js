// 心情头像：有形象图（data/avatars.js）的人用自己的小人表情，没有的用心情图标
const { moodFace } = require('../../utils/avatar')

Component({
  properties: {
    role: { type: String, value: '' },
    mood: { type: String, value: '' },
    size: { type: Number, value: 96 },
    // 出场时按心情播一次动效
    animate: { type: Boolean, value: false },
    // 选择器里没被选中的样子
    muted: { type: Boolean, value: false },
    selected: { type: Boolean, value: false }
  },
  data: { f: null, play: '' },
  lifetimes: {
    // 个别基础库初始化时不触发 observers，这里补一次
    attached() {
      if (!this.data.f && this.data.mood) this.setData({ f: moodFace(this.data.role, this.data.mood) })
    }
  },
  observers: {
    'role, mood'(role, mood) {
      this.setData({ f: moodFace(role, mood) })
    },
    'animate, mood, selected'(animate) {
      if (!animate) return this.setData({ play: '' })
      // 先摘掉再加上，同一个心情再次选中也能重播
      this.setData({ play: '' }, () => setTimeout(() => this.setData({ play: 'play' }), 20))
    }
  }
})
