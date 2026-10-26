# 模型智能测试站

鹈鹕测试站点：纯静态前端 + 定时检测脚本，不需要后台服务。

## 功能

1. **系统检测**：展示每个分组最近 6 次定时检测的结果，不登录也能看
2. **我的测试**：从 TokenHub 单点登录进入后，选自己的 Key 和模型、设置思考强度、填提示词，在浏览器里流式生成
3. **我的作品**：用户自己的测试作品存在浏览器 IndexedDB 里，只有自己能看到

## 技术栈

- **前端**：Next.js 16 静态导出 + React 19 + Tailwind CSS 4
- **定时脚本**：Node.js ESM，只用内置模块，写 `status.json` 和 SVG/HTML 到 nginx 静态目录
- **单点登录**：复用 sub2api 的 `?user_id=&token=` 跳转
- **部署**：nginx 托管静态文件，cron 或 systemd timer 跑定时脚本

## 目录结构

```
model-intelligence-test/
├── monitor/                     # 定时检测脚本
│   ├── monitor.mjs              # 主脚本，每次运行检测一轮后退出
│   ├── config.example.json      # 配置模板（真实 config.json 不提交）
│   ├── lib/
│   │   ├── chat.mjs             # OpenAI 兼容 SSE 流式调用
│   │   └── artifact.mjs         # 从回复里提取 SVG/HTML
│   └── tests/                   # 单元测试
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
├── nginx-config.conf            # nginx location 配置片段
└── DEPLOY.md                    # 部署和配置说明
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 构建静态文件到 `out/` |
| `npm run preview` | 本地预览 `http://127.0.0.1:3210/model-intelligence-test/`，转发登录和 API 到 TokenHub |
| `npm run monitor:local` | 跑一轮检测，结果写到 `public/data/` 供本地预览 |
| `npm test` | 定时脚本单元测试 |
| `npm run typecheck` / `npm run lint` | 类型检查 / ESLint |
| `npm run release` | 测试 + 检查 + 构建 + 打包，输出 `release/*.zip` |
| `npm run package` | 只打包（已经构建过） |

## 部署

```bash
npm install
npm run release
```

把 `release/` 下的 zip 上传到服务器解压，然后按 [DEPLOY.md](./DEPLOY.md) 部署前端、定时脚本和 nginx。`config.json` 的字段说明也在 DEPLOY.md 第 6 节。

## 安全说明

- 系统 API Key 只存在服务器的 `monitor/config.json` 里，发布包、git 和前端都不包含
- 用户测试用的是用户自己的 Key，通过 sub2api 单点登录拉取
- 模型生成的 SVG/HTML 用 `sandbox` iframe 隔离，CSP 阻断所有网络请求
- 用户作品存在浏览器 IndexedDB 里，不上传服务器
