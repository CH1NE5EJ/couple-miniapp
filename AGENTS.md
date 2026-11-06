# 给 AI 助手的说明

改这个项目之前，先完整读一遍 `.claude/skills/couple-miniapp/SKILL.md`，以及它提到的 `references/` 里和任务相关的文件。

最重要的几条（详细原因在 skill 里）：

1. 小程序端不直接读写数据库，所有读写都经过云函数 `cloudfunctions/api/index.js`；改了 `cloudfunctions/api/` 里的任何文件（包括 `settings.js`）之后运行 `node tools/sync-server.js`，再提醒用户重新部署云函数。`miniprogram/services/server.js`、`miniprogram/services/settings.js` 是它生成的副本，不要手改
2. 两个人的身份键不写死：键在 `cloudfunctions/api/settings.js` 的 `roles`（默认 `['a', 'b']`，有了数据之后不能改）。小程序端从 `miniprogram/utils/roles.js` 取，云函数用 `ROLES` / `other` / `byRole` / `defaultName`；代码和 WXML 里都不要出现 `'a'`、`'b'` 这样的字面量
3. 改完代码跑 `node tools/smoke-test.js`、`node tools/test-cloud.js`、`node tools/test-sort.js`、`node tools/check-wxml.js miniprogram`，全部通过再交付
4. 上传、部署、改云端数据之前先问用户；只用体验版，不要替用户提交审核或发布。每天的提醒靠定时触发器，命令行传不了，要用户在开发者工具里右键 `cloudfunctions/api` →「上传触发器」
5. 私人的东西（AppID、环境 ID、通知模板 ID、称呼、形象图）不进仓库：放在仓库外的 profile 里，用 `node tools/apply-profile.js` 合成部署文件夹
6. `miniprogram/` 里的图片和音频每个文件不超过 200K；用了下拉刷新的页面，`position: fixed` 的元素必须放在 `scroll-view` 外面
