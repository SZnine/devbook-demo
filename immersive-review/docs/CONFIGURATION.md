# 配置清单

## 部署变量

根目录 `.env.example` 是可复制模板。Compose 自动读取同目录 `.env`；`npm start` 同样读取它。修改后重新创建容器或重启 Node 服务。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `READ_BIND_ADDRESS` | `127.0.0.1` | Compose 宿主机绑定地址 |
| `READ_PORT` | `5174` | Compose 宿主机端口／原生 Node 端口 |
| `READ_ALLOWED_ORIGINS` | 对应端口的 localhost / 127.0.0.1 | 逗号分隔的精确来源，如 `https://read.example.com`，不带路径或通配符 |
| `READ_AI_TIMEOUT_MS` | `180000` | 请求超时，1000–600000 毫秒 |
| `READ_MAX_BODY_BYTES` | `1048576` | 请求体上限，1024–16777216 字节；业务字段限制仍有效 |
| `READ_HOST` | `127.0.0.1` | 原生 Node 监听地址；容器固定 `0.0.0.0` |
| `READ_DATA_DIR` | `.local` | 原生 Node 配置目录，相对应用根；容器固定 `/data` |

Compose 容器内端口固定 5174。设置 `READ_PORT=5274` 后访问 `http://127.0.0.1:5274/`；改变地址会进入另一份浏览器数据空间。

反向代理需配置精确来源、保留真实 `Host` 并提供身份验证；服务不信任 `X-Forwarded-*`。来源校验不是账号鉴权。本版为个人单用户服务，不应直接暴露到公网。

## AI 配置

首选“设置 → AI 服务”。API 地址填写基础地址，不附加 `/chat/completions`，不含密钥、查询参数；模型 ID 每行一个或逗号分隔，可用性由服务商决定。

环境变量可初始化服务，前缀为 `GLM`、`DEEPSEEK`、`CUSTOM_AI`：

| 后缀 | 示例 | 含义 |
| --- | --- | --- |
| `_API_KEY` | `GLM_API_KEY` | 密钥，模板留空 |
| `_BASE_URL` | `DEEPSEEK_BASE_URL` | Chat Completions 兼容基础地址 |
| `_MODELS` | `CUSTOM_AI_MODELS` | 逗号分隔的模型 ID |

优先级：**界面保存配置 > 环境初始值 > 程序默认值**。保存后只改环境变量不会覆盖该服务。密钥输入留空表示保留；勾选移除后保存表示清除，重启也不会恢复环境密钥。推荐界面输入，避免密钥出现在 Compose 环境检查输出中。

配置文件为 `assistant-config.json`：原生默认 `immersive-review/.local/`，容器 `/data/`。它为私有明文文件，不回传密钥原文给浏览器；配置目录需可写，不能放在 `dist` 内。

## 界面配置

| 配置 | 位置与范围 |
| --- | --- |
| 明暗主题 | 设置 → 通用，或顶栏按钮；当前浏览器站点 |
| 组件显示、紧凑图标、名称 | 设置 → 通用，或浮动组件条设置；`Ctrl+Alt+M` 展开／隐藏 |
| 默认导出目录 | 设置 → 文件；选择本机文件夹 |
| 数据导出 | 设置 → 文件；Markdown 或 JSON 数据副本 |
| 助手宽度 | 拖动左边缘，分隔条支持键盘；当前站点 |
| 模型与回答风格 | 助手输入框底栏 |
| 上下文程度 | 附件栏选择选区／小节标题与全文／再加章节结构与书名 |
| 保持时长 | 记忆库配置，0.25–4 倍 |
| 遗忘权重 | 记忆库配置，0.5–2 |
| 评分模型和关注方向 | 记忆库配置，主动点击更新才调用 AI |
| 单项评分 | 学习记录 → 系数与调整，0–1；手动优先，可恢复自动 |

阅读停留门槛、同轮合并窗口等仍是源码业务策略，不作为部署配置。目前有效停留约 20–90 秒，30 分钟内重复合并一轮；后续调整需实际使用验证。

## 文件与数据

“设置 → 文件”中可以选择本机文件夹。支持 File System Access API 的桌面浏览器会记住目录；再次导出时可能需要重新授权写入。未选择目录或浏览器不支持时，使用浏览器下载。

目录用于用户主动导出，不是自动同步位置，也不是 Docker 内部的保存路径。Markdown 导出便于在其他编辑器中使用；JSON 数据副本包含笔记、书籍、学习记录、对话及本地偏好，不包含 API 密钥、目录授权或远程媒体文件。此版本尚未提供 JSON 恢复导入。

在线演示采用静态 GitHub Pages 托管，关闭服务端 AI 配置与调用。笔记编辑和数据导出可用，数据只留在当前浏览器。

## 持久化与备份

- 笔记、章节、学习记录在浏览器 IndexedDB；对话与偏好在站点存储。导出数据副本之外，仍应保留浏览器用户目录和固定地址；清除站点数据会丢失内容。容器重启不会清除浏览器数据。
- API 设置位于默认命名卷 `read_read-settings`。`docker compose down` 保留它；普通升级不要使用 `down -v`。
- 配置备份：先 `docker compose stop`，再 `docker compose cp read:/data/assistant-config.json ./assistant-config.private.json`，完成后 `docker compose start`。文件含密钥，不能分享或提交。
- 原生迁移到 Docker 可重新在界面配置，或私下复制原配置到容器 `/data/assistant-config.json` 后重启。该过程不搬迁浏览器笔记。

参考：[Memos 环境配置](https://usememos.com/docs/configuration/environment-variables)、[Compose](https://usememos.com/docs/deploy/docker-compose)、[Docker Node.js](https://docs.docker.com/guides/nodejs/)。
