# 模型智能测试站 - 部署说明

## 线上部署结构

```
/data/docker-server/nginx/html/model-intelligence-test/     ← web 包（前端静态文件）
└── data/                                                   ← 检测输出（status.json、runs/），更新前端时必须保留
/data/docker-server/model-intelligence-test/                ← monitor 包 + config.json + log.log
├── monitor.mjs
├── lib/
├── config.example.json
├── config.json                                             ← 真实配置（含系统 Key），只在服务器维护
└── log.log
```

- 前端由 nginx（Docker）对外提供，地址 `https://tokenhub.junly.top/model-intelligence-test/`
- 检测数据对外路径是 `/model-intelligence-test/data/`，就是 web 目录下的 `data/`
- 检测脚本每次运行检测一轮后退出，由 cron 定时调用，用 `node:22-alpine` 容器运行，不依赖宿主机 Node 版本

## 1. 打包（本地）

```bash
npm install
npm run release
```

依次执行单元测试、类型检查、ESLint、构建，全部通过后在 `release/` 生成两个独立的 zip：

| 文件 | 内容 | 解压到 |
|---|---|---|
| `model-intelligence-test-web-<版本>-<时间>.zip` | 前端静态文件（不含 `data/`） | `/data/docker-server/nginx/html/model-intelligence-test/` |
| `model-intelligence-test-monitor-<版本>-<时间>.zip` | `monitor.mjs`、`lib/`、`config.example.json`（不含 `config.json`） | `/data/docker-server/model-intelligence-test/` |

两个 zip 里的文件都直接在根目录，解压到目标目录即可覆盖更新。只改了前端就只传 web 包，只改了脚本就只传 monitor 包。已经构建过、只想重新打包时运行 `npm run package`。

## 2. 更新前端

```bash
scp release/model-intelligence-test-web-*.zip root@server:/tmp/web.zip
ssh root@server
cd /data/docker-server/nginx/html/model-intelligence-test

# 清掉旧的前端文件，保留 data/（检测记录）
find . -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
unzip -o /tmp/web.zip -d .
rm /tmp/web.zip
```

> **不要**直接 `rm -rf` 整个目录或用 `rsync --delete`，会把 `data/` 里的检测记录一起删掉。
> 先清理再解压是为了去掉旧版本 `_next/` 里带哈希的过期文件；只 `unzip -o` 覆盖也能正常访问，只是旧文件会越积越多。

nginx 读的是挂载目录，静态文件更新后**不需要重启或 reload nginx**。浏览器强制刷新即可看到新版本。

## 3. 更新检测脚本

```bash
scp release/model-intelligence-test-monitor-*.zip root@server:/tmp/monitor.zip
ssh root@server
cd /data/docker-server/model-intelligence-test
unzip -o /tmp/monitor.zip -d .
rm /tmp/monitor.zip
```

zip 里没有 `config.json`，解压不会覆盖真实配置。`config.example.json` 会更新，新增字段时可以对照它修改 `config.json`。

## 4. 运行检测脚本

检测脚本需要 Node.js 18.3 以上（用到可选链、`fetch`、`AbortSignal.timeout`、`util.parseArgs`）。宿主机的 Node 版本太旧（会报 `SyntaxError: Unexpected token '.'`），统一用 Docker 运行：

```bash
docker run --rm \
  -v /data/docker-server/model-intelligence-test:/app:ro \
  -v /data/docker-server/nginx/html/model-intelligence-test/data:/data \
  node:22-alpine \
  node /app/monitor.mjs --config /app/config.json --output /data
```

- 脚本目录只读挂载，容器里改不了脚本和配置
- `--output /data` 覆盖 `config.json` 里的 `outputDir`，所以 `outputDir` 写什么都不影响 Docker 运行
- 第一次运行会自动拉取 `node:22-alpine` 镜像（约 50MB），之后直接使用本地镜像

每个分组完成后输出一行：

```
[monitor] 1 第 8 轮 完成（192s）
[monitor] 2 第 8 轮 失败：HTTP 504：Gateway time-out（62s）
```

只检测部分分组时在命令末尾加 `--group <id>`，可以写多次，例如 `--group 1 --group 3`。

同一时间只会运行一轮：上一轮没结束时，新的一轮输出“上一轮检测仍在进行，跳过本轮”后直接退出（锁文件 `data/.monitor.lock`，进程退出后自动失效）。

### 检查结果

```bash
cat /data/docker-server/nginx/html/model-intelligence-test/data/status.json | head -30
curl -s https://tokenhub.junly.top/model-intelligence-test/data/status.json | head -5
```

## 5. 定时任务

```bash
crontab -e
```

添加一行，每 15 分钟检测一次（频率和 `config.json` 的 `intervalMinutes` 保持一致）：

```
*/15 * * * * docker run --rm -v /data/docker-server/model-intelligence-test:/app:ro -v /data/docker-server/nginx/html/model-intelligence-test/data:/data node:22-alpine node /app/monitor.mjs --config /app/config.json --output /data >> /data/docker-server/model-intelligence-test/log.log 2>&1
```

查看日志：

```bash
tail -f /data/docker-server/model-intelligence-test/log.log
```

日志会一直增长，可以加一条每周清空的任务：

```
0 4 * * 1 : > /data/docker-server/model-intelligence-test/log.log
```

## 6. config.json 配置说明

示例（节选自 `config.example.json`）：

```json
{
  "title": "系统检测",
  "notice": "鹈鹕测试不代表模型的全部能力……",
  "baseUrl": "https://tokenhub.junly.top/v1",
  "outputDir": "/data",
  "intervalMinutes": 15,
  "historySize": 6,
  "timeoutSeconds": 1200,
  "concurrency": 3,
  "prompt": "用 SVG 画一只鹈鹕骑自行车的 2D 循环动画",
  "groups": [
    {
      "id": "1",
      "name": "GPT福利",
      "apiKey": "sk-replace-me",
      "model": "gpt-6.1-sol",
      "effort": "high",
      "enabled": true
    }
  ]
}
```

### 全局字段

| 字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `title` | 否 | `系统检测` | 系统检测板块标题 |
| `notice` | 否 | 空 | 板块顶部的提示文字，空字符串不显示 |
| `baseUrl` | 是 | — | sub2api 的 OpenAI 兼容地址，以 `/v1` 结尾，脚本请求 `<baseUrl>/chat/completions`。注意这是**容器内**能访问到的地址，见下文 |
| `outputDir` | 是 | — | 结果输出目录。Docker 运行时被 `--output /data` 覆盖，写 `/data` 即可 |
| `intervalMinutes` | 否 | `15` | 只用于页面显示“每 N 分钟更新”和下次更新时间，**实际频率由 cron 决定** |
| `historySize` | 否 | `6` | 每个分组保留最近几次结果，更早的记录和作品文件会被删除。页面按 6 格展示 |
| `timeoutSeconds` | 否 | `600` | 单次检测超时（秒），超时记为失败 |
| `concurrency` | 否 | `3` | 同时检测的分组数 |
| `prompt` | 是 | — | 检测提示词，显示在页面上 |

### groups[] 分组字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 分组唯一标识，只能用小写字母、数字、`-`、`_`，最长 64 位。作品存放在 `data/runs/<id>/` |
| `name` | 是 | 分组名，例如 `GPT福利`。页面自动加“组 ·”前缀，显示为“组 · GPT福利”，这里不要再写“组 ·” |
| `apiKey` | 启用时必填 | 该分组的系统 Key。只保存在服务器，不会写进 `status.json`，错误信息里的 Key 会被打码 |
| `model` | 是 | 模型名，和 sub2api 里的一致 |
| `effort` | 否 | 思考强度：`default`（不传参数）/ `low` / `medium` / `high` / `xhigh`，对应请求的 `reasoning_effort` |
| `prompt` | 否 | 这个分组单独使用的提示词，不填用全局 `prompt` |
| `enabled` | 否 | 设为 `false` 时不检测，也不在页面显示 |

### 增删分组的影响

- 新增分组：下一轮开始出现在页面上，不满 6 次的空格显示“待检测”
- 删除分组或设为 `enabled: false`：下一轮从页面移除，`data/runs/<id>/` 被删除
- 修改 `id` 相当于删除旧分组再新增，历史记录不保留
- 改 `name`、`model`、`effort` 不影响历史记录，下一轮生效

### baseUrl 和超时

脚本在容器里运行，`127.0.0.1` 指的是容器自己，不是宿主机。可选写法：

- `https://tokenhub.junly.top/v1`：走公网，最简单。但公网链路的网关/Cloudflare 会在 60～100 秒断开长请求，慢模型（如 Grok）会报 `HTTP 504 Gateway time-out`
- 走内网，不受网关超时限制：
  - sub2api 在 Docker 网络里：`docker run` 加 `--network <sub2api 所在网络>`，`baseUrl` 写 `http://<sub2api 容器名>:<端口>/v1`
  - sub2api 端口映射在宿主机：`docker run` 加 `--add-host=host.docker.internal:host-gateway`，`baseUrl` 写 `http://host.docker.internal:<端口>/v1`

`timeoutSeconds` 是脚本自己的上限，要比单次生成的最长耗时更长。

### 修改配置后

每轮开始时读取配置，改完不需要重启任何服务。想立即生效就手动运行一次（第 4 节）。

## 7. 常见问题

| 现象 | 原因和处理 |
|---|---|
| `SyntaxError: Unexpected token '.'` | 宿主机 Node 太旧，改用第 4 节的 Docker 命令 |
| `/usr/bin/node: No such file or directory` | 宿主机没有这个路径的 node，同样改用 Docker |
| 页面提示读取检测数据失败 | `data/status.json` 还没生成，先手动运行一次 |
| 更新前端后检测记录没了 | 清理时删掉了 `data/`，下次按第 2 节的命令操作；记录会从下一轮重新累积 |
| `HTTP 504 Gateway time-out`（约 60 秒） | `baseUrl` 走了公网，改走内网，见第 6 节 |
| `fetch failed` / `ECONNREFUSED` | `baseUrl` 在容器里访问不到，检查网络参数 |
| `超过 N 秒未完成` | 调大 `timeoutSeconds` |
| `HTTP 401` / `403` | 分组的 `apiKey` 无效、被禁用或不属于该分组 |
| `回复中没有找到 SVG 或 HTML 作品` | 模型没按要求输出，属于检测结果本身 |
| 一直“上一轮检测仍在进行” | 有一轮卡住了，`docker ps` 查看是否有残留的 node:22-alpine 容器 |

## 8. 安全注意事项

- 系统 Key 只在服务器的 `config.json` 里，发布包和 git 都不包含
- `config.json` 在 nginx 目录之外，不会被对外访问；不要把 monitor 包或 `config.json` 放进 nginx 的 html 目录
- 建议收紧权限：脚本由 root 的 cron 运行，目录不要让其他用户可写

  ```bash
  chmod 700 /data/docker-server/model-intelligence-test
  chmod 600 /data/docker-server/model-intelligence-test/config.json
  chmod -R go-w /data/docker-server/model-intelligence-test /data/docker-server/nginx/html/model-intelligence-test
  ```

- 用户测试用的是自己的 Key，由 sub2api 单点登录拉取，请求直接发往同域的 `/v1`
- 模型生成的 SVG/HTML 在 `sandbox="allow-scripts"` 的 iframe 里渲染，CSP 禁止一切网络请求

## 9. 本地预览（开发用）

`next dev`（3000 端口）不转发 `/api/v1` 和 `/v1`，验证登录和测试功能用带代理的预览：

```bash
npm run build
npm run preview     # http://127.0.0.1:3210/model-intelligence-test/
```

把 TokenHub 的登录链接换成 `127.0.0.1:3210` 打开，例如 `http://127.0.0.1:3210/model-intelligence-test/?user_id=1&token=<token>`。改了前端要重新 `npm run build`。

本地检测数据用 `npm run monitor:local` 生成：读取 `monitor/config.json`，结果写到 `public/data/`，一轮会真实调用模型，需要几分钟。
