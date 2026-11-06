# 我们俩 · 情侣小程序

两个人一起用的微信小程序。数据放在你自己的微信云开发里，只有你们俩能打开（体验版）。

**第一次部署请看教程** `docs/tutorial/tutorial.html`（用浏览器打开；想要 PDF 就在浏览器里「打印 → 另存为 PDF」），从注册小程序到两个人用上，一步一步都有。这份 README 是给想动手改代码的人，以及帮你改代码的 AI 看的。

| 底栏 | 功能 |
| --- | --- |
| 我们 | 首页封面照片；在一起第几天和精确到秒的计时；下一个里程碑（第 520 天、第 1000 天……）；两人的积分；今天两人的心情；经期预测；纪念日倒数（支持农历生日、每年重复或只算一次） |
| 日历 | 月历上标出两人每天的心情、纪念日和经期；点某一天写心情、记几件小事、传照片（最多 9 张）；记录经期开始和结束，并预测接下来三次；给某天或连续几天加标记（出远门、纪念日、生日、约会、电影演出、礼物、回家、重要的事），格子里显示图标，爱心标记可以转成每年倒数的纪念日 |
| 足迹 | 中国地图，记一次旅行就点亮对应省份（去得越多颜色越深）；朋友圈式九宫格，每条最多 30 张照片，编辑时长按拖动排序；两人可以各自给旅行写心情点评；海外旅行单独计数 |
| 计划 | 「计划」：一起的计划，可以拆成小步骤，全部勾完自动完成，旅行计划完成后可以一键记成足迹。「任务」：给对方发带积分的小任务，做完由另一个人确认后积分到账 |
| 点菜 | 预设 43 道家常菜，每道菜分别标记两个人谁学会了；两个人各自往「今日菜单」里加菜；「帮我们决定」随机抽一道；历史菜单自动保存 |

另有「积分」页（首页积分卡片进入）：两人各自上架奖励，对方用积分兑换。

微信通知（可选，见下面「微信通知」）：对方点了菜、给你派任务、做完等你确认、兑换你的奖励时通知你；每天早上提醒明天的纪念日、在一起第 N 天和后天开始的经期。

积分规则：写当天心情 +5（每人每天一次），记一次足迹 +10，第一次点亮一个省份再 +20，完成任务按任务设定的分值。规则在 `cloudfunctions/api/index.js` 的 `RULES`，界面上的说明在 `miniprogram/data/points.js`，改的话两边一起改。

经期预测只按日历推算（最近最多 6 个周期的平均），**不能用来避孕**。

---

## 自定义

| 想改什么 | 改哪里 |
| --- | --- |
| 云开发环境 | `miniprogram/config.js` 的 `envId`（留空是本机预览模式） |
| 两个人的称呼 | 进小程序「设置 → 称呼」里改，最直接。还没设置时显示的默认称呼在 `cloudfunctions/api/settings.js` 的 `names` |
| 微信通知的模板 | `cloudfunctions/api/settings.js` 的 `notify`，见下面「微信通知」 |
| 加载页、下拉刷新的图 | 把一张 gif 或 png（不超过 200K）放进 `miniprogram/assets/loading/`，在 `config.js` 的 `loadingImage` 填路径；留空用自带的心跳动画 |
| 小程序标题 | `miniprogram/app.json` 的 `navigationBarTitleText`；各页标题在各页的 `index.json` |
| 主题色 | `miniprogram/app.wxss` 顶部的 `--accent` 等变量；图标是预先着色的 SVG，改主题色要用 `tools/build-icons.js` 重新生成 `assets/icons/accent` |
| 换成自己的形象图（心情头像） | 见下面「换成自己的形象图」 |
| 预设菜谱 | `miniprogram/data/dishes.js`（第一次打开点菜页时写入数据库，之后改这里不影响已有的菜） |
| 日历标记的种类 | `miniprogram/data/marks.js` 和云函数里的 `MARK_KEYS`，两边一起改 |
| 积分规则 | `cloudfunctions/api/index.js` 的 `RULES` + `miniprogram/data/points.js`，改完要重新部署云函数 |

**两个设置文件**（都只放数据）：

- `miniprogram/config.js`：小程序端的设置，包括云环境 ID、加载图和本地存储前缀 `storagePrefix`。前缀上线后不要改，改了手机上缓存的照片要重新下载
- `cloudfunctions/api/settings.js`：两个人的身份键 `roles`、默认称呼、通知模板。`roles` 是数据里区分两个人用的键，**有了数据之后不要改**。代码里不写死任何身份，都从这里读

改了 `cloudfunctions/api/` 里的任何文件之后一定要：① 运行 `node tools/sync-server.js`，把它同步给小程序端和本机预览模式（需要装 Node.js）；② 在开发者工具里重新「上传并部署」云函数。

### 微信通知

用的是一次性订阅消息：每点一次「允许」，那一类通知就能多收一条；弹窗里勾了「总是保持以上选择」之后，平时切换底栏时会自动续上，不再弹窗。

1. 小程序后台「功能 → 订阅消息」里选用三个模板。`settings.js` 里写好了「备忘录」类目下这三个模板的字段：家庭做饭菜品记录提醒（点菜）、待办事项提醒（任务、兑换）、日程提醒（每天的提醒）。你的类目不同、模板不同的话，照着模板详情里的字段名改 `fields`
2. 把三个模板 ID 填进 `cloudfunctions/api/settings.js` 的 `notify.<类别>.id`，ID 空着的那类不发
3. 重新部署云函数。每天早上的提醒还要上传定时触发器：在开发者工具里右键 `cloudfunctions/api` →「上传触发器」（时间在 `cloudfunctions/api/config.json`，默认每天 9 点）
4. 两个人各自在小程序「设置 → 微信通知」里点「开启通知」，可以点「发一条试试」

### 换成自己的形象图

默认两个人的心情头像都是图标。想换成自己画的小人：

1. 准备每个人 5 张表情图：`great`（超开心）、`happy`（开心）、`calm`（平静）、`sad`（难过）、`angry`（生气），PNG、透明背景，放在项目文件夹**外面**的 `couple-miniapp-art/<身份>/<身份>-great.png` 这样的位置（身份就是 `settings.js` 里 `roles` 的键，默认第一个人 `a`、第二个人 `b`）
2. 每个人的文件夹里放一个 `crop.json`，写头像在原图里的裁剪框：`{ "baseWidth": 原图宽, "left": 左边距, "top": 上边距, "size": 正方形边长 }`
3. 安装依赖并运行：`node tools/art/build-avatars.js`（依赖安装方法见 `tools/deps.js`），会生成 `miniprogram/assets/<身份>/*.png` 和清单 `miniprogram/data/avatars.js`
4. 缺的表情会先用已有的顶上，并在角上加一个心情小徽章

### 私人配置放在仓库外（可选）

想把代码放在 Git 仓库里、又不想把自己的 AppID、环境 ID、通知模板、形象图提交进去，可以把这些放进仓库外的一个 profile 文件夹，用脚本合成一个用来部署的文件夹：

```bash
node tools/apply-profile.js <profile 目录> <输出目录>
```

profile 里是 `profile.json`（要改的 `project.config.json` 字段，比如 `appid`，和小程序标题 `title`）和 `files/`（原样覆盖的文件，只放数据和素材：`miniprogram/config.js`、`cloudfunctions/api/settings.js`、`miniprogram/data/avatars.js`、形象图、加载图）。之后在仓库里改代码、跑测试，再重新合成，用开发者工具打开输出目录部署、上传。详细说明在脚本开头。

### 用 AI 帮你改

项目里带了一个给 AI 用的说明：`.claude/skills/couple-miniapp/SKILL.md`（Claude Code 打开这个项目会自动读到；其他 AI 工具请让它先读 `AGENTS.md`）。里面写了项目结构、数据怎么流动、常见改法、测试和部署步骤，以及踩过的坑。

---

## 为什么只用体验版、不发布上线

- 体验版只有你们俩（和管理员）能打开，正好是私人空间
- 个人主体发布上线要过审核，带用户上传照片、文字的内容类小程序有被拒的可能；正式上线还需要先完成小程序备案
- 云开发**免费体验版**的环境在小程序发布上线后第 15 天就到期；不发布可以每 6 个月手动续期一次
- 地图用的是公开的省界数据，没有审图号；自用可以，公开发布要换成有审图号的地图

## 数据安全

- 小程序端**不直接读写数据库**，所有操作都经过云函数 `api`。云函数只认已经绑定的两个微信，其他人打开会被拦在选身份页，也选不了已被占用的身份
- 数据库集合权限保持默认的「仅创建者可读写」，**不要改成所有人可读写**。集合会在第一次打开时自动创建，以后版本新增集合也会自动补建（`SCHEMA` 版本号）
- 照片存在云存储（默认仅创建者可读）。对方的照片由云函数换成临时链接显示；想让对方手机也能缓存你的照片，要在后台把存储域名加到 downloadFile 合法域名（教程里有）
- 想换手机或重新绑定：「设置 → 解除我的身份」，数据不会丢

---

## 目录

```
miniprogram/
  app.js / app.json / app.wxss   全局入口（启动时先用本机存的身份秒开首页）、页面注册、设计变量
  config.js                      云开发环境 ID、加载图、本地存储前缀
  custom-tab-bar/                自定义底栏
  behaviors/refresh.js           自定义下拉刷新（页面内容在 scroll-view 里）
  components/                    icon / empty / sheet / segmented / photo / photo-grid / mood-face /
                                 mood-picker / loading（加载页）/ refresher（下拉刷新露出的动画）
  pages/
    home  anniversary-edit  settings     我们 / 纪念日 / 设置（第一次打开在这里选身份）
    calendar  diary-edit                 日历（含标记）/ 写心情
    points                               积分和奖励
    map   trip-edit  trip-detail         足迹（trip-edit/sort.wxs 是拖动排序）
    plans plan-edit task-edit            计划和任务
    menu  dish-edit  orders              点菜
  services/db.js                 数据层：云端模式调云函数；本机模式直接运行同一份云函数逻辑
  services/notify.js             微信通知：开启、续条数
  services/files.js              云文件换临时链接、预览大图
  services/img-cache.js          照片本机缓存（最多 100MB，最久没看的先删）
  services/server.js             云函数的副本（tools/sync-server.js 生成，勿手改）
  services/settings.js           cloudfunctions/api/settings.js 的副本（tools/sync-server.js 生成，勿手改）
  services/local-sdk.js          本机模式的“假云开发”，数据存在本地存储
  utils/roles.js                 两个人的身份：另一个人是谁、两人各一份、默认称呼
  utils/store-key.js             本地存储键名（加 config.js 的前缀）
  utils/                         另有日期和农历、经期推算、Canvas 地图、界面小工具
  data/                          地图数据、预设菜谱、日历标记种类、积分和心情定义、形象图清单
cloudfunctions/api/              唯一的云函数（所有读写都经过它）；settings.js 是部署设置
docs/tutorial/                   部署教程（HTML，浏览器打开）
tools/                           开发脚本，不会打包进小程序
.claude/skills/couple-miniapp/   给 AI 看的项目说明（skill）
```

## 开发脚本

```bash
node tools/sync-server.js        # 改了云函数（含 settings.js）后必须跑
node tools/smoke-test.js         # 模拟运行时，把各页面主要流程走一遍（本机模式）
node tools/test-cloud.js         # 用内存数据库测试云函数：绑定、权限、积分防重、照片冲突、通知等
node tools/test-sort.js          # 拖动排序的手势逻辑
node tools/check-wxml.js miniprogram   # 检查 WXML 标签配对
node tools/apply-profile.js <profile 目录> <输出目录>   # 合成带私人配置的部署文件夹（可选）
```

测试按 `settings.js` 里的身份键和 `config.js` 里的存储前缀来跑，换成任何身份键都应该通过。这几个测试用的是模拟出来的 `wx` 和数据库，只能证明逻辑通，**不能代替真机测试**。

在开发者工具模拟器里自动走一遍（只能在本机预览模式下跑，脚本检测到 `envId` 不为空会拒绝）：先安装 `tools/e2e` 的依赖（见 `tools/deps.js`），用 `cli auto --project <项目目录> --auto-port 9421` 打开项目，再 `AUTO_PORT=9421 node tools/e2e/run.js`。

## 已知限制

- 不是实时推送：对方刚改的内容，切回页面或下拉刷新后才能看到
- 两个人同时保存同一条足迹，后保存的会被拦下并提示刷新；文字字段以后保存的为准
- 删除任务、足迹、心情不会收回已经发的积分
- 地图只点亮到省级
- 日历标记（出远门、约会等）没有微信提醒；只有纪念日、在一起第 N 天和经期会提前提醒
- 没有暗色模式

## 素材和许可

- 省界数据：阿里云 DataV.GeoAtlas（`areas_v3/bound/100000_full.json`），经 Albers 投影和简化
- 图标：[Lucide](https://lucide.dev)，ISC 许可，见 `miniprogram/assets/icons/LICENSE-lucide.txt`
- 农历换算：[solarlunar](https://github.com/yize/solarlunar) 3.1.0，ISC 许可，见 `miniprogram/utils/vendor/LICENSE-solarlunar.txt`
- 加载图换成别人的形象（动漫、表情包等）时注意版权：自己用可以，再分享出去前要确认能用
