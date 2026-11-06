// 小程序端的设置（只放数据）。两个人的身份、默认称呼、通知模板在 cloudfunctions/api/settings.js
module.exports = {
  // 云开发环境 ID（开发者工具 → 云开发 → 设置里复制）
  // 留空 = 本机模式：数据只存在当前设备，适合先在开发者工具里预览
  envId: '',

  // 加载页和下拉刷新用的图（可选）：把一张 gif 或 png 放进 miniprogram/assets/loading/，
  // 这里填它的路径，比如 '/assets/loading/loading.gif'；留空就用自带的心跳动画
  // 注意：图片和音频每个文件不要超过 200K；别人的形象有版权，自己用可以，分享出去前要确认能用
  loadingImage: '',

  // 手机本地存储的键名前缀。上线以后不要改：改了手机上缓存的照片和数据要重新下载
  storagePrefix: 'cm:'
}
