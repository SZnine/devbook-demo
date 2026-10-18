# Markdown 呈现

当前入口是 `src/Markdown.tsx`：优先使用本地 Vditor/Lute 生成结构并清理 HTML，异步加载时采用 React Markdown + GFM + sanitize 回退。动态渲染替换保留阅读滚动与展开状态。

- 普通代码围栏由 Expressive Code 渲染，保留语言、行号和当前明暗主题；编辑器代码高亮为独立的可编辑路径。
- 数学公式交给 KaTeX；Mermaid 图按当前安全配置渲染。未知或失败内容保留可读文本，不执行任意脚本。
- 图片与链接使用用户提供的 URL，没有媒体上传后台；外部资源可触发对应网络请求。新窗口链接带 `noopener noreferrer`。
- HTML 需要经过清理，不能因富内容功能绕过 sanitize。标题锚点按实例隔离，引用里的代码保持 Markdown 格式。
- 原型中的 Code Hike 组件没有进入当前业务，已移除；不要把已删除的实验能力写入功能说明。

参考：[Vditor](https://github.com/Vanessa219/vditor)、[Expressive Code](https://expressive-code.com/)、[Mermaid 安全配置](https://mermaid.js.org/config/schema-docs/config.html)、[DOMPurify](https://github.com/cure53/DOMPurify)。第三方许可证保存在 `public/licenses` 与 `public/vendor`。
