// 自定义底栏：每个 tab 页各有一个实例，所以先停在上一个位置，再滑到当前位置
const notify = require('../services/notify')

const TABS = [
  { path: '/pages/home/index', text: '我们', icon: 'heart' },
  { path: '/pages/calendar/index', text: '日历', icon: 'calendar-days' },
  { path: '/pages/map/index', text: '足迹', icon: 'map' },
  { path: '/pages/plans/index', text: '计划', icon: 'list-checks' },
  { path: '/pages/menu/index', text: '点菜', icon: 'cooking-pot' }
]

Component({
  data: { tabs: TABS, selected: 0, still: true, hidden: false },

  lifetimes: {
    attached() {
      const g = getApp().globalData
      this.setData({ selected: g.tabFrom, still: true })
    }
  },

  methods: {
    // 页面 onShow 里调用
    show(index) {
      const g = getApp().globalData
      const from = g.tabFrom
      g.tabIndex = index
      g.tabFrom = index
      if (from === index) {
        if (this.data.selected !== index) this.setData({ selected: index, still: true })
        return
      }
      this.setData({ selected: from, still: true }, () => {
        setTimeout(() => this.setData({ selected: index, still: false }), 30)
      })
    },

    // 页面里弹出底部弹层时让底栏滑下去，否则底栏会盖住弹层
    setHidden(hidden) {
      if (hidden !== this.data.hidden) this.setData({ hidden })
    },

    // 切换功能不震动；顺手续上微信通知的条数（只在用户勾了总是允许时，不会弹窗）
    go(e) {
      const index = e.currentTarget.dataset.index
      if (index === this.data.selected) return
      notify.topUp()
      getApp().globalData.tabFrom = this.data.selected
      wx.switchTab({ url: TABS[index].path })
    }
  }
})
