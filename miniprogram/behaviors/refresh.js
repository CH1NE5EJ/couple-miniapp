// 自定义下拉刷新：页面内容放在 scroll-view 里（自带的下拉刷新只能显示三个点），下拉时露出加载动画（components/refresher）
// 页面照旧写 onPullDownRefresh，结束时调用 this.stopRefresh()（代替 wx.stopPullDownRefresh）
// wxml 里 scroll-view 绑定：refresher-triggered="{{refreshing}}"、bindrefresherpulling / refresh / restore / abort，
// 以及 <ui-refresher slot="refresher" active="{{pulling || refreshing}}" />

// 松手后至少停这么久，加载动画能看到
const MIN_SHOW = 800
// 刷新区收回去的动画时间，收完再摘掉动图
const CLOSE = 300

module.exports = Behavior({
  data: { refreshing: false, pulling: false },

  methods: {
    onRefresherPulling() {
      this.pullToken = (this.pullToken || 0) + 1
      if (!this.data.pulling) this.setData({ pulling: true })
    },

    onRefresherRefresh() {
      this.refreshAt = Date.now()
      this.pullToken = (this.pullToken || 0) + 1
      this.setData({ refreshing: true, pulling: true })
      this.onPullDownRefresh()
    },

    stopRefresh() {
      const wait = Math.max(0, MIN_SHOW - (Date.now() - (this.refreshAt || 0)))
      setTimeout(() => this.setData({ refreshing: false }), wait)
    },

    // 收回（刷新完）或没拉到位松手：等收回动画放完再摘动图；期间又拉了就不摘
    onRefresherDone() {
      const token = (this.pullToken = (this.pullToken || 0) + 1)
      setTimeout(() => {
        if (this.pullToken === token && !this.data.refreshing) this.setData({ pulling: false })
      }, CLOSE)
    }
  }
})
