// 真机诊断：图片加载失败、换链接失败时记一笔到云端（只记错误和设备信息，不记照片内容）
// 同一种问题每次启动只记一次，避免刷屏
const db = require('./db')

const sent = {}
let info = null

function sys() {
  if (info) return info
  try {
    const d = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    const a = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()
    info = { platform: d.platform, system: d.system, model: d.model, sdk: a.SDKVersion || '', wechat: a.version || '' }
  } catch (e) {
    info = {}
  }
  return info
}

function report(event, detail) {
  const key = event + ':' + JSON.stringify(detail || {}).slice(0, 80)
  if (sent[key]) return
  sent[key] = 1
  if (!db.isCloud) return
  db.act('log', { event, detail, sys: sys() }).catch(() => null)
}

module.exports = { report }
