# 踩过的坑和排错

按现象找。每条都写了原因，改代码前先看有没有相关的。

## 目录

- [报错和数据](#报错和数据)
- [身份和设置](#身份和设置)
- [微信通知](#微信通知)
- [照片](#照片)
- [界面和性能](#界面和性能)
- [开发者工具和自动化](#开发者工具和自动化)

## 报错和数据

**「云函数 api 还没有部署」/「云开发环境 ID 不对」**：`db.js` 把云函数调用失败翻译成这两句。前者是没部署或部署失败（开发者工具右键 `cloudfunctions/api` 重新「上传并部署：云端安装依赖」）；后者是 `config.js` 的 `envId` 填错，或者开发者工具里选的环境不是这个。

**「请先在设置里选择你的身份」（not-member）**：这个微信还没绑定身份。正常情况下首页会自动跳到选身份页。两个身份都被占了，第三个人就进不来，这是故意的。

**「请先更新小程序，再改足迹的照片」（upgrade）**：手机上是旧版本小程序，云函数已经更新了。到后台把新版本设为体验版，重新进入。

**「对方刚改过这条足迹的照片」（conflict）**：两个人同时改了同一条足迹的照片，后保存的被拦下，返回重新打开再改。文字字段没有这个保护，以后保存的为准。

**部署云函数报 `getCloudAPISignedHeader failed 40013`**：开发者工具里同时开过别的项目（例如本机模式的副本）之后容易出现。关掉其他项目，用 `cli auto --project <本项目>` 重新打开本项目，隔一两分钟再部署。

**改了云函数，本机预览没变化**：忘了 `node tools/sync-server.js`。

**改了 `cloudfunctions/api/date.js` 或 `period.js`，下次同步就没了**：这两个（还有 `solarlunar.js`）是 `tools/sync-server.js` 从 `miniprogram/utils/` 复制过去的。要改就改 `miniprogram/utils/date.js`、`period.js`，再跑同步。

**云函数部署后报找不到模块**：云函数目录里的文件要平铺在 `cloudfunctions/api/` 根目录，不要建子目录：在 Windows 上用命令行部署，子目录里的文件云端找不到。

**删了记录积分没退**：设计如此，积分是流水账，删除不收回。

**本机模式下某个功能突然全报错（`collection xxx not exists`）**：本机模式里，本地存储的 `<前缀>local:<集合>`（例如 `cm:local:marks`）就是那个集合本身。想清空某个集合要把它设成 `[]`，不要删掉这个键：集合只在第一次初始化或 `SCHEMA` 变大时创建，删了之后不会自动补建，列表、新增都会失败。已经删了的话，在开发者工具控制台里把它设回空数组（例如 `wx.setStorageSync('cm:local:marks', [])`），或者清空全部本地存储从头来。自动化脚本、测试里重置数据也一样，用 `[]`，不要删键。

**手机不在北京时间时，深夜写的心情没加分**：云函数按北京时间算“今天”（`todayCN()`），手机按自己的时区算。两边的“今天”不一样时，写的那天不是云端的今天，就不加分。

## 身份和设置

**选身份时报「身份不对」（bad-role）**：小程序端的身份键和云函数的不一致。多半是改了 `cloudfunctions/api/settings.js` 却没跑 `node tools/sync-server.js`（小程序端读的是复制过去的 `miniprogram/services/settings.js`），或者改了之后只部署了云函数、没上传新版本（或者反过来）。用 profile 的，部署云函数和上传小程序都要从同一次合成的输出目录里做。

**所有调用都失败，云函数日志里有「settings.js 里的 roles 要是两个不同的键……」**：`roles` 不合格，云函数一加载就抛错。要求是两个不同的键，只用字母、数字、`_`、`-`（最多 20 个字符），也不能叫 `all` 或 `none`：身份键会出现在数据路径里（`points.<键>`、`subs.<键>.<类>`），带点号会被当成路径分隔；`all`、`none` 和点菜页的筛选键冲突。本机模式下页面上会直接显示这句话。

**改了 `roles` 之后旧数据全乱了**：身份键存在数据里（绑定关系、称呼、积分、心情和任务的作者、菜的 `learned`……），有了数据之后不能改。改回原来的键。

**改了 `storagePrefix` 之后手机上的缓存全没了**：所有本地存储的键都带这个前缀，改了就读不到旧的。上线后不要改。

**`notify.info()` / 某个工具函数里 `getApp()` 是 `undefined`**：`App()` 注册过程中（`onLaunch`、第一次 `onShow`）还拿不到 App 实例。`app.js` 的 `onShow` 会调 `notify.refresh()`，所以 `services/notify.js` 的 `info()` 先判断 `getApp()` 有没有值。在 `App()` 生命周期里会调到的代码都要这样写；smoke-test 的假 `App` 也模拟了这一点（注册期间 `getApp()` 返回 `undefined`）。

## 微信通知

**收不到通知**：按顺序查——

1. 云端模式才有通知，本机模式不显示通知卡片
2. `cloudfunctions/api/settings.js` 里那一类的 `id` 填了吗，填完重新部署了吗（`bootstrap` 返回的 `couple.notify.ids` 里没有那一类，设置页就不显示它）
3. 收的人那一类还剩几条（设置页「还能收到」，云端 `couple.subs.<身份>.<类>`）：一次性订阅，每次「允许」只多一条，发一条扣一条。是 0 就不发
4. 收的人在微信里拒收过（错误码 43101）：那一类会被清零，要在微信设置里重新打开
5. 其他发送失败记在 `logs` 集合，`event` 是 `notify-failed`，`detail` 里有错误码。常见原因是 `fields` 和模板的字段对不上，或内容不合字段规则
6. 点菜通知：同一个人 30 分钟内连着点只通知第一次；减菜、自己点不通知
7. 每天的提醒：见下一条

**每天的提醒没发**：定时触发器要单独上传（右键 `cloudfunctions/api` →「上传触发器」），只部署云函数不会带上，命令行也传不了。同一天只跑一次（`couple.remindedOn`）。只提醒“明天”的纪念日、“明天”是在一起第 N 天、经期“后天”开始。想看某天会发什么，调 `notifyPreview`。

**通知点进去打不开页面 / 41030**：跳转的页面要在线上（正式）版本里存在。只用体验版时，云函数遇到 41030 会去掉 `page` 再发一次，所以通知照样能收到，只是不带跳转页面。`notifyState` 决定点通知打开哪个版本（默认 `trial` 体验版）。

**「开启通知」点了没弹窗**：`wx.requestSubscribeMessage` 只能在点击事件里同步调用，前面有 `await` 或异步回调就会失败。`services/notify.js` 的 `ask()`、`topUp()` 都是在点击里直接调的，改的时候别在前面加异步操作。

## 照片

**真机上点“选照片”没反应或报错**：后台没配置用户隐私保护指引（设置 → 服务内容声明 → 用户隐私保护指引 → 勾选「选中的照片或视频信息」）。

**对方的照片显示不出来 / 过一会儿就裂图**：云存储默认仅创建者可读，对方的照片只能用云函数 `fileUrls` 换临时链接显示；临时链接实际只活 10–30 分钟（不要相信返回的 maxAge）。`services/files.js` 只缓存 8 分钟，`ui-photo` 加载失败时会换新链接重试一次。不要把链接缓存更久。

**模拟器里 `cloud://` 图片 404**：在组件里把 `cloud://...` 直接写进 `<image src>`，开发者工具会把它当相对路径解析成 `/components/xxx/cloud://...`。一律用 `ui-photo` 组件显示云图片。

**对方的照片每次都要重新加载（不缓存）/ 日志里 “url not in domain list”**：缓存对方照片要用 `wx.downloadFile` 下载临时链接，下载域名必须在后台 downloadFile 合法域名里（形如 `https://xxxx.tcb.qcloud.la`）。没配置时会退回每次用临时链接显示，功能正常，只是慢、费流量。自己的照片走 `wx.cloud.downloadFile`，不需要配置。

**上传后存储里留了没用的文件**：编辑页离开时会清理本次上传但没保存的照片；删除足迹会连带删原图和缩略图。

## 界面和性能

**真机底部多出一组只有文字的底栏（我们 / 日历 / 足迹……），和自定义底栏上下叠在一起**：调用了 `wx.showTabBar`。用了自定义底栏时，真机上 `wx.showTabBar` 会把原生底栏（`app.json` 里 `tabBar.list` 那组文字）显示出来，直到小程序重启才消失；开发者工具里看不出来。弹层要收起底栏，只用 `ui.hideTab(this, true/false)`，它只让自定义底栏滑下去、不接收点击，不调用 `wx.hideTabBar` / `wx.showTabBar`。smoke-test 里有断言：整套流程跑完，这两个接口一次都不能被调用。

**用了下拉刷新的页面，悬浮按钮、底部弹层跟着内容跑、位置不对**：自定义下拉刷新时，`scroll-view` 的内容层带着 `will-change: transform`，下拉时还会加 `translateY`，这会让里面所有 `position: fixed` 的元素改为相对内容层定位。悬浮按钮（`.fab`）、`ui-sheet`、`ui-loading` 必须放在 `scroll-view` 外面（作为页面 WXML 的顶层元素）。

**用了下拉刷新的页面，`wx.pageScrollTo` / `onPageScroll` 不起作用**：页面本身不滚动了，滚动的是 `scroll-view`。需要控制滚动就给 `scroll-view` 绑定 `scroll-top` 或用它的事件。

**底部弹层里放大的元素顶部被切平**：`ui-sheet` 的内容区 `.sheet-body` 是 `overflow-y: auto`，里面的元素用 `transform: scale()` 放大后超出内容区的部分会被裁掉，贴着上边的最明显。给最上面一行留一点 `padding-top`（日历标记弹层的 `.mk-types` 就留了 8rpx，选中的类型会放大 1.08 倍）。

**组件里的动画每次切回页面都重播**：小程序组件的属性观察器（observers）只要 `setData` 带上了这个字段就会触发，值没变也一样。页面每次 `onShow` 都整块 setData 时，挂在观察器上的入场动画会重播。要么只在值真的变了才 setData，要么在组件里比较新旧值。

**列表很长时切页卡顿**：大列表不要整个放进 `data`。足迹页把完整列表放在 `this.trips`，只 setData 当前要显示的部分，并用签名跳过没变化的渲染。

**控制台警告 `Do not set same key "xxx" in wx:key`**：`wx:key="*this"` 用在可能重复的值上（例如两个人同一种心情的颜色）。换成唯一字段（例如角色）。

**控制台警告 `IntersectionObserver is using slowest path`**：组件里创建观察器时传 `{ nativeMode: true }`（`this.createIntersectionObserver({ nativeMode: true })`），只调用一次 `relativeToViewport` 时会改用系统原生的观察器。

**开发者工具报「图片和音频资源大小应不超过 200K」**：它扫描的是整个项目目录，包括 `tools/` 里装的 npm 依赖（里面常有大测试图片）。工具依赖装到项目外（`tools/deps.js`），原图素材也放在项目外。

**首页加载慢**：首页靠本机缓存秒开（`<前缀>boot-v1` + `<前缀>cache:*`，前缀默认 `cm:`）。如果改了首页的数据加载，注意不要让首次渲染去等云端；云函数冷启动一次大约 2 秒，热的时候一次请求约 0.5 秒。

## 开发者工具和自动化

**所有组件报「Component is not found in path」、页面没有图标**：热重载太多次后开发者工具的状态乱了。`cli close --project <项目>` 再 `cli auto --project <项目> --auto-port <端口>` 完整重新编译。改了 `app.json` 后不自动重编译也这样处理。

**往项目目录里写文件后，自动化脚本超时**：写文件会触发重新编译、模拟器重启。截图、临时文件放在项目外；改完文件等几秒再连。

**命令行上传失败：`tunneling socket could not be established ... ECONNREFUSED 127.0.0.1:<端口>`**：开发者工具是从某个终端启动的，继承了那个终端的 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，而那个代理已经关了（部署云函数可能照常成功，上传却失败）。`cli quit` 退出开发者工具，在没有这些代理变量的终端里重新 `cli auto` 打开，再上传。

**测试在别人电脑上失败，差一天**：`tools/smoke-test.js`、`tools/test-cloud.js` 开头固定了 `process.env.TZ = 'Asia/Shanghai'`。电脑时区不是北京时间时，小程序端的“今天”（按本机时区）和云函数的 `todayCN()`（按北京时间）会差一天，写心情加分之类的断言就失败。新写的测试脚本也要在最开头加这一行。

**`miniprogram-automator` 的限制**：

- 有的开发者工具版本 `page.callMethod` 报 `No context found`，改用 `mp.evaluate(() => getCurrentPages().pop().方法名(...))`
- `mp.reLaunch` 在开发者工具里可能要好几秒才返回，想测加载过程的时间点，要在 `mp.evaluate` 里用 `wx.reLaunch` 并在小程序内部采样
- 触发不了 WXS 事件（拖动排序靠 `tools/test-sort.js` 测）
- 自定义下拉刷新可以通过 `page.setData({ refreshing: true })` 触发（等同于下拉到位松手）
- 页面在 `scroll-view` 里时，用 `(await page.$('.page-scroll')).scrollTo(0, y)` 滚动
- 自动化的 console 事件只能收到逻辑层的日志，渲染层的警告（wx:key、IntersectionObserver）看不到，要人眼在开发者工具控制台确认
- 实测热重编译之后，`mp.on('console')` / `mp.on('exception')` 收不到 App 启动阶段（`onLaunch`、第一次 `onShow`）的报错。要抓启动报错，先用 `mp.evaluate` 注入 `wx.onUnhandledRejection` / `wx.onError`，把错误写进本地存储，重启后再读出来
