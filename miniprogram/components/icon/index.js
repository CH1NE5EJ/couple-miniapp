// Lucide 图标（ISC 许可），颜色由 tools/build-icons.js 预先生成
Component({
  options: { virtualHost: true, styleIsolation: 'apply-shared' },
  properties: {
    name: { type: String, value: 'circle' },
    color: { type: String, value: 'ink' },
    size: { type: Number, value: 40 },
    custom: { type: String, value: '' }
  }
})
