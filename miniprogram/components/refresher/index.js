// 下拉刷新时露出来的那一块：和加载页一样，默认心跳动画，config.js 填了 loadingImage 就显示那张图
// active 时才挂上：每次下拉都从头开始播，平时不在后台空转
const config = require('../../config')

Component({
  properties: {
    active: { type: Boolean, value: false }
  },
  data: { art: config.loadingImage || '' }
})
