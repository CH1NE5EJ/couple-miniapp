// 由 tools/sync-server.js 从 cloudfunctions/api/settings.js 复制，请勿手改（要改去改那份，再运行这个脚本）
// 每个部署自己的设置（只放数据）：两个人的身份、默认称呼、微信通知模板
// 改完运行 node tools/sync-server.js（小程序端和本机预览模式读的是它复制过去的那份），再重新部署云函数

module.exports = {
  // 数据里区分两个人用的键（两个人各选一个，谁先选都行；还没选身份时按第一个显示）。只用字母、数字、_、-，不能叫 all、none
  // 部署、有了数据之后就不要再改，改了旧数据会对不上
  roles: ['a', 'b'],

  // 默认称呼，进入小程序后可以在设置里改
  names: { a: 'A', b: 'B' },

  // 微信通知（订阅消息）：模板在小程序后台「功能 → 订阅消息」里选用，把模板 ID 填到 id，ID 空着的那类不发
  // fields：模板字段 → 通知内容。内容有 title 事情、who 谁、note 说明、status 状态、time 发出时间、date 日期
  // 字段名（thing1、time2……）看后台的模板详情；下面是「备忘录」类目里这三个模板的字段，选别的模板要照着改
  notify: {
    // 对方点了菜：家庭做饭菜品记录提醒（提交人、菜品、提交时间）
    order: {
      id: '',
      fields: { thing1: 'who', thing3: 'title', time2: 'time' }
    },
    // 任务派给你、等你确认、确认或打回，对方兑换了你的奖励：待办事项提醒（事项主题、提醒状态、备注消息、提醒时间）
    task: {
      id: '',
      fields: { thing1: 'title', phrase8: 'status', thing12: 'note', time23: 'time' }
    },
    // 明天是纪念日、在一起第 N 天，经期预计后天开始：日程提醒（日程标题、日程时间、备注）
    remind: {
      id: '',
      fields: { thing5: 'title', date4: 'date', thing11: 'note' }
    }
  },

  // 点通知打开哪个版本：trial 体验版、formal 正式版、developer 开发版
  notifyState: 'trial'
}
