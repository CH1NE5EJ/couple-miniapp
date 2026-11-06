# 常见自定义

每一项都写了“改哪里”和“改完要做什么”。改完都要跑测试（见 testing.md）。

两个设置文件都只放数据：

- `cloudfunctions/api/settings.js`：身份键 `roles`、默认称呼 `names`、通知模板 `notify`、`notifyState`。改完运行 `node tools/sync-server.js`（复制成 `miniprogram/services/settings.js`，那份不要手改），再重新部署云函数；`roles`、`names` 小程序端也用，还要上传新版本
- `miniprogram/config.js`：`envId`、`loadingImage`、`storagePrefix`

用 profile 部署的（见 deploy.md「私人配置放在仓库外」）：这两个文件的私人版本在 profile 的 `files/` 里，改那里再重新合成；仓库里的保持通用的默认值。

## 称呼

- 正在用的称呼在云端 `couple.names`，让用户在小程序「设置 → 称呼」里改最直接
- 默认称呼只有一处：`cloudfunctions/api/settings.js` 的 `names`（默认 `{ a: 'A', b: 'B' }`）。新环境初始化（`ensureCouple()`）、`saveCouple` 的兜底、小程序端还没拿到云端数据时（`utils/roles.js` 的 `defaultNames`）都读它。已经初始化过的环境不受影响，那边要在「设置」里改
- 设置页称呼输入框的标签是「<默认称呼> 显示为」（`pages/settings/index.wxml` 里的 `{{item.label}} 显示为`），所以改默认称呼也会改这个标签

## 身份键

- `cloudfunctions/api/settings.js` 的 `roles`：两个不同的键，默认 `['a', 'b']`。云函数加载时会检查，不是两个不同的键就直接报错
- **部署、有了数据之后不要改**：数据里到处存着身份键（见 architecture.md「两个人、身份和称呼」），改了旧数据就对不上
- 新部署想换键（例如每个部署用不同的键）：在第一次部署前改好，`node tools/sync-server.js`，跑测试（测试按这里的键跑）
- 键会出现在数据库的字段路径（`points.<身份>`、`subs.<身份>.<类>`）和文件夹名（`assets/<身份>/`）里，只用字母和数字
- 顺序有意义：第一个是没选身份时默认显示的那个，设置页按这个顺序列
- 形象图的文件夹名、`data/avatars.js` 的键要和身份键一致

## 小程序标题和页面标题

- 默认标题：`miniprogram/app.json` 的 `window.navigationBarTitleText`（用 profile 时由 `profile.json` 的 `title` 改写）
- 每个页面：各页 `index.json` 的 `navigationBarTitleText`
- 小程序在微信里显示的名字和头像要在微信公众平台改（设置 → 基本设置），不在代码里

## 本地存储前缀

- `miniprogram/config.js` 的 `storagePrefix`，默认 `'cm:'`。所有本地存储的键（缓存、启动数据、照片缓存索引、本机模式的数据）都经过 `utils/store-key.js` 加这个前缀
- **上线以后不要改**：改了手机上缓存的数据和照片索引全部失效，要重新下载；本机模式下的数据也会“消失”（还在旧键里）
- 新代码读写本地存储，键名一律用 `require('../utils/store-key')('名字')`，不要直接写 `'cm:...'`

## 加载页、下拉刷新的动画

- 默认是主题色的心跳动画（`components/loading`、`components/refresher`）
- 换成自己的图：把 gif 或 png 放进 `miniprogram/assets/loading/`（不超过 200K；240×240 左右最合适，加载页按 240rpx 显示，下拉刷新按 76px 显示），在 `config.js` 填 `loadingImage: '/assets/loading/xxx.gif'`。用 profile 的话图和 `config.js` 都放进 profile 的 `files/`
- gif 原样显示，动起来的速度由 gif 自己的帧时长决定
- 别人的形象（动漫、表情包）有版权：自己用可以，分享源码前要换掉

## 主题色

主色是天蓝 `#1F8BC1`。要整套换掉，下面这些地方都要改：

| 位置 | 内容 |
| --- | --- |
| `miniprogram/app.wxss` 顶部 | `--accent`、`--accent-deep`（按下、强调文字）、`--accent-soft`（浅底色） |
| `miniprogram/app.json` | `tabBar.selectedColor` |
| `custom-tab-bar/index.wxss` | 选中文字色、选中块浅底色 |
| `components/segmented/index.wxss`、`components/empty/index.wxss` | 写死的主色 / 浅底色 |
| `pages/anniversary-edit/index.wxml`、`pages/task-edit/index.wxml` | `<switch color="…">` |
| `pages/map/index.wxss` 的 `.sw1–.sw3` + `utils/china-map.js` 的 `lit` | 地图点亮的三档颜色（去过 1 次 / 2 次 / 3 次以上），浅到深 |
| `pages/calendar/index.wxss` | 心情点等少量写死的颜色 |
| `miniprogram/assets/icons/accent/` | 预先着色的图标，要重新生成 |

图标是 SVG 文件、颜色写死在文件里（小程序的 `<image>` 不能用 CSS 改 SVG 颜色）。重新生成：下载 `lucide-static` 包，把 `tools/build-icons.js` 里 `COLORS.accent` 改成新颜色，运行 `node tools/build-icons.js <lucide-static/icons 目录> miniprogram/assets/icons`。

`--wine`（酒红）用在爱心、经期、「帮我们决定」按钮和一部分日历标记上，可以不动。心情的 5 种颜色在 `data/points.js` 的 `MOODS`。

改完用 `grep -rni "1F8BC1\|E6F3FB\|1D7EAF\|A0D4EE\|5CB4E0" miniprogram` 查一遍有没有漏掉的旧颜色（`assets/` 下的图标除外；`components/loading`、`components/refresher` 里的是 `var(--accent, …)` 的兜底值，跟着变量走）。

## 形象图（心情头像）

默认两个人都用心情图标。换成自己的小人：

1. 每人 5 张透明背景 PNG：`great` 超开心、`happy` 开心、`calm` 平静、`sad` 难过、`angry` 生气
2. 放在项目文件夹**外面**（原图通常很大，放进项目会触发 200K 警告）：默认路径 `../couple-miniapp-art/<身份>/<身份>-great.png`（身份是 `settings.js` 里 `roles` 的键，默认就是 `a/a-great.png`、`b/b-great.png`），可以用环境变量 `ART_DIR` 指定。脚本把这个目录下的每个子文件夹都当成一个身份，不会对照 `settings.js`，文件夹名写错头像就对不上
3. 每个人的目录里放 `crop.json`：`{ "baseWidth": 原图宽, "left": x, "top": y, "size": 正方形边长 }`，表示头像在原图里的裁剪框；不同尺寸的原图会按 `baseWidth` 等比换算
4. 安装 sharp（见 `tools/deps.js`），运行 `node tools/art/build-avatars.js`：生成 `miniprogram/assets/<身份>/<心情>.png`（320×320，约 50K）和清单 `miniprogram/data/avatars.js`
5. 只做了部分表情也可以：缺的会先用已有的顶上，并在角上加一个心情小徽章
6. 生成的头像和清单是私人素材：用 profile 的话放进 profile 的 `files/`（同样的路径），仓库里的 `data/avatars.js` 保持 `module.exports = {}`

## 预设菜谱

`miniprogram/data/dishes.js`：分类 `CATEGORIES` 和每类的菜名，`learned` 用 `roles.byRole(() => false)` 生成。只在第一次打开点菜页时写入（云端 `couple.seeded` 变成 true 之后不会再写），所以改预设只影响新环境；已有环境让用户在点菜页手动加。

## 积分规则

- 数值：`cloudfunctions/api/index.js` 的 `RULES = { mood, trip, province }`
- 界面上的说明文字：`miniprogram/data/points.js` 的 `RULE_TEXT`
- 两处一起改，然后 `node tools/sync-server.js`、跑 test-cloud，提醒用户重新部署云函数
- 改规则不影响已经发过的积分

## 心情种类

5 种心情的 key 同时出现在云函数的 `MOOD_KEYS` 和 `data/points.js` 的 `MOODS`（label、图标、颜色）；形象图也按这 5 个 key 命名。增删心情要几处一起改，并考虑旧数据里已有的值。

## 日历标记的种类

- `miniprogram/data/marks.js` 的 `MARKS` 和云函数的 `MARK_KEYS` 是同一组 key，两边一起改，然后 `node tools/sync-server.js`、跑测试、重新部署云函数、上传新版本
- 每种：`key`、`label`、`icon`（`assets/icons/` 里要有，没有就加进 `tools/build-icons.js` 的 `ICONS` 重新生成）、`color`（只用 `accent` 或 `wine`）、`hint`（名字输入框的提示）
- 删掉一种之前想想旧数据：日历不显示不认识的类型，那些标记就看不到、也改不了了
- 只有 `love` 类型的新标记能转成纪念日（`pages/calendar/index.wxml` 里写的是 `mark.type === 'love'`），改 key 时一起改
- 跨天上限 90 天：云函数的 `MARK_DAYS` 和 `miniprogram/data/marks.js` 的 `MARK_DAYS`，两边一起改（日历页从 `data/marks.js` 读）

## 微信通知

模板在微信公众平台「功能 → 订阅消息」里选用，配置写在 `cloudfunctions/api/settings.js` 的 `notify`：

- 三类：`order`（对方点菜）、`task`（任务、兑换）、`remind`（每天早上的提醒）。每类 `{ id, fields }`，`id` 空着的那类不发，也不会出现在设置页
- `fields`：模板字段名（`thing1`、`time2`……，看后台的模板详情）→ 内容（`title` 事情、`who` 谁、`note` 说明、`status` 状态、`time` 发出时间、`date` 日期）。云函数按字段类型自动截断、换格式（见 architecture.md「微信通知」），换了模板要照着新模板的字段改
- 仓库里的 `settings.js` 写好了一套字段，`id` 都是空的。模板 ID 是私人配置，不要提交进仓库
- `notifyState`：点通知打开哪个版本，只用体验版就保持 `'trial'`
- 改完：`node tools/sync-server.js`，重新部署云函数。模板 ID 是云函数通过 `bootstrap` 发给小程序的，只改模板不用重新上传版本
- 改了每天提醒的时间（`cloudfunctions/api/config.json` 的 `triggers`），要重新上传触发器（deploy.md「微信通知」）
- 设置页「开启通知」一次最多请求 3 个模板（`services/notify.js` 的 `ask()`），再加第四类要改这里
- 想加新的通知时机：在云函数里调 `notify(couple, 收的人, 类, { title, who, note, status, page })`，在 `tools/test-cloud.js` 的 `testNotify()` 里加用例

## 加一个新页面

1. 在 `miniprogram/pages/<名字>/` 建 `index.js / index.json / index.wxml / index.wxss`
2. 在 `app.json` 的 `pages` 里注册
3. `index.json` 的 `usingComponents` 里只注册用到的组件（项目开了按需注入 `lazyCodeLoading`）
4. 如果要下拉刷新：照着 `pages/plans` 的写法，`behaviors: [refresh]`、`.page` 外面包 `scroll-view`、`onPullDownRefresh` 里结束时 `this.stopRefresh()`；悬浮按钮、底部弹层放在 `scroll-view` 外面
5. 要读写数据就在云函数里加 action 或复用通用的 `list/get/add/update/remove`
6. 涉及两个人的地方用 `utils/roles.js`，不写身份键

## 改底栏

底栏是自定义的：`custom-tab-bar/index.js` 的 `TABS`（路径、文字、图标）和 `app.json` 的 `tabBar.list` 必须一一对应、顺序一致；每个底栏页面的 `onShow` 里要调用 `ui.showTab(this, 序号)`。图标名要在 `assets/icons/` 里有对应的 SVG（没有就加进 `tools/build-icons.js` 的 `ICONS` 重新生成）。弹层打开时用 `ui.hideTab(this, true)` 收起底栏、关上时 `ui.hideTab(this, false)`，不要调用 `wx.hideTabBar` / `wx.showTabBar`（见 gotchas「真机底部多出一组只有文字的底栏」）。底栏的 `go()` 里顺手调了 `notify.topUp()`，改切换逻辑时留着它。

## 加一个新的数据集合

1. 加进云函数的 `COLLECTIONS`，并把 `SCHEMA` 加一（现在是 5；已经初始化过的环境会在下次调用时自动补建，本机模式也一样）
2. 想清楚权限：只能由云函数写的加进 `SERVER_ONLY`；只有创建者能改的加进 `OWNER_ONLY`
3. 需要特殊校验的字段，在 `sanitize` 里处理
4. `node tools/sync-server.js`，在 `tools/test-cloud.js` 里加用例（开头那条断言列出了所有集合名，也要加上），提醒用户重新部署
