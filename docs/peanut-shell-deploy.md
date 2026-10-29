# 花生壳部署 fnos-shopping-ag 中转服务（AI 部署指南）

> 目标读者：AI 助手 / 开发者 / 自动化 Agent。本文档描述如何把「拼多多 + 什么值得买」购物搜索聚合服务部署到一台内网机器（如 NAS），并用花生壳内网穿透暴露为公网可访问的 HTTP 接口，供其他 AI 或应用调用。
>
> 本文档基于已在飞牛 NAS 上验证过的成功部署路径整理，所有真实凭据一律使用占位符 `<PLACEHOLDER>` 表示，请自行替换。

---

## 1. 架构总览

```
┌─────────────┐   HTTPS    ┌─────────────────┐   HTTP    ┌──────────────────────┐
│  调用方 AI   │ ─────────▶ │  花生壳映射域名   │ ────────▶ │  内网服务（本机）      │
│ (Muse/Claude│  公网入口   │ <yourname>.vicp │  内网隧道  │  node src/server.js   │
│  /自定义Bot)│  Bearer鉴权 │  .fun:443       │  127.0.0.1│  监听 0.0.0.0:8787     │
└─────────────┘            └─────────────────┘           └──────────┬───────────┘
                                                                     │
                                            ┌────────────────────────┼────────────────┐
                                            ▼                        ▼                ▼
                                    拼多多方舟（商品搜索）      什么值得买海纳API   值得买海纳MCP
```

要点：
- 服务本体只监听内网 `0.0.0.0:8787`，不直接暴露公网
- 花生壳负责把公网域名（HTTPS 443）隧道转发到内网 8787
- 所有请求统一校验 `Authorization: Bearer <PROXY_TOKEN>`，鉴权失败返回 401

---

## 2. 前置条件

| 项目 | 要求 |
|---|---|
| 运行环境 | 任意能跑 Node.js 的机器（NAS / 云主机 / 树莓派均可），Node >= 18 |
| 公网出口 | 花生壳账号（免费版即可），需支持 HTTPS 内网映射（非网页版穿透） |
| 平台凭据 | 拼多多方舟 client_id / secret / PID，什么值得买海纳 API Key（均需向平台申请） |

---

## 3. 部署步骤

### 3.1 获取项目与安装依赖

项目为零第三方依赖（仅用 Node 内置模块），无需 `npm install`：

```bash
# 拿到项目代码后进入目录
cd fnos-shopping-ag
node -v   # 确认 >= 18
```

### 3.2 配置环境变量

复制模板并填写：

```bash
cp .env.example .env
nano .env   # 或 vi / 任意编辑器
```

`.env` 必填项：

```ini
# 服务鉴权口令（务必改成强随机值，这是公网入口的第一道门）
PROXY_TOKEN=<PROXY_TOKEN>

# 拼多多方舟（不启用拼多多可留空）
PDD_CLIENT_ID=<PDD_CLIENT_ID>
PDD_CLIENT_SECRET=<PDD_CLIENT_SECRET>
PDD_PID=<PDD_PID>

# 什么值得买海纳（不启用值得买可留空）
SMZDM_API_KEY=<SMZDM_API_KEY>

# 监听端口
PORT=8787
```

> 至少配置一个平台的凭据 + PROXY_TOKEN 即可启动。

### 3.3 启动服务

```bash
node src/server.js
```

看到输出 `fnos-shopping-ag 已启动，监听 0.0.0.0:8787` 即成功。

**后台常驻（NAS 推荐）**：

```bash
nohup node src/server.js > /tmp/fnos-shopping-ag.log 2>&1 &
```

验证进程与日志：

```bash
ps aux | grep "src/server.js" | grep -v grep
tail -f /tmp/fnos-shopping-ag.log
```

> 经验：NAS 上 nohup 启动命令本身可能因管道阻塞而超时返回，不要等待它，改用独立的 ps/tail 命令确认。

### 3.4 本地自测（未接花生壳前）

```bash
curl -X POST http://127.0.0.1:8787/smzdm/search \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"product_query":"咖啡"}'
```

返回 JSON 即本地 OK。鉴权错误会返回 `401 {"error":"鉴权失败..."}`。

---

## 4. 花生壳内网穿透（关键步骤）

花生壳（oray）提供「HTTPS 映射」能力，可以把公网域名转发到内网任意端口。按上次成功部署的配置：

### 4.1 创建映射

1. 登录花生壳管理端（网页端 oray.com 或客户端）
2. 添加映射 → 选择 **HTTPS 映射**
3. 配置项：

| 配置项 | 值 |
|---|---|
| 域名 | 已备案/已有的花生壳域名，形如 `<yourname>.vicp.fun` |
| 映射类型 | HTTPS |
| 内网地址 | `127.0.0.1` |
| 内网端口 | `8787` |
| 鉴权 | 关闭（由服务自身 Bearer 鉴权兜底） |

4. 保存后花生壳分配公网端口（一般映射为 `https://<yourname>.vicp.fun:443` 或带端口号）

> 注意：花生壳免费版 HTTPS 映射可能需要实名/备案，按平台提示操作即可；映射成功后公网入口 = 你的花生壳域名。

### 4.2 公网验证

```bash
curl -X POST "https://<yourname>.vicp.fun:443/smzdm/search" \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"product_query":"咖啡"}'
```

能返回数据说明穿透链路打通。

---

## 5. 供其他 AI 接入

三个路由均可注册为 AI 的 HTTP 工具 / MCP 工具：

| 路由 | 方法 | 功能 | 关键参数 |
|---|---|---|---|
| `/pdd/search` | POST | 拼多多商品搜索 | `keyword`, `page`, `page_size`, `sort_type` |
| `/smzdm/search` | POST | 值得买商品检索 | `product_query`, `size`, `min_price`, `max_price` 等 |
| `/smzdm/mcp` | POST | 值得买海纳 MCP | `tool`（6 个工具名或 `__list_tools__`）, `arguments` |

**调用约定**：

- Base URL：`https://<yourname>.vicp.fun:443`
- Header：`Authorization: Bearer <PROXY_TOKEN>`、`Content-Type: application/json`
- 统一返回结构：成功 `{"code":0,"result":{...}}`；失败 `{"error":"..."}`（HTTP 4xx/5xx）

**AI 接入示例（Muse / 支持 HTTP 工具的 Agent）**：

```
工具名: smzdm_search
描述: 在什么值得买上搜索商品，返回标题、价格、店铺、链接
请求: POST https://<yourname>.vicp.fun:443/smzdm/search
请求体: {"product_query": "用户要搜索的商品关键词"}
鉴权: Bearer <PROXY_TOKEN>
```

---

## 6. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `401 鉴权失败` | PROXY_TOKEN 不匹配 | 核对 .env 与请求头，注意大小写与空格 |
| `拼多多配置缺失` | 未填 PDD 三项 | 填 client_id/secret/PID，或确认只启用值得买 |
| `值得买配置缺失` | 未填 SMZDM_API_KEY | 填写海纳 Key |
| 公网访问超时 | 花生壳隧道未通 / 端口不对 | 回内网 curl 自测；核对花生壳映射的域名、端口、协议（HTTPS） |
| 拼多多 `签名错误` | secret 错误 | 确认 secret 与授权应用一致 |
| MCP 报限流/会话错误 | 上游限流 | 等待后重试；本服务已内置 MCP 会话复用+串行队列，正常无需干预 |

---

## 7. 安全须知（务必阅读）

1. **PROXY_TOKEN 是第一道门**：公网入口暴露后，任何拿到域名的人都可以尝试调用，务必使用强随机口令并定期更换。
2. **不要把真实凭据写进代码/文档/仓库**：`.env` 加入 `.gitignore`，真实 secret 只存在于运行机器的 `.env` 文件里。
3. **平台条款**：遵守拼多多开放平台、什么值得买开放平台的服务条款（调用频率、数据使用、授权备案要求）；本项目仅供学习研究与个人自用，不缓存、不二次分发商品数据。
4. **防火墙建议**：若机器本身有防火墙，只需放行花生壳与内网端口；不要额外把 8787 直接暴露到公网。

---
