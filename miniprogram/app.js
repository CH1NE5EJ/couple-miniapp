const db = require('./services/db')
const notify = require('./services/notify')
const roles = require('./utils/roles')
const storeKey = require('./utils/store-key')

// 上次拿到的身份和情侣信息：启动时先用它，首页不用等云端就能显示
const BOOT_KEY = storeKey('boot-v1')

App({
  globalData: {
    me: null, // settings.js 里 roles 的其中一个
    couple: null,
    tabIndex: 0,
    tabFrom: 0,
    bootError: null
  },

  onLaunch() {
    try {
      db.init()
    } catch (e) {
      this.globalData.bootError = e
    }
    try {
      const last = wx.getStorageSync(BOOT_KEY)
      if (last && last.couple) {
        this.globalData.me = last.me || null
        this.globalData.couple = last.couple
      }
    } catch (e) {
      // 读不到就等云端
    }
    this.boot()
  },

  // 微信设置里的通知开关可能刚改过（切换功能时顺手续条数要用到）
  onShow() {
    notify.refresh()
  },

  // 拉取身份和情侣信息；页面统一 await app.ready()
  boot() {
    this.booting = (this.globalData.bootError ? Promise.reject(this.globalData.bootError) : db.bootstrap())
      .then((res) => {
        this.globalData.me = res.me
        this.globalData.couple = res.couple
        this.globalData.bootError = null
        this.saveBoot()
        return res
      })
      .catch((e) => {
        this.globalData.bootError = e
        throw e
      })
    return this.booting
  },

  ready() {
    return this.booting
      .catch(() => this.boot())
      .then(() => ({ me: this.globalData.me, couple: this.globalData.couple }))
  },

  names() {
    const c = this.globalData.couple
    return (c && c.names) || roles.defaultNames
  },

  setCouple(couple) {
    this.globalData.couple = Object.assign({}, this.globalData.couple, couple)
    this.saveBoot()
  },

  saveBoot() {
    try {
      wx.setStorageSync(BOOT_KEY, { me: this.globalData.me, couple: this.globalData.couple })
    } catch (e) {
      // 存储满了下次启动就等云端
    }
  },

  // 没选身份的人先去设置页（替换掉当前页面，不能返回）
  requireMember() {
    return this.ready().then((res) => {
      if (!res.me) {
        if (!this.setupOpen) {
          this.setupOpen = true
          wx.reLaunch({ url: '/pages/settings/index?setup=1' })
        }
        return null
      }
      return res
    })
  }
})
