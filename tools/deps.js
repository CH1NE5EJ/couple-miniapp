// 开发工具的 npm 依赖装在项目目录外：默认 ../_tooling/couple-miniapp/<name>/node_modules（和项目文件夹并排），可用环境变量 TOOLING_DIR 改
// （依赖里带着几百 KB 的测试图片，放在项目里会让开发者工具的代码质量检查报“图片和音频资源大小应不超过 200K”）
// 用法：在 require 依赖之前调用 require('../deps')('e2e', module)
// 安装依赖：把 tools/<name>/package.json 复制到 <TOOLING_DIR>/<name>/ 里，在那里运行 npm install
const path = require('path')

const BASE = process.env.TOOLING_DIR || path.join(__dirname, '..', '..', '_tooling', 'couple-miniapp')

module.exports = function useDeps(name, from) {
  from.paths.unshift(path.join(BASE, name, 'node_modules'))
}
