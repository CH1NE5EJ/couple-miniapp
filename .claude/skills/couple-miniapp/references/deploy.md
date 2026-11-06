# 部署和上线

用户第一次部署请让他们照部署教程做（`docs/tutorial/tutorial.html`，浏览器打开，想要 PDF 就「打印 → 另存为 PDF」）。这里是给 AI 的要点，用于回答问题、帮用户排查、或者在用户同意后用命令行代劳。

## 第一次部署的步骤（概要）

1. 微信公众平台注册小程序（主体选「个人」），拿到 AppID
2. 安装微信开发者工具，导入项目，填 AppID（会写进 `project.config.json`）
3. 开发者工具顶栏「云开发」开通环境（可以先用免费体验版），复制环境 ID 填进 `miniprogram/config.js` 的 `envId`
4. （可选）想换身份键、默认称呼，在这一步改 `cloudfunctions/api/settings.js` 并运行 `node tools/sync-server.js`。身份键部署、有了数据之后就不能改了
5. 左侧文件树右键 `cloudfunctions/api` →「上传并部署：云端安装依赖」
6. 后台「设置 → 服务内容声明 → 用户隐私保护指引」：勾选「选中的照片或视频信息」，否则真机上选不了照片
7. 「管理 → 成员管理 → 体验成员」添加另一半的微信号
8. 开发者工具「上传」→ 后台「管理 → 版本管理」把这个版本设为体验版 → 两个人用体验版二维码打开
9. 两个人各自在第一次打开时选身份
10. （可选）照片缓存：后台「开发管理 → 开发设置 → 服务器域名」的 downloadFile 合法域名，加上云存储的下载域名（形如 `https://xxxx.tcb.qcloud.la`，在云开发控制台 → 存储里点开任意一张照片，下载地址的开头就是）
11. （可选）微信通知，见下面「微信通知」

数据库集合、`couple` 文档都会在第一次打开时由云函数自动建好，不用去控制台手动建。

## 每次改完代码之后

| 改了什么 | 要做什么 |
| --- | --- |
| 只改了 `miniprogram/` | 上传新版本 → 后台设为体验版 → 两个人重新进入小程序 |
| 改了 `cloudfunctions/api/`（包括 `settings.js`） | `node tools/sync-server.js` → 重新部署云函数 → 通常也要上传新版本（`settings.js` 的 `roles`、`names` 小程序端也用） |
| 只改了 `settings.js` 的 `notify` | `node tools/sync-server.js` → 重新部署云函数；模板 ID 由云函数下发，不用上传新版本 |
| 改了 `cloudfunctions/api/config.json` 的 `triggers` | 右键 `cloudfunctions/api` →「上传触发器」 |
| 云函数的改动会让旧版本小程序出问题 | 先部署云函数，紧接着上传新版本并设为体验版，间隔越短越好；最好挑另一半没在用的时候 |
| 用 profile 部署的 | 先在仓库里改、跑测试，再 `node tools/apply-profile.js <profile 目录> <输出目录>`，用开发者工具打开输出目录部署、上传 |

- 版本号每次都要比上一次大（例如 1.0.3 → 1.0.4）
- 体验版更新后，手机上可能还是旧版本：退出小程序重新进；还不行就在微信「最近使用」里删掉这个小程序再打开

## 微信通知

可选功能，用的是一次性订阅消息（每点一次「允许」，那一类多收一条）。步骤：

1. 后台「功能 → 订阅消息」里选用模板。仓库的 `settings.js` 按「备忘录」类目下三个模板写好了字段；类目或模板不同，照着模板详情里的字段名改 `fields`
2. 把模板 ID 填进 `cloudfunctions/api/settings.js` 的 `notify.<order|task|remind>.id`（ID 是私人配置，用 profile 的话填在 profile 那份里）
3. `node tools/sync-server.js`，重新部署云函数。`cloudfunctions/api/config.json` 里声明了发订阅消息要用的云调用权限（`subscribeMessage.*`）
4. 每天早上的提醒靠定时触发器（`config.json` 的 `daily-remind`，`0 0 9 * * * *`，每天 9 点）：在开发者工具里右键 `cloudfunctions/api` →「上传触发器」。**命令行做不了这一步**：`cli cloud functions` 只有 `list`、`info`、`deploy`、`inc-deploy`、`download`，没有触发器命令，要请用户自己点
5. 两个人各自在小程序「设置 → 微信通知」里点「开启通知」，弹窗里勾「总是保持以上选择」以后切换底栏会自动续条数；可以点「发一条试试」（用掉自己一条 `remind`）

查模板字段：云函数有个 `notifyAdmin` action（只有已绑定身份的微信能调），`op: 'category'` 看小程序的服务类目，`op: 'titles'`（`ids` 填类目 id）看类目下的公共模板，`op: 'keywords'`（`tid`）看模板字段，`op: 'mine'` 列出已选用的模板。`op: 'add'`（`tid`、`kidList`、`sceneDesc`）会往账号里加模板，先问用户。调用方式和 `tools/e2e/cloud-check.js` 一样：用自动化在小程序里 `wx.cloud.callFunction({ name: 'api', data: { action: 'notifyAdmin', op: … } })`。

想知道某天早上会提醒什么：调 `notifyPreview`（`today` 可选），只看不发。

## 私人配置放在仓库外（apply-profile）

可选。仓库里只放通用代码和默认值，用户自己的 AppID、环境 ID、通知模板 ID、称呼、形象图放在仓库外的 profile 文件夹，用脚本合成一个用来部署的文件夹。详细说明在 `tools/apply-profile.js` 开头。

```bash
node tools/apply-profile.js <profile 目录> <输出目录> [--init]
```

profile 的结构：

- `profile.json`：`{ "project": { project.config.json 里要改的字段，比如 "appid": "<AppID>" }, "title": "小程序标题" }`
- `files/`：原样盖到输出目录的文件，路径和仓库一样。约定只放数据和素材：`miniprogram/config.js`、`cloudfunctions/api/settings.js`、`miniprogram/data/avatars.js`、`miniprogram/assets/<身份>/*.png`、`miniprogram/assets/loading/*.gif`（脚本本身不拦别的文件，不要往里放代码）

脚本做的事：

1. 输出目录变成和仓库一模一样：仓库的文件全部复制过去，仓库里没有的删掉。不复制仓库的 `.git`、`node_modules`、`project.private.config.json`；输出目录里自己的 `.git`、`project.private.config.json`、`node_modules`、`.profile-build.json` 保留不动
2. 盖上 profile 的 `files/`
3. 改输出目录 `project.config.json` 的字段（`profile.project` 逐层合并：只写 `setting` 里的某一项，不会冲掉其他项）和 `miniprogram/app.json` 的 `window.navigationBarTitleText`（`profile.title`）
4. 在输出目录里运行 `tools/sync-server.js`，小程序端拿到这份 profile 的 `settings.js`
5. 核对输出目录的 `roles` 和 profile 里 `settings.js` 的一致（确认覆盖生效），写 `.profile-build.json`（合成时间、仓库、profile、身份、盖了哪些文件）

安全检查（路径都先解析成真实路径，目录链接按它指向的位置算）：输出目录不能是盘符根目录，不能在仓库里面，也不能是仓库的上级目录；profile 不能在仓库里面；输出目录和 profile 不能互相包含；输出目录里遇到链接（目录链接、快捷方式）就停下，不会写进或删掉链接指向的文件夹；输出目录已经有文件、又没有 `.profile-build.json` 时拒绝，确认里面的东西可以被删（先备份）再加 `--init`。

脚本只能保证输出目录内部一致。部署云函数和上传小程序要从同一次合成的结果里做，两边的身份才对得上。

注意：

- 输出目录每次都会被整个重建，**不要在输出目录里改代码**，改了下次合成就没了。改代码回仓库，改私人配置去 profile 的 `files/`
- 开发者工具打开、部署、上传的都是输出目录
- 想用 profile 的身份键跑测试：合成后在输出目录里跑 `node <输出目录>/tools/smoke-test.js`、`node <输出目录>/tools/test-cloud.js`（测试按所在目录的 `settings.js` 和 `config.js` 跑）

## 命令行（用户同意后才能代劳）

开发者工具要先在「设置 → 安全设置」里打开服务端口。命令行程序默认位置：Windows `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，macOS `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`（用户装到别处就用实际路径）。

```bash
# 打开项目并开启自动化端口
cli auto --project <项目目录> --auto-port 9420
# 部署云函数（云端安装依赖）
cli cloud functions deploy --env <环境ID> --names api --remote-npm-install --project <项目目录>
# 确认线上云函数就是本地这份：下载下来和本地 index.js 对比
cli cloud functions download --env <环境ID> --name api --path <临时目录> --project <项目目录>
# 上传版本
cli upload --project <项目目录> -v <版本号> -d "<版本说明>" --info-output <结果文件.json>
# 关闭项目 / 退出开发者工具
cli close --project <项目目录>
cli quit
```

没有上传触发器的命令，见上面「微信通知」第 4 步。用 profile 的，`<项目目录>` 是输出目录。

部署前建议先把云端数据备份一份（只读：用自动化在小程序里调 `list` 把各集合存成 JSON）；部署后用 `tools/e2e/cloud-check.js` 做只读检查。

## 费用（2026-10 的官方价格，以控制台购买页为准）

- 小程序个人主体注册免费
- 云开发免费体验版：0 元/月、每月 3000 资源点，每个账号一个；到期前 1 个月内可以手动续 6 个月，不会自动续；不能按量付费，资源点用完当月服务受限
- 个人版：19.9 元/月（官方标注限时优惠），每月 40000 资源点
- 照片多的话免费额度可能不够：用一周后在云开发控制台看用量再决定

来源：腾讯云《云开发 CloudBase 计费》文档（cloud.tencent.com/document/product/876/127357）。

## 为什么只用体验版、不发布

- 体验版只有管理员和体验成员能打开，正好是两个人的私人空间
- 正式发布要先完成小程序备案，还要过审核；个人主体做带用户上传照片、文字的内容类小程序容易被拒
- 免费体验版的云环境在小程序发布上线后第 15 天到期（不发布可以一直续）
- 地图是公开的省界数据，没有审图号，不能公开发布
- 目前（2024 年官方社区答复）没备案“暂不影响”体验版；规则可能变化，以微信公众平台的最新公告为准
