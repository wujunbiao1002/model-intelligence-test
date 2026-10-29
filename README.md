# 模型智能测试站（Model Intelligence Test）

用“鹈鹕骑自行车”这类 SVG/HTML 生成任务，直观对比各模型分组的生成能力。项目由一个纯静态前端和一个定时检测脚本组成，不需要常驻后台服务，需要搭配 sub2api（OpenAI 兼容的 API 网关）使用。

**在线演示**：<https://tokenhub.junly.top/model-intelligence-test/>（“系统检测”无需登录即可查看）

## 功能

1. **系统检测**：定时脚本用系统 Key 调用各分组模型，页面展示每个分组最近 6 次的作品、耗时和成败，不登录也能看。
2. **我的测试**：从 sub2api 单点登录进入后，选择自己的 Key 和模型、设置思考强度、填写提示词，在浏览器里流式生成并实时预览。
3. **我的作品**：测试作品保存在浏览器 IndexedDB 中，只有本人可见，不上传服务器。

## 工作原理

```
┌──────────── 浏览器 ────────────┐        ┌──────── 服务器（同一域名） ────────┐
│ 系统检测  ──读取 data/status.json ──────▶ nginx 静态目录                    │
│ 我的测试  ──/api/v1/*（登录、Key）──────▶ sub2api                           │
│          ──/v1/chat/completions ───────▶ sub2api                           │
└────────────────────────────────┘        │       ▲                            │
                                          │ cron ─┴─ monitor.mjs（系统 Key）    │
                                          │          写 status.json 和作品      │
                                          └────────────────────────────────────┘
```

前端会直接请求同域的 `/api/v1/user/profile`、`/api/v1/keys`、`/v1/models`、`/v1/chat/completions`，所以**必须和 sub2api 部署在同一个域名下**，路径为 `/model-intelligence-test/`。

## 技术栈

- **前端**：Next.js 16（静态导出）、React 19、Tailwind CSS 4
- **定时脚本**：Node.js 18.3+ ESM，只用内置模块，无第三方依赖
- **单点登录**：复用 sub2api 的 `?user_id=&token=` 跳转参数，读取后立即从地址栏清除
- **部署**：nginx 托管静态文件，cron + Docker（`node:22-alpine`）运行检测脚本

## 快速开始

需要 Node.js 20+。

```bash
git clone https://github.com/wujunbiao1002/model-intelligence-test.git
cd model-intelligence-test
npm install

# 1. 准备检测配置（填入你的 sub2api 地址和系统 Key）
cp monitor/config.example.json monitor/config.json

# 2. 跑一轮检测，结果写到 public/data/（会真实调用模型，需要几分钟）
npm run monitor:local

# 3. 构建并本地预览，登录和 API 请求转发到你的 sub2api
npm run build
UPSTREAM=https://your-sub2api.example.com npm run preview
# 打开 http://127.0.0.1:3210/model-intelligence-test/
```

Windows PowerShell 下设置环境变量用 `$env:UPSTREAM="https://your-sub2api.example.com"; npm run preview`。

只看前端界面可以用 `npm run dev`（3000 端口），但它不转发 `/api/v1` 和 `/v1`，登录和测试功能无法使用。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | Next.js 开发服务器（不含 API 转发） |
| `npm run build` | 构建静态文件到 `out/` |
| `npm run preview` | 本地预览 `out/`，按环境变量 `UPSTREAM` 转发登录和 API |
| `npm run monitor:local` | 读取 `monitor/config.json` 跑一轮检测，结果写到 `public/data/` |
| `npm test` | 定时脚本单元测试 |
| `npm run typecheck` / `npm run lint` | 类型检查 / ESLint |
| `npm run release` | 测试 + 检查 + 构建 + 打包，在 `release/` 输出 web 和 monitor 两个 zip |
| `npm run package` | 只打包（已经构建过时使用） |

## 目录结构

```
model-intelligence-test/
├── monitor/                     # 定时检测脚本
│   ├── monitor.mjs              # 主脚本，每次运行检测一轮后退出
│   ├── config.example.json      # 配置模板（真实 config.json 已被 .gitignore 忽略）
│   ├── lib/
│   │   ├── chat.mjs             # OpenAI 兼容 SSE 流式调用
│   │   └── artifact.mjs         # 从回复里提取 SVG/HTML
│   └── tests/                   # 单元测试（node --test）
├── src/                         # Next.js 前端
│   ├── app/page.tsx             # 主页（系统检测 / 我的测试）
│   ├── components/
│   │   ├── StatusPanel.tsx      # 系统检测面板
│   │   ├── TestConsole.tsx      # 我的测试 + 我的作品
│   │   ├── WorkModal.tsx        # 作品详情弹窗
│   │   ├── ArtifactFrame.tsx    # 沙箱 iframe 预览
│   │   └── AuthInitializer.tsx  # 单点登录初始化
│   ├── lib/                     # 登录、sub2api 接口、流式调用、作品提取、IndexedDB
│   └── types/
├── scripts/
│   ├── clean-export.mjs         # 构建后清理 out/data
│   ├── local-proxy.mjs          # 本地预览代理
│   └── package-release.mjs      # 生成发布 zip
├── nginx-config.conf            # nginx 配置示例
├── DEPLOY.md                    # 部署和配置说明
└── LICENSE
```

## 部署

```bash
npm install
npm run release
```

把 `release/` 下的 web 包解压到 nginx 静态目录，monitor 包解压到服务器上的脚本目录，再配置 nginx 和 cron。完整步骤、`config.json` 字段说明和常见问题见 [DEPLOY.md](./DEPLOY.md)。

## 安全说明

- 系统 API Key 只存在服务器的 `monitor/config.json` 里。该文件已被 `.gitignore` 忽略，也不会打进发布包；`status.json` 不含 Key，错误信息中的 Key 会被打码。
- “我的测试”使用用户自己的 Key，由 sub2api 登录态按需拉取。登录参数读取后立即从地址栏清除，登录 token 保存在 `sessionStorage`，关闭标签页即失效。
- 模型生成的 SVG/HTML 在 `sandbox` iframe 中渲染，CSP 阻断所有网络请求。
- 用户作品只保存在浏览器 IndexedDB，不上传服务器。

发现安全问题请通过 GitHub 私下联系维护者，不要直接提交公开 Issue。

## License

[MIT](./LICENSE)
