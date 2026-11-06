# 架构

## 目录

- [整体数据流](#整体数据流)
- [设置文件和生成的副本](#设置文件和生成的副本)
- [云函数 api](#云函数-api)
- [数据集合](#数据集合)
- [小程序端的数据层和缓存](#小程序端的数据层和缓存)
- [照片：上传、显示、缓存](#照片上传显示缓存)
- [微信通知](#微信通知)
- [日历标记](#日历标记)
- [页面和组件](#页面和组件)
- [两个人、身份和称呼](#两个人身份和称呼)

## 整体数据流

```
页面 (pages/*) ──→ services/db.js ──┬─ 云端模式：wx.cloud.callFunction('api', { action, ... })
                                    └─ 本机模式：services/server.js（云函数副本）+ services/local-sdk.js（假数据库，存在本地存储）
                                              ↓
                              cloudfunctions/api/index.js 的 handlers[action]

定时触发器（每天 9 点）──→ cloudfunctions/api/index.js 的 daily()：发每天的提醒
```

`config.js` 的 `envId` 为空就是本机模式。两种模式对页面完全一样，所以 smoke-test 和本机预览跑的就是真实的云函数逻辑。

## 设置文件和生成的副本

| 文件 | 内容 | 谁读 |
| --- | --- | --- |
| `cloudfunctions/api/settings.js` | 只放数据：`roles`（两个身份键）、`names`（默认称呼）、`notify`（通知模板）、`notifyState`（点通知打开哪个版本） | 云函数；它的副本给小程序端 |
| `miniprogram/services/settings.js` | 上一份的副本，`tools/sync-server.js` 生成，**勿手改** | `utils/roles.js`、`services/server.js` |
| `miniprogram/services/server.js` | `cloudfunctions/api/index.js` 的副本，`wx-server-sdk` 换成 `./local-sdk`，**勿手改** | 本机模式、smoke-test |
| `cloudfunctions/api/date.js`、`period.js`、`solarlunar.js`、`LICENSE-solarlunar.txt` | 反方向：从 `miniprogram/utils/` 复制进云函数，**勿手改**，改 `miniprogram/utils/` 里那份 | 云函数的每天提醒 |
| `miniprogram/config.js` | 只放数据：`envId`、`loadingImage`、`storagePrefix` | 小程序端 |
| `cloudfunctions/api/config.json` | 云调用权限（`subscribeMessage.*`）和定时触发器 `daily-remind`（`0 0 9 * * * *`） | 部署云函数 / 上传触发器时 |

云函数目录里的文件都平铺在根目录，不建子目录：在 Windows 上用命令行部署，子目录里的文件云端找不到（`tools/sync-server.js` 开头的注释）。

## 云函数 api

入口 `exports.main`：

1. 没有 OPENID、而且是定时触发器（`SOURCE === 'wx_trigger'` 或 `event.Type === 'Timer'`）：跑 `daily()`，结束。小程序端的调用总有 OPENID，冒充不了定时器
2. 找 `handlers[event.action]`，没有就报 `bad-action`
3. `ensureCouple()`：第一次调用时自动建好所有集合和 `couple/main` 文档；`SCHEMA` 版本号变大时会补建新集合
4. 根据调用者的 openid 在 `couple.members` 里找身份（`settings.js` 里 `roles` 的其中一个）；除了 `bootstrap`、`bind`（`OPEN_ACTIONS`），没绑定身份的人一律拒绝（`not-member`）
5. 返回 `{ ok: true, data }` 或 `{ ok: false, code, msg }`；`db.js` 的 `unwrap` 把失败变成带 `code` 的 Error

主要 action：

| action | 用途 |
| --- | --- |
| `bootstrap` | 返回 `{ me, couple }`：我的身份、称呼、在一起日期和时刻、封面、两人积分、`seeded`、已被占的身份（`roles`）、通知信息（`notify: { ids, subs }`） |
| `bind` / `unbind` | 选身份 / 解除身份（一个身份只能绑一个微信，最多两个人） |
| `saveCouple` | 改称呼（每个最多 12 个字）、在一起的日期和时刻、封面 |
| `list` / `get` / `add` / `update` / `remove` | 通用增删改查（有字段白名单、锁定字段、只有创建者能改的集合等规则） |
| `tripReview` | 给足迹写自己的心情点评（原子写入 `reviews.<身份>`） |
| `fileUrls` | 把云存储 fileID 换成临时链接（存储权限是仅创建者可读，对方的照片只能这样看） |
| `removeFiles` | 删云存储文件（分批，每批 50 个） |
| `seed` | 第一次打开点菜页时写入预设菜谱 |
| `orderItem` | 往今日菜单加减一道菜（原子操作，两个人同时点不会互相覆盖）；加菜时通知对方 |
| `taskSubmit` / `taskConfirm` | 任务做完 / 对方确认后发积分（或打回）；都会通知对方 |
| `redeem` / `fulfill` | 用积分兑换奖励（通知上架的人）/ 上架的人兑现 |
| `log` | 写诊断日志（`logs` 集合，排查真机上图片加载失败等问题） |
| `subscribe` | 小程序端订阅成功后报上来：这几类通知各加一条 |
| `notifyTest` | 给自己发一条试试（用掉自己一条，默认 `remind` 类） |
| `notifyPreview` | 看某天早上会发哪些提醒，只看不发（`today` 不填就是今天） |
| `notifyAdmin` | 配置模板用：`op` 是 `category` / `titles` / `keywords` / `add` / `mine`，分别查类目、类目下的公共模板、模板字段、把模板加进「我的模板」、列出我的模板。小程序里没有入口，只在云端模式下手动调用；`add` 会改账号里的模板，先问用户 |

重要的规则常量（文件开头）：`COLLECTIONS`、`SERVER_ONLY`（积分流水、兑换记录、日志只能由专门的 action 写）、`OWNER_ONLY`（心情、奖励只有创建者能改删）、`ROLES = SETTINGS.roles`（加载时检查是两个不同的键，否则直接抛错）、`LOCKED`（`_id`、`_openid`、`createdAt`、`createdBy` 不允许被改）、`SCHEMA`（现在是 5）、`RULES`（积分规则）、`MOOD_KEYS`、`MARK_KEYS` 和 `MARK_DAYS`（日历标记）、`NOTIFY` / `NOTIFY_STATE` / `ORDER_QUIET`（通知）。

### 积分为什么不会重复加

`award()` 往 `points` 集合写一条流水，流水的 `_id` 是业务键（如 `mood:<身份>:2026-10-30`、`trip:<足迹id>`、`province:330000`、`task:<任务id>`）。同一件事第二次记账会主键冲突直接失败，余额（`couple.points.<身份>`，用 `_.inc` 增减）也就不会多加。删除记录不收回积分。写心情只有 `date` 等于云端的北京时间今天（`todayCN()`）才加分。

### 足迹照片的并发保护

两个人可能同时编辑同一条足迹。编辑页保存时带上打开时的照片列表 `basePhotos`（以及重试过的 `triedPhotos`），云函数发现当前照片和这些都对不上，就拒绝（`conflict`），避免互相把对方新加的照片删掉。新建足迹带 `clientKey`，`_id` 固定为 `t_<身份>_<clientKey>`，网络重试不会建出两条。老版本客户端没有 `basePhotos` 又改了照片集合时返回 `upgrade`，提示先更新小程序。

## 数据集合

| 集合 | 内容 | 备注 |
| --- | --- | --- |
| `couple` | 只有一个文档 `main`：`members`（`{ openid, role, at }`）、`names`、`togetherSince`、`togetherTime`、`cover`、`points`、`seeded`、`schema`；通知用的 `subs`（每人每类还能收几条）、`quiet`（点菜通知上次发出的时间）、`remindedOn`（每天提醒跑过的日期） | `names`、`points`、`subs`、`quiet` 都以身份键为键 |
| `anniversaries` | 纪念日：标题、类型（`love` / `birthday` / `festival` / `other`）、日期、是否每年重复、公历或农历 | |
| `diary` | 每人每天的心情：`date`、`mood`（great/happy/calm/sad/angry）、`text`、`events`、`photos` | 只有创建者能改 |
| `periods` | 经期记录：`start`、`end`（空 = 还没结束） | |
| `trips` | 足迹：地点（省市、海外）、日期、同行的人、`photos`、`thumbs`（`[{p: 原图, t: 缩略图}]`）、`note`、`reviews` | |
| `plans` | 计划和子步骤 | |
| `tasks` | 带积分的小任务：`assignee`（身份键）、`points`、`status`（open / submitted / done） | 状态只能走 `taskSubmit` / `taskConfirm` |
| `dishes` | 菜：名称、分类、`learned: { <身份>: true/false }`、备注、照片 | |
| `orders` | 每天的菜单，`_id` 是 `d<日期>`，`items.<菜id>` 里有 `count`、`name`、`by`（点过的身份） | |
| `rewards` / `redemptions` | 积分奖励和兑换记录 | 兑换记录只能由云函数写 |
| `points` | 积分流水 | 只能由云函数写 |
| `logs` | 诊断日志，也记通知发送失败（`event: 'notify-failed'`） | 只能由云函数写 |
| `marks` | 日历标记：`type`、`title`、`start`、`end` | 两个人都能加改删，见下面「日历标记」 |

## 小程序端的数据层和缓存

本地存储的键名都经过 `utils/store-key.js`，加上 `config.js` 的 `storagePrefix`（默认 `'cm:'`）。下面写的 `<前缀>` 就是它。

`services/db.js`：

- `db.peek(collection, opts)`：读本机缓存（`<前缀>cache:<集合>`，按日期范围取的是 `<前缀>cache:<集合>@<起>_<止>`），同步返回，用于“先显示上次的数据”
- `db.list(collection, opts)`：拉云端并写缓存；如果拉的过程中本机刚改过这个集合，就不用这份可能过时的结果覆盖缓存
- `db.get` / `add` / `update` / `remove`：写操作会就地更新整表缓存，按日期范围的缓存直接作废
- `db.uploadPhotos(...)`：上传原图并生成 400px 短边的缩略图，三张并发
- `db.subscribe(kinds)` / `db.notifyTest(kind)`：通知用；其他专门的 action 用 `db.act(action, payload)`

本机模式下，`services/local-sdk.js` 把每个集合存成一个本地存储键 `<前缀>local:<集合>`（一个数组），照片存在 `USER_DATA_PATH/photos`，调用者的 openid 固定是 `local-user`，发通知直接当作成功。

`app.js`：启动时先把上次的 `{ me, couple }` 从 `<前缀>boot-v1` 读出来，首页不用等云端就能显示；云端结果回来后覆盖并再存一次。首页在完全没有本机数据、要等云端时才显示加载页（`components/loading`，200ms 内加载完不出现，出现后至少停 600ms）。`app.onShow` 里刷新一次微信的订阅设置（`notify.refresh()`）。

可以下拉刷新的页面（首页、日历、足迹、计划、点菜、积分）没有用小程序自带的下拉刷新（那个只能显示三个点），而是把 `.page` 放在 `scroll-view` 里，用 `behaviors/refresh.js` + `components/refresher` 自定义。页面里仍然写 `onPullDownRefresh()`，结束时调 `this.stopRefresh()`。

## 照片：上传、显示、缓存

- 云存储默认“仅创建者可读”。自己的照片可以直接 `wx.cloud.downloadFile`；对方的照片会报错（-403003），只能通过云函数 `fileUrls` 换临时链接
- 临时链接实际只能用 10–30 分钟（返回的 maxAge 写的是 3600 秒，不可信）。`services/files.js` 只缓存 8 分钟（存在 `<前缀>file-urls-v2`），图片加载失败时作废链接、换新的重试一次
- `components/photo`（`ui-photo`）是显示云图片的唯一入口：先查本机缓存，没有再换链接；**不要在组件里直接把 `cloud://` 写进 `<image src>`**
- `services/img-cache.js`：把看过的照片存到本机（`USER_DATA_PATH/imgc`，最多 100MB，最久没看的先删；索引在 `<前缀>img-cache-v1`）。对方的照片要用临时链接 + `wx.downloadFile` 下载，这需要后台把存储域名加到 downloadFile 合法域名，没加就退回每次用临时链接显示
- 足迹列表用缩略图（`thumbs`），大图预览用原图；`components/photo-grid` 是朋友圈式九宫格，进入屏幕附近才加载

## 微信通知

用的是一次性订阅消息：用户每点一次「允许」，那一类只能多收一条。云函数在 `couple.subs.<身份>.<类>` 里记每人每类还剩几条。

- **三类**（`settings.js` 的 `notify`，每类 `{ id, fields }`，`id` 空着的那类不发）：
  - `order`：对方往今日菜单加了菜。同一个人 30 分钟内连着点只通知一次（`ORDER_QUIET`，时间记在 `couple.quiet.<收的人>`）；减菜、自己点不通知
  - `task`：任务派给你（新建或改派，派给自己不发）、对方说做完了等你确认、确认或打回、对方兑换了你上架的奖励
  - `remind`：每天 9 点的定时触发器（`config.json`）跑 `daily()`：明天的纪念日（含在一起纪念日）、明天是在一起第 N 天的里程碑、经期预计后天开始，两个人都发。同一天只跑一次（`couple.remindedOn`）；几条同时发，因为云函数超时只有 3 秒
- **发送** `notify()`：没模板、对方没绑定、条数是 0 都不发；发成功扣一条；`43101`（对方拒收）把那类清零；`41030`（跳转的页面不在线上版本里）去掉跳转再发一次；别的失败记进 `logs`（`notify-failed`）。通知失败不影响本来的操作
- **模板字段** `fields`：模板字段名 → 内容（`title`、`who`、`note`、`status`、`time`、`date`）。`fieldValue()` 按字段名去掉数字后的类型整理内容：`thing` 截到 20 字、`phrase` 只留 5 个汉字、`time` / `date` 换成「2026年11月5日 09:00」这样的格式，表情符号都去掉。不合规则微信会拒发
- `notifyState`：点通知打开哪个版本，`trial` 体验版（默认）、`formal` 正式版、`developer` 开发版
- **小程序端** `services/notify.js`：
  - `refresh()` 读 `wx.getSetting({ withSubscriptions: true })`，知道总开关和哪些模板勾了「总是保持以上选择」
  - `ask()` 是设置页「开启通知」按钮：一次最多请求 3 个模板，会弹窗
  - `topUp()` 在底栏切换时调用（`custom-tab-bar` 的 `go`）：只请求勾了总是允许、剩余少于 10 条（`LOW`）的那几类，不会弹窗
  - `test()` 是「发一条试试」；`state()` 给设置页的通知卡片用。本机模式不显示通知卡片
  - `wx.requestSubscribeMessage` 只能在点击事件里同步调用，前面不能有 `await`

## 日历标记

给某天或连续几天加个图标（出远门、约会、生日……），存在 `marks` 集合。

- 种类在 `miniprogram/data/marks.js` 的 `MARKS`（`key`、`label`、`icon`、`color`、`hint`），必须和云函数的 `MARK_KEYS` 是同一组 key。`color` 只用 `accent` 或 `wine`；`icon` 要在 `assets/icons/` 里有（`components/icon`）
- 云函数校验：类型只认 `MARK_KEYS`；`title` 去空格、最多 20 字；`end` 空着就等于 `start`，不能早于开始；最多跨 90 天（`MARK_DAYS`）。日历页保存前也会拦一次
- 日历格子里纪念日在前、标记在后，同一种图标只放一个，最多 2 个（`CELL_ICONS`），再多的露一个小点（`more`），点开那天在下面的面板里看全部
- 新建「纪念日」类型（`love`）的标记时，弹层里可以转成正式的纪念日：跳到 `pages/anniversary-edit/index?date=<开始日>&title=<名字>`，纪念日编辑页把它们填好，不另存标记
- 纪念日在日历上按自己的类型显示图标（`ANN_ICON`）；点纪念日去编辑（在一起纪念日没有编号，不跳）

## 页面和组件

| 页面 | 作用 |
| --- | --- |
| `home` | 封面、在一起天数和秒级计时、里程碑、积分、今天两人的心情、经期卡片、统计、纪念日列表 |
| `settings` | 第一次打开选身份；设置在一起的日期、称呼；微信通知卡片（开启、条数、发一条试试、对方开没开）；解除身份 |
| `anniversary-edit` | 新建/编辑纪念日（支持农历；可以带 `?date=&title=` 预填） |
| `calendar` / `diary-edit` | 日历（心情、纪念日、经期、标记）、写心情、经期记录 |
| `map` / `trip-edit` / `trip-detail` | 足迹地图和朋友圈式列表 / 编辑（`sort.wxs` 拖动排序，WXS 在视图层运行） / 详情和点评 |
| `plans` / `plan-edit` / `task-edit` | 计划和任务 |
| `menu` / `dish-edit` / `orders` | 点菜、编辑菜、历史菜单 |
| `points` | 积分、奖励、兑换、明细 |

组件：`icon`（预着色的 Lucide SVG）、`empty`、`sheet`（底部弹层）、`segmented`、`photo`、`photo-grid`、`mood-face`（心情头像：有形象图用形象图，没有用图标）、`mood-picker`、`loading`、`refresher`；自定义底栏在 `custom-tab-bar/`（切换时顺手 `notify.topUp()`）。

## 两个人、身份和称呼

- 身份键来自 `cloudfunctions/api/settings.js` 的 `roles`，默认 `['a', 'b']`。数据里到处存着这两个键（`couple.members`、`names`、`points`、`subs`，心情和任务的 `createdBy`、任务的 `assignee`、菜的 `learned`、足迹的 `reviews`、菜单的 `by`、积分流水和足迹的 `_id`），所以**有了数据之后不能改**
- 云函数里：`ROLES`、`other(role)`（另一个人）、`byRole(fn)`（两人各一份）、`defaultName(role)`
- 小程序端 `utils/roles.js`：`ROLES`、`other`、`byRole`、`defaultNames`、`meOr(me)`（还没选身份时按第一个人）、`pair(me)`（`[我, 对方]`）
- **以后写代码不要出现身份键的字面量**（`'a'`、`me === 'a' ? 'b' : 'a'`、`names.a`）。WXML 里循环身份：点菜页每道菜的 `item.learn`、编辑菜页 `wx:for="{{roles}}"` 配 `form.learned[item]`、设置页的 `whoList`、首页的 `names[roles[0]]`
- 显示的称呼存在 `couple.names`，在「设置」里改；`settings.js` 的 `names` 是默认值：新环境初始化、`saveCouple` 的兜底、小程序端还没拿到云端数据时都用它，没写的身份就显示键本身
- 形象图（心情头像）的清单在 `data/avatars.js`，键是身份键，由 `tools/art/build-avatars.js` 生成；清单为空时两个人都用心情图标
