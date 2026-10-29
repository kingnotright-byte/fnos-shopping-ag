// fnos-shopping-ag：拼多多 + 什么值得买 购物搜索聚合中转
// 监听 0.0.0.0:PORT（默认 8787）
//   POST /pdd/search    -> 拼多多商品搜索（pdd.ddk.goods.search）
//   POST /smzdm/search  -> 什么值得买商品检索 Pro（海纳 API）
//   POST /smzdm/mcp     -> 什么值得买海纳 MCP（6 个工具）
// 所有路由统一校验 Authorization: Bearer <PROXY_TOKEN>
const http = require('http');
const pdd = require('./pdd');
const smzdm = require('./smzdm');

const PORT = parseInt(process.env.PORT || '8787', 10);
const PROXY_TOKEN = process.env.PROXY_TOKEN || 'please-change-me';

const PDD_CONFIG = {
  clientId: process.env.PDD_CLIENT_ID || '',
  clientSecret: process.env.PDD_CLIENT_SECRET || '',
  pid: process.env.PDD_PID || '',
  customParams: process.env.PDD_CUSTOM_PARAMS || 'ai_proxy',
};
const SMZDM_API_KEY = process.env.SMZDM_API_KEY || '';

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 20 * 1024) req.destroy();
  });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch (e) {
      return cb(new Error('请求体不是合法 JSON'));
    }
    cb(null, parsed);
  });
  req.on('error', (e) => cb(e));
}

function handlePost(req, res, handler) {
  readJsonBody(req, (err, parsed) => {
    if (err) return send(res, 400, { error: err.message });
    handler(parsed)
      .then((out) => send(res, 200, out))
      .catch((e) => send(res, e.code || 502, { error: e.msg || String(e) }));
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    return send(res, 405, { error: '仅支持 POST 请求' });
  }
  const url = new URL(req.url, 'http://localhost');

  // 统一鉴权
  const auth = req.headers['authorization'] || '';
  if (auth !== 'Bearer ' + PROXY_TOKEN) {
    return send(res, 401, { error: '鉴权失败：Authorization 头无效' });
  }

  // 拼多多商品搜索
  if (url.pathname === '/pdd/search') {
    if (!PDD_CONFIG.clientId || !PDD_CONFIG.clientSecret || !PDD_CONFIG.pid) {
      return send(res, 500, { error: '拼多多配置缺失（PDD_CLIENT_ID / PDD_CLIENT_SECRET / PDD_PID）' });
    }
    return handlePost(req, res, (parsed) => pdd.search(parsed, PDD_CONFIG));
  }

  // 什么值得买商品检索
  if (url.pathname === '/smzdm/search') {
    if (!SMZDM_API_KEY) {
      return send(res, 500, { error: '值得买配置缺失（SMZDM_API_KEY）' });
    }
    return handlePost(req, res, (parsed) => smzdm.searchGoods(parsed, SMZDM_API_KEY));
  }

  // 什么值得买海纳 MCP
  if (url.pathname === '/smzdm/mcp') {
    if (!SMZDM_API_KEY) {
      return send(res, 500, { error: '值得买配置缺失（SMZDM_API_KEY）' });
    }
    return handlePost(req, res, (parsed) => smzdm.callMcpQueued(parsed, SMZDM_API_KEY));
  }

  return send(res, 404, { error: '路径不存在，支持 POST /pdd/search、POST /smzdm/search、POST /smzdm/mcp' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`fnos-shopping-ag 已启动，监听 0.0.0.0:${PORT}`);
});
