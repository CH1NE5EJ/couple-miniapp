// 预设菜谱：第一次打开点菜页时写进数据库，之后可以随意改删
const roles = require('../utils/roles')
const CATEGORIES = [
  { key: 'meat', label: '荤菜', icon: 'beef' },
  { key: 'veg', label: '素菜', icon: 'salad' },
  { key: 'soup', label: '汤羹', icon: 'soup' },
  { key: 'staple', label: '主食', icon: 'wheat' },
  { key: 'sweet', label: '小食', icon: 'ice-cream-cone' }
]

const PRESETS = {
  meat: [
    '红烧肉', '可乐鸡翅', '糖醋排骨', '宫保鸡丁', '鱼香肉丝', '青椒肉丝', '回锅肉', '水煮肉片',
    '小炒黄牛肉', '黄焖鸡', '啤酒鸭', '清蒸鲈鱼', '酸菜鱼', '油焖大虾', '番茄牛腩', '土豆炖牛肉',
    '辣子鸡', '蒜蓉粉丝蒸虾'
  ],
  veg: [
    '番茄炒蛋', '麻婆豆腐', '酸辣土豆丝', '地三鲜', '蒜蓉西兰花', '干煸四季豆', '红烧茄子',
    '手撕包菜', '清炒时蔬', '拍黄瓜'
  ],
  soup: ['紫菜蛋花汤', '冬瓜排骨汤', '玉米排骨汤', '西红柿鸡蛋汤', '酸辣汤'],
  staple: ['蛋炒饭', '葱油拌面', '番茄鸡蛋面', '饺子', '煲仔饭', '炸酱面'],
  sweet: ['双皮奶', '拔丝地瓜', '芒果西米露', '烤红薯']
}

function presetDishes() {
  const list = []
  CATEGORIES.forEach((c) => {
    PRESETS[c.key].forEach((name) => {
      list.push({ name, category: c.key, learned: roles.byRole(() => false), note: '', photo: '' })
    })
  })
  return list
}

module.exports = { CATEGORIES, presetDishes }
