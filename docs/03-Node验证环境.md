# 第 3 步：Node 网关验证环境

状态：本地接口测试通过；远程宝塔面板尚未部署。根据用户要求，本步使用 Node.js，不使用 Compose。当前服务是 ELSDTU 的最小验证程序，**尚未接入 ThingsBoard，也不是完整生产中台**。

## 1. 本步交付与验收

验证程序提供网关注册、独立令牌认证、心跳上报、在线/离线计算和本地数据持久化。网关模拟器每 10 秒发送一次心跳；超过 30 秒没有心跳时显示离线。

| 检查项 | 通过条件 |
| --- | --- |
| 服务 | `GET /health` 返回 `{"status":"ok"}` |
| 注册 | 管理员创建 `ELSDTU-GW-01`，获得仅显示一次的网关令牌 |
| 在线 | 模拟器发送心跳后，管理员列表中的 `online` 为 `true` |
| 离线 | 停止模拟器超过 30 秒后，`online` 为 `false` |
| 持久化 | 重启服务后，网关仍在列表中，原令牌仍可用于心跳 |

此步不含 Modbus 采集和遥测上报，它们属于第 4 步。

本地验证记录：在 Node.js v22.15.0 下，注册、认证、心跳、离线判断与重启持久化的集成测试通过。当前 Codex Windows 沙箱对入口文件路径的 `realpath` 返回 `EPERM`，因此执行时将同一测试源码从标准输入加载；三个源码文件的语法检查也通过。远程运行仍需在宝塔面板验收。

## 2. 本地运行

需要 Node.js 22 或更新版本；项目不依赖第三方 npm 包，无需 `npm install`。

在项目根目录运行测试：

```powershell
node --test
```

启动服务前，在当前终端设置一个至少 16 字符的随机管理令牌：

```powershell
$env:ADMIN_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
$env:HOST = '127.0.0.1'
$env:PORT = '8090'
node src/server.mjs
```

服务默认将网关注册记录存入项目根目录的 `.data/gateways.json`。`.data/` 已被 Git 忽略。数据文件只保存网关令牌的 SHA-256 摘要，不保存令牌原文。

在另一终端设置同一个 `ADMIN_TOKEN`，然后创建和查看网关：

```powershell
$headers = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
$gateway = Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/gateways' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"serialNo":"GW-001","name":"ELSDTU-GW-01"}'
$gateway
Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/gateways' -Headers $headers
```

注册响应中的 `token` 仅返回一次；不要将其提交到 Git。让模拟器运行：

```powershell
$env:GATEWAY_ID = $gateway.id
$env:GATEWAY_TOKEN = $gateway.token
node src/simulate-gateway.mjs
```

模拟器在当前终端运行。另开终端查询网关列表即可观察 `online` 和 `lastSeenAt`。如果出现重复序列号，注册接口返回 409；可以使用新的 `serialNo`。

## 3. API 摘要

| 方法 | 路径 | 认证 | 作用 |
| --- | --- | --- | --- |
| GET | `/health` | 无 | 服务存活检查 |
| GET | `/api/gateways` | 管理令牌 | 返回网关列表与在线状态 |
| POST | `/api/gateways` | 管理令牌 | 注册网关，返回一次性网关令牌 |
| POST | `/api/gateways/{id}/heartbeat` | 对应网关令牌 | 更新最后心跳时间 |

认证头格式为 `Authorization: Bearer <token>`。服务默认监听 `127.0.0.1:8090`。当前数据存储适合单实例原型，不支持多个 Node 进程共享写入；正式环境需要数据库、身份权限和操作审计。

## 4. 宝塔面板部署包

远程服务器只能通过宝塔面板访问，因此项目同时提供独立的 `ELSDTU-node-poc.zip` 上传包。面板操作步骤：

1. 在宝塔的 **文件** 页面创建 `/www/wwwroot/ELSDTU`，上传并解压部署包。确认解压后该目录直接包含 `package.json` 和 `src/`，没有多余的一层目录。
2. 在宝塔 **软件商店** 安装 Node.js 版本管理器，并准备 Node.js 22 或更新版本。
3. 在 **网站 → Node 项目 → 添加项目** 中选择该目录，将启动文件设为 `src/server.mjs`，端口设为 `8090`，项目名设为 `ELSDTU`。宝塔的 Node 项目使用 PM2 守护进程；请只运行 **1 个实例**，因为当前使用单文件数据存储。[宝塔 Node 项目说明](https://docs.bt.cn/practical-tutorials/nextjs-deployment)
4. 在项目环境变量中设置 `ADMIN_TOKEN`（随机长字符串）、`HOST=127.0.0.1`、`PORT=8090`、`DATA_FILE=/www/wwwroot/ELSDTU/.data/gateways.json`。确认项目运行用户对 `.data/` 有写权限。不要把令牌写到仓库文件或面板截图里。
5. 用面板终端在服务器本机访问 `http://127.0.0.1:8090/health`。若要通过域名访问，在宝塔站点配置 HTTPS 和到 `http://127.0.0.1:8090` 的反向代理；反向代理步骤见[宝塔官方文档](https://docs.bt.cn/user-guide/site/php/site-config/reverse-proxy)。不要直接将 8090 端口对公网放行。

远程网关上线检查还需要在面板终端或 API 客户端以管理员令牌创建网关，并在可运行 Node.js 的主机上启动 `src/simulate-gateway.mjs`。若模拟器在服务器外，`PLATFORM_URL` 需设为上述 HTTPS 域名。

## 5. 当前限制与后续决定

- 由于没有服务器地址或可用 SSH 会话，尚不能代用户在宝塔面板上传、设置环境变量和验收远程服务。
- 这里的心跳只证明网关身份和在线链路；没有现场协议驱动。第 4 步将加入 Modbus TCP 模拟器与点位采集。
- ThingsBoard 保留为产品能力参考；是否实际集成，要在后续规则链和组态能力验证时决定，不能把本 Node 原型等同于 ThingsBoard。
