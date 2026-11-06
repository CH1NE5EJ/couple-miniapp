---
name: couple-miniapp
description: 情侣微信小程序「我们俩」（本仓库：miniprogram/ + cloudfunctions/api）的项目说明书：结构、数据流、怎么安全地自定义、测试、部署和排错。只要用户想改这个项目里的任何东西——称呼、身份键、颜色、头像形象图、加载动画、页面、功能、积分规则、预设菜谱、日历标记、微信通知（订阅消息）、云函数、私人配置（profile）——或者要预览、跑测试、部署云函数、上传体验版、上传触发器、加体验成员，或者遇到“云函数 api 还没有部署”“url not in domain list”“照片不显示”“选不了照片”“上传失败”“收不到通知”这类问题，都先用这个 skill，即使用户没提到它。
---

# 我们俩 · 情侣小程序

两个人自用的微信小程序：纪念日和在一起计时、心情日历（含经期和日历标记）、足迹地图（朋友圈式照片九宫格）、一起的计划和带积分的小任务、点菜，以及可选的微信通知。数据放在用户自己的微信云开发环境里，只用体验版给两个人用，不发布上线。

用户多半不是程序员，是照着部署教程（`docs/tutorial/tutorial.html`，浏览器打开）搭起来的。和他们说话用中文、少用术语；要他们去后台点的东西，写清楚完整路径（例如「微信公众平台 → 管理 → 版本管理」）。

## 先搞清楚现在是哪种模式

看 `miniprogram/config.js` 的 `envId`：

- **空字符串 = 本机预览模式**：不连云端，数据存在开发者工具的本地存储里，`services/db.js` 直接在小程序里运行一份云函数的副本（`services/server.js`）。适合先看效果、改界面、跑自动巡检。
- **填了环境 ID = 云端模式**：所有读写走云函数 `api`，两个人共享同一份数据。这时任何“写数据、清数据、部署、上传”的动作都会影响真实数据，先问用户。

再看项目根目录有没有 `.profile-build.json`：有的话，这个文件夹是 `tools/apply-profile.js` 从仓库合成出来的部署文件夹，下次合成会被整个覆盖。代码要回仓库改，私人配置要改 profile 的 `files/`，改完重新合成（见 `references/deploy.md`「私人配置放在仓库外」）。

## 工作原则（以及为什么）

1. **数据只经过云函数。** 小程序端从不直接读写数据库，`cloudfunctions/api/index.js` 是唯一的后端：它负责只认两个已绑定的微信、校验字段、防止重复加积分、删除记录时连带删照片、发微信通知。新功能要读写数据，就在云函数里加 action 或扩展现有 action，不要在页面里调 `wx.cloud.database()`，否则权限和校验全绕过去了。
2. **改了云函数要做两件事：** 运行 `node tools/sync-server.js`，然后提醒用户在开发者工具里重新「上传并部署：云端安装依赖」。只改不部署，手机上跑的还是旧逻辑。这个脚本做三件事：把 `index.js` 生成 `miniprogram/services/server.js`（本机模式和测试都靠它），把 `settings.js` 复制成 `miniprogram/services/settings.js`，把 `miniprogram/utils` 里的 `date.js`、`period.js`、农历库复制进云函数。生成的副本都不要手改，改源文件再跑脚本。
3. **身份不写死。** 两个人的身份键在 `cloudfunctions/api/settings.js` 的 `roles`（默认 `['a', 'b']`），每个部署可以不一样。小程序端用 `utils/roles.js`（`ROLES`、`other`、`byRole`、`defaultNames`、`meOr`、`pair`），云函数用 `ROLES`、`other`、`byRole`、`defaultName`；WXML 里循环身份列表，不写 `names.a` 这种。详见 `references/architecture.md`「两个人、身份和称呼」。
4. **改完先跑测试再交付：** `node tools/smoke-test.js`、`node tools/test-cloud.js`、`node tools/test-sort.js`、`node tools/check-wxml.js miniprogram`。新行为要加对应的测试用例。测试按 `settings.js` 的身份键和 `config.js` 的存储前缀跑，换成别的键也要能过。测试是模拟环境，过了也要提醒用户在真机上试一下。详见 `references/testing.md`。
5. **对外的动作先问：** 部署云函数、上传触发器、上传版本、在云端模式下写/删数据、用 `notifyAdmin` 往账号里加通知模板，都要用户明确同意；每次上传版本号要比上一次大；只用体验版，不要替用户提交审核或发布（理由见 `references/deploy.md` 的最后一节）。
6. **两个人可能同时在用。** 用户的另一半手机上可能还是旧版本；改数据结构时要让旧数据、旧客户端也能正常工作（可以参考足迹照片的 `basePhotos` 冲突检查和 `upgrade` 拒绝码的做法）。
7. **私人数据不进仓库。** 仓库里 `envId` 留空、`project.config.json` 的 `appid` 是 `touristappid`、通知模板 ID 留空、`data/avatars.js` 是空的。用户自己的 AppID、环境 ID、模板 ID、称呼、形象图放在仓库外的 profile 里。写文档、写例子也只用 `a` / `b`、`A` / `B` 或 `<环境ID>` 这样的占位。
8. **资源和版权：** `miniprogram/` 里每张图片、每个音频不超过 200K（开发者工具的代码质量检查会报警）。用户想把加载图、头像换成动漫或表情包形象时，提醒一句：自己用可以，分享出去前要确认版权。

## 按任务找资料

| 用户想做什么 | 先读 | 主要改哪里 |
| --- | --- | --- |
| 了解项目、加新功能、改数据结构 | `references/architecture.md` | 页面 + `cloudfunctions/api/index.js` |
| 改称呼、身份键、标题、主题色、加载图、形象图、预设菜谱、积分规则、日历标记种类、存储前缀、加页面或底栏 | `references/customize.md` | `cloudfunctions/api/settings.js`、`config.js`、`app.wxss`、`data/`、`custom-tab-bar/` |
| 配置微信通知（订阅消息模板） | `references/customize.md`「微信通知」+ `references/deploy.md`「微信通知」 | `cloudfunctions/api/settings.js`、`config.json` |
| 跑测试、加测试、在模拟器里自动走一遍 | `references/testing.md` | `tools/` |
| 第一次部署、部署云函数、上传触发器、上传体验版、加体验成员、配置域名和隐私、私人配置合成 | `references/deploy.md` | 开发者工具 + 微信公众平台 + `tools/apply-profile.js` |
| 报错、照片不显示、上传失败、收不到通知、模拟器异常、页面布局乱了 | `references/gotchas.md` | 看具体条目 |

## 标准流程

1. 读和任务相关的 reference，再读要改的文件。这个项目有一些“看起来多余、其实有原因”的写法（例如页面内容包在 `scroll-view` 里、首页先读本机缓存再拉云端、请求订阅前不能有 `await`），改之前先弄懂原因，`references/gotchas.md` 里大多有解释。
2. 改代码，保持周围代码的风格：中文注释、两格缩进、无分号、单引号。不写身份键字面量，本地存储的键名都经过 `utils/store-key.js`。
3. 改了 `cloudfunctions/api/` 里的文件（包括 `settings.js`）或 `miniprogram/utils` 里的 `date.js`、`period.js`，就运行 `node tools/sync-server.js`。
4. 跑四个测试脚本，全部通过；有新行为就加用例。
5. 能在开发者工具里看效果的，让用户点「编译」看一眼；界面改动最好在本机模式下截图确认。
6. 交付时告诉用户：改了什么、测试结果、还需要他们做什么（例如“在开发者工具里右键 cloudfunctions/api → 上传并部署：云端安装依赖”“改了 config.json 的触发器要再右键 → 上传触发器”“上传新版本后到后台设为体验版，两个人都重新进一次小程序”；用 profile 的要先重新运行 `apply-profile.js`，在输出目录里部署和上传）。

## 常用命令

```bash
node tools/sync-server.js              # 改了云函数（含 settings.js）或 utils 里的日期、经期工具后必须跑
node tools/smoke-test.js               # 页面主流程（本机模式）
node tools/test-cloud.js               # 云函数逻辑（内存数据库，多个微信身份）
node tools/test-sort.js                # 足迹编辑页拖动排序（WXS）
node tools/check-wxml.js miniprogram   # WXML 标签配对
node tools/apply-profile.js <profile 目录> <输出目录> [--init]   # 合成带私人配置的部署文件夹（可选）
```

开发者工具命令行（需要先在开发者工具「设置 → 安全设置」里打开服务端口）的用法在 `references/deploy.md`。
