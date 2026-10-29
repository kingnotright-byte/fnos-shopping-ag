# fnos-shopping-ag

跨平台购物搜索聚合中转服务：一个统一接口，同时对接 **拼多多方舟商品搜索** 与 **什么值得买海纳 API / MCP**。

> 适合把多个购物平台的商品搜索能力暴露给 AI 助手（如 Muse、Claude、自定义 Agent）使用，实现「一句话多平台比价」。

## 使用前准备

部署前需要填写以下环境变量，**至少填一个平台的凭据 + PROXY_TOKEN**。

| 变量 | 平台 | 说明 | 获取方式 |
|---|---|---|---|
| `PROXY_TOKEN` | **所有路由** | 服务鉴权口令，必须修改默认值 | 自己定一个强口令即可 |
| `PDD_CLIENT_ID` | 拼多多 | 应用 client_id | [拼多多开放平台](https://open.pinduoduo.com) → 创建应用 → 获取 |
| `PDD_CLIENT_SECRET` | 拼多多 | 应用 secret | 同上 |
| `PDD_PID` | 拼多多 | 推广位 PID | 多多进宝后台绑定推广位后获取 |
| `SMZDM_API_KEY` | 什么值得买 | 海纳 API Key | [什么值得买开放平台](https://openapi.zhidemai.com) → 邮件申请 → 测试通过后获正式 Key |

> 💡 不想配全量？可以先只填值得买的 `SMZDM_API_KEY`，拼多多路由会返回配置缺失提示，不影响其他功能。

## 特性

- 🛒 **拼多多**：`pdd.ddk.goods.search` 商品搜索（MD5 签名、价格自动转元、含优惠券信息）
- 📰 **什么值得买**：商品检索 Pro（海纳 API）+ 海纳 MCP（6 个工具）
- 🔐 统一 Bearer 鉴权，一个令牌控制所有路由
- 🔌 零第三方依赖，仅用 Node.js 原生模块
- 🧵 MCP 全局会话复用 + 串行队列，避免上游限流

## 快速开始

### 1. 环境要求

- Node.js >= 18（内置 `fetch` / `AbortSignal.timeout`）

### 2. 获取平台凭据

| 平台 | 入口 | 需要什么 |
|---|---|---|
| 拼多多方舟 | open.pinduoduo.com | client_id / client_secret / PID（多多进宝后台绑定推广位并完成授权备案） |
| 什么值得买 | openapi.zhidemai.com | x-api-key（邮件申请，测试通过后获正式 Key） |

### 3. 配置与启动

```bash
cp .env.example .env
# 编辑 .env，填入你的凭据
npm start
```

服务默认监听 `0.0.0.0:8787`。

### 4. 调用

所有请求需带 Header：`Authorization: Bearer <PROXY_TOKEN>`

#### 拼多多商品搜索

```bash
curl -X POST http://127.0.0.1:8787/pdd/search \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"keyword":"蓝牙耳机","page":1,"page_size":10,"sort_type":0}'
```

#### 什么值得买商品检索

```bash
curl -X POST http://127.0.0.1:8787/smzdm/search \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"product_query":"iphone16","size":10}'
```

#### 什么值得买海纳 MCP

```bash
# 列出工具
curl -X POST http://127.0.0.1:8787/smzdm/mcp \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"tool":"__list_tools__"}'

# 调用工具（以 discount_search 为例）
curl -X POST http://127.0.0.1:8787/smzdm/mcp \
  -H "Authorization: Bearer <PROXY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"tool":"discount_search","arguments":{"request_from":"marvis_proxy","question_id":"demo_001","product_query":"咖啡"}}'
```

### MCP 工具列表

| 工具 | 说明 |
|---|---|
| `image_search` | 图片搜索 |
| `universal_content_search` | 通用内容搜索 |
| `product_search_pro` | 商品检索 Pro |
| `content_graph_search` | 内容图谱搜索 |
| `discount_search` | 折扣搜索（必填 request_from / question_id / product_query） |
| `content_search` | 内容搜索 |

## 接入 AI 助手

在支持 MCP / HTTP 工具调用的 AI 助手中，将上述三个路由注册为工具即可。示例（供 Muse 类助手使用）：

```
POST https://<你的域名>:<端口>/pdd/search
Authorization: Bearer <PROXY_TOKEN>
Body: {"keyword": "<商品关键词>", "page_size": 10}
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `PROXY_TOKEN` | 是 | 中转服务统一鉴权口令，务必修改默认值 |
| `PDD_CLIENT_ID` | 拼多多路由使用 | 拼多多方舟应用 client_id |
| `PDD_CLIENT_SECRET` | 拼多多路由使用 | 拼多多方舟应用 secret |
| `PDD_PID` | 拼多多路由使用 | 推广位 PID |
| `PDD_CUSTOM_PARAMS` | 否 | 自定义参数，默认 `ai_proxy` |
| `SMZDM_API_KEY` | 值得买路由使用 | 什么值得买海纳 Key（Header x-api-key） |
| `PORT` | 否 | 监听端口，默认 8787 |

## 路由一览

| 路由 | 方法 | 功能 |
|---|---|---|
| `/pdd/search` | POST | 拼多多商品搜索 |
| `/smzdm/search` | POST | 什么值得买商品检索 |
| `/smzdm/mcp` | POST | 什么值得买海纳 MCP |

## 免责声明

1. 本项目**仅供学习研究与个人自用**，不建议用于商业用途或对外提供第三方服务。
2. 请遵守拼多多开放平台、什么值得买开放平台各自的服务条款与使用限制（包括但不限于调用频率、数据使用范围、授权备案要求）。
3. 各平台返回的商品数据（标题、价格、图片、描述等）知识产权归原平台/商家所有，本项目仅做技术转发，不缓存、不二次分发商品数据。
4. 使用本项目产生的任何合规风险由使用者自行承担。

## License

MIT
*（内容由AI生成，仅供参考）*
*（内容由AI生成，仅供参考）*
