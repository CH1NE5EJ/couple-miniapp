// 本地存储的键名：统一加 config.js 里的前缀（上线以后不要改前缀，改了手机上的缓存会全部失效）
const config = require('../config')

module.exports = (name) => (config.storagePrefix || 'cm:') + name
