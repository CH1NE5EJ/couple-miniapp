// 加载页：默认是心跳动画（主题色的心 + 两圈波纹）；config.js 填了 loadingImage 就显示那张图
// 页面没有任何本地数据、只能等云端时才用；leaving 时淡出收起，页面内容同时进场
const config = require('../../config')

Component({
  properties: {
    text: { type: String, value: '正在加载' },
    leaving: { type: Boolean, value: false }
  },
  data: { art: config.loadingImage || '' }
})
