# 模型智能测试站 - 部署说明

## 架构概览

- **前端**：Next.js 静态导出，由 nginx 挂在 `https://tokenhub.junly.top/model-intelligence-test/`
- **系统检测数据**：nginx 静态目录 `/usr/share/nginx/html/model-intelligence-test-data/`，对外路径 `/model-intelligence-test/data/`
- **定时脚本**：`monitor/monitor.mjs`，cron 每 15 分钟跑一轮，写 `status.json` 和作品文件。只依赖 Node 内置模块，服务器不用 `npm install`
- **单点登录**：从 sub2api 跳转时带 `?user_id=&token=`，前端读取后立刻从地址栏去掉
- **用户作品**：存在用户自己浏览器的 IndexedDB 里，不上传服务器

服务器上的目录：

```
/usr/share/nginx/html/model-intelligence-test/        ← 发布包 web/（前端静态文件）
/usr/share/nginx/html/model-intelligence-test-data/   ← 定时脚本输出（status.json、runs/）
/opt/model-intelligence-test/monitor/                 ← 发布包 monitor/ + 你自己的 config.json
```

## 1. 生成发布包（本地）

```bash
npm install
npm run release
```

`npm run release` 依次执行单元测试、类型检查、ESLint、构建和打包，任何一步失败都会停止。输出：

```
release/model-intelligence-test-<版本>-<日期时间>.zip
```

zip 解压后的结构：

```
model-intelligence-test-0.1.0-YYYYMMDD-HHMM/
├── web/                     # 前端静态文件，整个目录部署到 nginx
├── monitor/
│   ├── monitor.mjs          # 定时检测脚本
│   ├── lib/                 # chat.mjs、artifact.mjs
│   └── config.example.json  # 配置模板
├── nginx-config.conf        # nginx location 配置片段
└── DEPLOY.md                # 本文档
```

发布包**不包含** `monitor/config.json`。真实配置里有系统 API Key，只在服务器上维护，见第 4 节。

只想重新打包（已经 build 过）可以运行 `npm run package`。

## 2. 上传并解压

```bash
scp release/model-intelligence-test-*.zip user@server:/tmp/
ssh user@server
cd /tmp
unzip -o model-intelligence-test-*.zip
cd model-intelligence-test-*/      # 进入解压出的目录，下文都在这个目录执行
```

## 3. 部署前端

```bash
sudo mkdir -p /usr/share/nginx/html/model-intelligence-test
sudo rsync -a --delete web/ /usr/share/nginx/html/model-intelligence-test/
```

没有 rsync 时：

```bash
sudo rm -rf /usr/share/nginx/html/model-intelligence-test
sudo cp -r web /usr/share/nginx/html/model-intelligence-test
```

前端目录和数据目录是分开的，替换前端不会影响已有的检测记录。

## 4. 部署定时脚本

首次部署：

```bash
sudo mkdir -p /opt/model-intelligence-test /usr/share/nginx/html/model-intelligence-test-data
sudo cp -r monitor /opt/model-intelligence-test/
sudo cp /opt/model-intelligence-test/monitor/config.example.json /opt/model-intelligence-test/monitor/config.json
sudo nano /opt/model-intelligence-test/monitor/config.json   # 按第 6 节填写
```

更新脚本时**保留已有的 config.json**，只覆盖代码：

```bash
sudo cp monitor/monitor.mjs /opt/model-intelligence-test/monitor/
sudo cp -r monitor/lib /opt/model-intelligence-test/monitor/
sudo cp monitor/config.example.json /opt/model-intelligence-test/monitor/
```

权限：脚本用哪个用户跑，数据目录就归哪个用户，配置文件只让它能读：

```bash
sudo chown -R www-data:www-data /opt/model-intelligence-test /usr/share/nginx/html/model-intelligence-test-data
sudo chmod 600 /opt/model-intelligence-test/monitor/config.json
```

服务器需要 Node.js 20 或更高版本（`node -v` 确认）。

## 5. 配置 nginx

把 `nginx-config.conf` 里的四个 `location` 块合并到 `tokenhub.junly.top` 的 `server { }` 里，放在 sub2api 的 `location /` 之前：

```bash
sudo nano /etc/nginx/conf.d/tokenhub.junly.top.conf   # 以实际配置文件路径为准
sudo nginx -t
sudo systemctl reload nginx
```

四个块的作用：

- `location /model-intelligence-test/`：前端页面
- `location = /model-intelligence-test`：没带结尾斜杠时跳转，保留 `?user_id=&token=`
- `location ^~ /model-intelligence-test/_next/`：带哈希的静态资源，长期缓存
- `location ^~ /model-intelligence-test/data/`：检测数据，禁止缓存

如果 nginx 跑在 Docker 里，`alias` 里的路径是容器内路径，要把宿主机的前端目录和数据目录都挂载进去，例如 `-v /usr/share/nginx/html/model-intelligence-test-data:/usr/share/nginx/html/model-intelligence-test-data:ro`。

## 6. config.json 配置说明

示例（节选自 `monitor/config.example.json`）：

```json
{
  "title": "系统检测",
  "notice": "鹈鹕测试不代表模型的全部能力……",
  "baseUrl": "http://127.0.0.1:30300/v1",
  "outputDir": "/usr/share/nginx/html/model-intelligence-test-data",
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
| `baseUrl` | 是 | — | sub2api 的 OpenAI 兼容地址，以 `/v1` 结尾，脚本会请求 `<baseUrl>/chat/completions` |
| `outputDir` | 是 | — | 结果输出目录，必须和 nginx `/model-intelligence-test/data/` 的 `alias` 指向同一处 |
| `intervalMinutes` | 否 | `15` | 只用于页面显示“每 N 分钟更新”和下次更新时间，**实际频率由 cron 决定**，两边要保持一致 |
| `historySize` | 否 | `6` | 每个分组保留最近几次结果，更早的记录和作品文件会被删除。页面固定按 6 格展示 |
| `timeoutSeconds` | 否 | `600` | 单次检测超时（秒），超时记为失败 |
| `concurrency` | 否 | `3` | 同时检测的分组数 |
| `prompt` | 是 | — | 检测提示词，显示在页面上 |

### groups[] 分组字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 分组唯一标识，只能用小写字母、数字、`-`、`_`，最长 64 位。作品存放在 `runs/<id>/` 下 |
| `name` | 是 | 分组名，例如 `GPT福利`。页面会自动加“组 ·”前缀，卡片标题显示为“组 · GPT福利”，这里不要再写“组 ·” |
| `apiKey` | 启用时必填 | 该分组的系统 Key（sub2api 里属于这个分组的 Key）。只保存在服务器，不会写进 `status.json`，错误信息里出现的 Key 也会被打码 |
| `model` | 是 | 模型名，和 sub2api 里的模型名一致 |
| `effort` | 否 | 思考强度：`default`（不传参数）/ `low` / `medium` / `high` / `xhigh`，对应请求里的 `reasoning_effort` |
| `prompt` | 否 | 这个分组单独使用的提示词，不填就用全局 `prompt` |
| `enabled` | 否 | 设为 `false` 时不检测，也不在页面显示 |

### 增删分组的影响

- 新增分组：下一轮检测开始出现在页面上，前 6 次不满时空格显示“待检测”
- 删除分组或设为 `enabled: false`：下一轮检测时从页面移除，`runs/<id>/` 目录会被删掉
- 修改 `id` 相当于删除旧分组再新增一个，历史记录不会保留
- 改 `name`、`model`、`effort` 不影响历史记录，新的值从下一轮生效

### baseUrl 和超时

脚本和 sub2api 在同一台机器时，`baseUrl` 用内网地址 `http://127.0.0.1:30300/v1`（端口以 sub2api 实际监听为准）。不要用 `https://tokenhub.junly.top/v1`：公网链路上的 nginx / Cloudflare 会在 60～100 秒断开长请求，Grok 这类慢模型会一直报 `HTTP 504 Gateway time-out`。

`timeoutSeconds` 是脚本自己的上限，必须比单次生成的最长耗时更长。走内网地址时，它才是唯一生效的超时。

### 修改配置后

配置在每轮开始时读取，改完不用重启任何服务。想马上看效果就手动跑一次（第 7 节）。

## 7. 手动运行一次

```bash
sudo -u www-data node /opt/model-intelligence-test/monitor/monitor.mjs \
  --config /opt/model-intelligence-test/monitor/config.json
```

每个分组完成后输出一行，例如：

```
[monitor] 1 第 8 轮 完成（192s）
[monitor] 2 第 8 轮 失败：HTTP 504：Gateway time-out（62s）
```

其他参数：

- `--group <id>`：只检测指定分组，可以写多次，例如 `--group 1 --group 3`
- `--output <dir>`：临时改输出目录，覆盖配置里的 `outputDir`

检查输出：

```bash
cat /usr/share/nginx/html/model-intelligence-test-data/status.json
curl -s https://tokenhub.junly.top/model-intelligence-test/data/status.json | head
```

同一时间只会跑一轮。上一轮没结束时，新的一轮会输出“上一轮检测仍在进行，跳过本轮”后直接退出（锁文件是 `outputDir/.monitor.lock`，进程退出后自动失效）。

## 8. 定时任务

### cron（推荐）

```bash
sudo crontab -u www-data -e
```

添加一行（频率和 `intervalMinutes` 一致）：

```
*/15 * * * * /usr/bin/node /opt/model-intelligence-test/monitor/monitor.mjs --config /opt/model-intelligence-test/monitor/config.json >> /var/log/model-intelligence-test.log 2>&1
```

日志文件要先建好并交给 www-data：

```bash
sudo touch /var/log/model-intelligence-test.log
sudo chown www-data:www-data /var/log/model-intelligence-test.log
```

`which node` 确认 node 路径，用 nvm 安装的要写完整路径。

### systemd timer（可选）

`/etc/systemd/system/model-intelligence-test.service`：

```ini
[Unit]
Description=Model Intelligence Test Monitor
After=network.target

[Service]
Type=oneshot
User=www-data
ExecStart=/usr/bin/node /opt/model-intelligence-test/monitor/monitor.mjs --config /opt/model-intelligence-test/monitor/config.json
```

`/etc/systemd/system/model-intelligence-test.timer`：

```ini
[Unit]
Description=Model Intelligence Test Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now model-intelligence-test.timer
systemctl list-timers | grep model-intelligence
```

## 9. 验证

1. 打开 `https://tokenhub.junly.top/model-intelligence-test/`，不登录也能看到“系统检测”
2. 从 TokenHub 带登录参数进入，“我的测试”能列出自己的 Key 和模型，选好后能流式生成
3. 地址栏里的 `token` 在页面加载后被去掉
4. 浏览器开发者工具里 `/model-intelligence-test/data/status.json` 的响应头是 `Cache-Control: no-store`

## 10. 日志排查

```bash
tail -f /var/log/model-intelligence-test.log                 # cron
journalctl -u model-intelligence-test.service -f             # systemd
tail -f /var/log/nginx/access.log | grep model-intelligence  # nginx
```

| 现象 | 原因和处理 |
|---|---|
| 页面提示读取检测数据失败 | `status.json` 还没生成，或者 nginx `data/` 的 alias 和 `outputDir` 不一致 |
| `HTTP 504 Gateway time-out`（约 60 秒） | `baseUrl` 走了公网，改成内网地址，见第 6 节 |
| `超过 N 秒未完成` | 调大 `timeoutSeconds` |
| `HTTP 401` / `403` | 分组的 `apiKey` 无效、被禁用或不属于该分组 |
| `回复中没有找到 SVG 或 HTML 作品` | 模型没按要求输出，属于检测结果本身 |
| 一直“上一轮检测仍在进行” | 有一轮检测卡住了，检查是否有残留的 node 进程 |
| 刷新后页面还是旧版本 | 浏览器缓存了 `index.html`，强制刷新；`_next/` 资源带哈希，不受影响 |

## 11. 安全注意事项

- 系统 Key 只在服务器的 `config.json` 里，发布包和 git 都不包含它
- 用户测试用的是自己的 Key，由 sub2api 单点登录接口拉取，请求直接发往同域的 `/v1`
- 模型生成的 SVG/HTML 在 `sandbox="allow-scripts"` 的 iframe 里渲染，CSP 禁止一切网络请求，拿不到页面上的 token

## 12. 本地预览（开发用）

`next dev`（3000 端口）不会转发 `/api/v1` 和 `/v1`，验证登录和测试功能要用带代理的预览：

```bash
npm run build
npm run preview     # http://127.0.0.1:3210/model-intelligence-test/
```

把 TokenHub 的登录链接换成 `127.0.0.1:3210` 打开即可，例如 `http://127.0.0.1:3210/model-intelligence-test/?user_id=1&token=<token>`。代理把 `/api/`、`/v1/`、`/login` 转发到 `https://tokenhub.junly.top`，只接受本机访问。改了前端要重新 `npm run build`。

本地系统检测数据用 `npm run monitor:local` 生成：读取 `monitor/config.json`，结果写到 `public/data/`，一轮会真实调用模型，需要几分钟。
