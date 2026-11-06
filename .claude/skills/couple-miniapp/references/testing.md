# 测试

四个脚本都只用 Node，不需要装依赖，几秒到一分钟跑完。改完代码全部跑一遍，全部通过再交付。

```bash
node tools/smoke-test.js
node tools/test-cloud.js
node tools/test-sort.js
node tools/check-wxml.js miniprogram
```

## 对任何身份键都要能过

测试不写死身份和存储前缀：

- smoke-test 从 `miniprogram/services/settings.js` 读 `roles`，记成 `R0`、`R1`（默认称呼 `N0`）；从 `miniprogram/config.js` 读 `storagePrefix`，记成 `P`
- test-cloud 从 `cloudfunctions/api/settings.js` 读 `R0`、`R1`
- `tools/e2e/run.js` 从 `MP_ROOT`（默认仓库的 `miniprogram/`）读 `config.js` 和 `services/settings.js`

加用例时也用 `R0` / `R1` / `P`，不要写 `'a'`、`'b'`、`'cm:'`。想确认换了键也能过：用 profile 合成后在输出目录里跑（`node <输出目录>/tools/smoke-test.js` 等，脚本按所在目录的设置跑）；或者临时改 `cloudfunctions/api/settings.js` 的 `roles`、跑 `node tools/sync-server.js` 再跑测试，跑完改回来并再同步一次。

两个脚本开头都固定了 `process.env.TZ = 'Asia/Shanghai'`：小程序端的“今天”按本机时区，云函数的 `todayCN()` 按北京时间，电脑不在北京时区时两边会差一天。

## tools/smoke-test.js：页面主流程

在 Node 里模拟小程序运行时，按真实操作顺序把各页面走一遍：选身份和称呼 → 首页 → 纪念日 → 足迹（含保存失败重试、旅行点评）→ 计划 → 点菜 → 首页封面和统计 → 写心情 → 心情头像 → 经期 → 日历标记 → 任务 → 积分 → 首页秒开、加载页、下拉刷新 → 微信通知 → 解除身份。强制本机模式（不管 `config.js` 填没填 `envId`），跑的是真实的云函数逻辑（`services/server.js`），不碰云端。

测试框架的要点（文件开头）：

- 假的 `wx`：`storage` 对象就是本地存储，`nav` 记录跳转，`toasts` 记录提示；需要新的 wx 接口时在 `global.wx` 里补一个
- 假的 `App` / `Page` / `Component` / `Behavior`：`load('pages/xxx/index')` 返回一个页面对象，`setData` 同步更新 `page.data`，回调在下一个 tick 执行；页面的 `behaviors` 会合并进来。`global.App` 和真机一样，注册时就调 `onLaunch`、`onShow`，这期间 `getApp()` 返回 `undefined`；底栏组件的配置在 `compCfg`
- `ev(dataset, detail)` 构造事件对象；`tick(ms)` 等待；`peek(集合)` 看本机模式数据库里的数据（读的是 `storage[P + 'local:' + 集合]`）
- 想模拟慢网络：替换 `require(services/server.js).main`，在里面先 `await tick(延迟)`（参考“首页秒开”那组用例）
- 微信通知那组：临时把 `db.isCloud` 设成 true，替换 `db.subscribe`，补上假的 `wx.getSetting`、`wx.requestSubscribeMessage`，测完还原
- 心情头像那组按 `data/avatars.js` 有没有内容走不同的断言：仓库里是空的（用图标），profile 里放了形象图也能过

加用例：找到相近的那一组，在后面照着写，最后 `console.log('ok  <这组测了什么>')`。

## tools/test-cloud.js：云函数逻辑

用内存数据库模拟 `wx-server-sdk`（`where`、`_.inc`、`_.set`、`_.remove`、`_.addToSet` 等按官方语义实现），`call('A', action, data)` 以微信 A 的身份调用云函数，可以用 A、B、C 模拟多个人（A 绑 `R0`；B 先绑 `R1`，中途解绑后换 C 绑 `R1`）。覆盖绑定和权限、积分防重、任务确认、兑换、并发点菜、经期和日历标记的校验、足迹照片冲突和重试、缩略图清理、老环境补建集合、微信通知等。

通知相关的工具（文件开头和 `testNotify()`）：

- 云函数导出了 `NOTIFY`（就是 `settings.js` 的 `notify`），测试往里填假的模板 ID 和字段再测发送
- 发出去的消息记在 `sent`；`sendFail = (参数) => 错误码` 模拟发送失败（43101、41030 等）
- 定时触发器：`main({ Type: 'Timer' })`，并把 `getWXContext` 的 `SOURCE` 设成 `wx_trigger`、OPENID 为空（见 `timer()`）；带着 OPENID 调用要被当成普通请求拒绝

改了云函数的规则、加了 action，都在这里加用例。注意有的用例会改变后续用例的状态（例如解绑），加在合适的位置。

## tools/test-sort.js：拖动排序

足迹编辑页的照片拖动排序写在 `pages/trip-edit/sort.wxs`，在视图层运行，开发者工具的自动化也触发不到。这里用假的组件对象把长按、拖动、边缘自动滚动、多指、松手提交完整走一遍。改 `sort.wxs` 后必须跑。

## tools/check-wxml.js：标签配对

`node tools/check-wxml.js miniprogram`，检查每个 WXML 的标签是否配对、`{{ }}` 是否成对。开发者工具对这类错误的报错不直观，先用它查。

## 在开发者工具模拟器里自动走一遍（可选）

`tools/e2e/run.js` 用 `miniprogram-automator` 连接开发者工具，从选身份开始把五个底栏和积分页走一遍并截图（不包括日历标记和微信通知）。**它会清空数据、替你选身份、写测试数据**，所以只能在本机预览模式下跑（脚本检测到 `envId` 不为空会拒绝）。

1. 安装依赖：按 `tools/deps.js` 的说明，把 `tools/e2e/package.json` 复制到 `<TOOLING_DIR>/e2e/` 里运行 `npm install`（默认 `TOOLING_DIR` 是和项目文件夹并排的 `_tooling/couple-miniapp`；依赖里有几百 K 的测试图片，放进项目目录会触发 200K 警告）
2. 开发者工具「设置 → 安全设置」打开服务端口
3. `cli auto --project <项目目录> --auto-port 9421`
4. `AUTO_PORT=9421 node tools/e2e/run.js`（不设 `AUTO_PORT` 就连 9420），截图默认存在项目外的 `../_e2e-shots/couple-miniapp`（`SHOTS` 可改）

另外两个脚本固定连 9420：

- `tools/e2e/cloud-check.js`：云端模式下的只读连通性检查（只调 bootstrap 和一次 list）
- `tools/e2e/tour.js`：只读巡检，切到首页、足迹、计划、点菜四个底栏截图，不改数据

自动化的限制见 gotchas.md 的「开发者工具和自动化」。

## 模拟测试不能代替真机

这些测试证明的是逻辑。真机上才会暴露的问题：手势手感（拖动、下拉刷新）、照片选择和上传（需要隐私配置）、临时链接过期、下载域名、订阅消息的弹窗和真正的推送、定时触发器、低端安卓的性能。交付时提醒用户在手机上试一下改到的地方。
