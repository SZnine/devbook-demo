# 开发与维护

安装、Docker、隐私与配置见[项目首页](../README.md)。

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build      # dist/ + build/server.mjs
npm run build:demo # 静态演示，关闭 AI 配置和请求
npm start          # 前端与 AI API，默认 127.0.0.1:5174
```

生产服务仅提供 `dist` 和 AI 接口，`/healthz` 提供健康检查。Docker 不使用 Vite 开发／预览服务。

GitHub Pages 由 `main` 分支的工作流部署；先在仓库 Pages 设置中选择 GitHub Actions。工作流自动配置项目路径并上传静态构建。其他静态托管可用 `READ_PUBLIC_BASE` 设置路径前缀，默认 `/`。

| 路径 | 职责 |
| --- | --- |
| `src/notebook` | 当前写作、书籍章节、助手、目录、搜索与阅读记录 |
| `src/content`、`src/Markdown.tsx` | Markdown、代码与媒体展示 |
| `src/memory` | 记忆引擎及 IndexedDB 存储，保留原身份与迁移 |
| `src/manual-demo` | 通用技术示例、来源、展示与旧数据桥接 |
| `server` | AI 配置、转发、评分及生产 HTTP 服务 |
| `tests` | 当前功能、存储、编辑和部署回归 |
| `public/vendor`、`public/licenses` | 本地编辑器资源及许可证 |

移除旧原型不等于迁移或删除用户数据。保留数据库名称、内容 ID、迁移与撤销语义；删除依赖前检查客户端、服务端、测试和动态导入。当前 CSS 存在有效的覆盖关系，不能仅凭重复选择器删除。

浏览器验收使用独立端口和测试目录，不写入用户站点，不使用真实密钥。模拟回答只证明传输、上下文与会话结构。提交前在根目录运行 `node scripts/check-publish.mjs`，禁止测试使用真实密钥、私人素材或个人绝对路径。
