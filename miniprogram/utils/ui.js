// 交互小工具：轻反馈、提示、数字滚动、带退场动画的删除
function tick(type) {
  try {
    wx.vibrateShort({ type: type || 'light' })
  } catch (e) {
    // 部分机型不支持
  }
}

function toast(title, icon) {
  wx.showToast({ title, icon: icon || 'none', duration: 1800 })
}

function fail(err, fallback) {
  console.error(err)
  toast((err && err.message) || fallback || '出了点问题')
}

function confirm(title, content, confirmText) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText: confirmText || '确定',
      confirmColor: '#6E2B36',
      cancelColor: '#555B69',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false)
    })
  })
}

// 数字从 from 滚到 to，期间多次调用 onFrame
function countUp(from, to, duration, onFrame) {
  const start = Date.now()
  const steps = () => {
    const k = Math.min(1, (Date.now() - start) / duration)
    const e = 1 - Math.pow(1 - k, 3)
    onFrame(Math.round(from + (to - from) * e))
    if (k < 1) setTimeout(steps, 32)
  }
  steps()
}

// 列表项先播退场动画再真正移除：给 key 对应项加 leaving 标记，等动画结束回调
function leave(page, listKey, id, done, ms) {
  const list = page.data[listKey] || []
  const index = list.findIndex((x) => x._id === id)
  if (index < 0) return done && done()
  page.setData({ [`${listKey}[${index}].leaving`]: true })
  setTimeout(() => done && done(), ms || 320)
}

// tab 页 onShow 里同步底栏选中位置
function showTab(page, index) {
  if (typeof page.getTabBar === 'function') {
    const bar = page.getTabBar()
    if (bar) bar.show(index)
  }
}

// 弹层打开时收起底栏（自定义底栏自己滑下去、不接收点击），关上时滑回来
// 不要调用 wx.hideTabBar / wx.showTabBar：用了自定义底栏时，真机上 showTabBar 会把原生底栏（app.json 里那组文字）显示出来，
// 和自定义底栏上下叠成两组，直到小程序重启
function hideTab(page, hidden) {
  const bar = typeof page.getTabBar === 'function' ? page.getTabBar() : null
  if (bar) bar.setHidden(!!hidden)
}

module.exports = { tick, toast, fail, confirm, countUp, leave, showTab, hideTab }
