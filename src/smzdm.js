// 什么值得买海纳 API + MCP（x-api-key 鉴权）
const API = 'https://gw-openapi.zhidemai.com/product/v1';
const MCP = 'https://gw-openapi.zhidemai.com/ai-mcp/streamable/mcp';
const MCP_TOOLS = [
  'image_search',
  'universal_content_search',
  'product_search_pro',
  'content_graph_search',
  'discount_search',
  'content_search',
];

// ---- 商品检索 Pro（POST /product/v1）----
async function searchGoods(parsed, apiKey) {
  const keyword = (parsed.product_query || parsed.keyword || '').trim();
  if (!keyword) throw { code: 400, msg: '缺少 product_query 字段' };

  const r = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      request_from: 'marvis_proxy',
      question_id: parsed.question_id || 'proxy_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      product_query: keyword,
      query_process: 1,
      size: parsed.size || 20,
      mall_id: parsed.mall_id || '',
      brand_name: parsed.brand_name || '',
      category_name: parsed.category_name || '',
      min_price: parsed.min_price != null ? parsed.min_price : null,
      max_price: parsed.max_price != null ? parsed.max_price : null,
      sort: parsed.sort || '',
      fields: parsed.fields || '',
    }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw { code: 502, msg: '值得买返回非 JSON: ' + text.slice(0, 200) };
  }
  if (data.error_code !== undefined && data.error_code !== 0) {
    throw { code: 502, msg: `值得买错误: ${data.error_msg || 'error_code=' + data.error_code}` };
  }

  const rows = (data.data || {}).rows || [];
  const goods = rows.map((g) => ({
    title: g.title || '',
    price: g.page_price != null ? g.page_price : g.price || '',
    mall_name: g.mall_name || '',
    url: g.url || '',
    shop_name: g.shop_name || '',
    main_picture: g.main_picture || '',
    promotional_info: g.promotional_info || '',
    brand_name: g.brand_name || '',
    sales_cnt: g.sales_cnt || 0,
    comment_cnt: g.comment_cnt || 0,
  }));

  return { code: 0, result: { keyword, total: goods.length, goods_list: goods, request_id: data.request_id || '' } };
}

// ---- 海纳 MCP（Streamable HTTP）----
function parseMcpText(text) {
  const t = (text || '').trim();
  if (t.startsWith('{')) {
    try { return JSON.parse(t); } catch (e) { return null; }
  }
  if (t.startsWith('event:') || t.includes('\n\ndata:')) {
    let last = null;
    for (const block of t.split('\n\n')) {
      const m = block.match(/^data: (.*)$/ms);
      if (m) { try { last = JSON.parse(m[1]); } catch (e) {} }
    }
    return last;
  }
  return null;
}

async function mcpJsonCall(payload, apiKey, sessionId, allowEmpty) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'x-api-key': apiKey,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const r = await fetch(MCP, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const sid = r.headers.get('mcp-session-id') || '';
  const text = await r.text();

  if (allowEmpty && (!text || !text.trim())) return { sid, data: null };
  const data = parseMcpText(text);
  if (!data) throw { code: 502, msg: 'MCP 返回无法解析: ' + text.slice(0, 200) };
  if (data.error) {
    throw { code: 502, msg: 'MCP 错误: ' + (data.error.message || JSON.stringify(data.error).slice(0, 200)) };
  }
  return { sid, data };
}

// 全局会话缓存 + 串行队列（避免连续 initialize 触发上游限流）
let mcpSession = null;
let mcpQueue = Promise.resolve();

async function ensureMcpSession(apiKey) {
  if (mcpSession && mcpSession.sid) return mcpSession.sid;
  const init = await mcpJsonCall(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'muse-proxy', version: '1.0' } },
    },
    apiKey
  );
  if (!init.sid) throw { code: 502, msg: 'MCP initialize 未返回会话 ID' };
  await mcpJsonCall({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, apiKey, init.sid, true);
  mcpSession = { sid: init.sid };
  return init.sid;
}

async function callMcp(parsed, apiKey) {
  const tool = (parsed.tool || '').trim();
  if (!tool) throw { code: 400, msg: '缺少 tool 字段（支持 ' + MCP_TOOLS.join('/') + ' 或 __list_tools__）' };
  if (tool !== '__list_tools__' && !MCP_TOOLS.includes(tool)) throw { code: 400, msg: '不支持的 tool: ' + tool };

  const method = tool === '__list_tools__' ? 'tools/list' : 'tools/call';
  const params = tool === '__list_tools__' ? {} : { name: tool, arguments: parsed.arguments || {} };

  let sid = await ensureMcpSession(apiKey);
  let call;
  try {
    call = await mcpJsonCall({ jsonrpc: '2.0', id: 3, method, params }, apiKey, sid);
  } catch (e) {
    // 会话可能失效：重建一次
    mcpSession = null;
    sid = await ensureMcpSession(apiKey);
    call = await mcpJsonCall({ jsonrpc: '2.0', id: 3, method, params }, apiKey, sid);
  }

  if (tool === '__list_tools__') {
    const tools = ((call.data.result || {}).tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return { code: 0, result: { tools } };
  }

  const result = call.data.result || {};
  if (result.isError) {
    throw { code: 502, msg: 'MCP 工具执行错误: ' + (result.content || []).map((c) => c.text || '').join(' ').slice(0, 300) };
  }
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('\n');
  let payload;
  try { payload = JSON.parse(text); } catch (e) { payload = text; }
  return { code: 0, result: { tool, data: payload } };
}

// 供 server.js 使用：把队列串行化封装进去
function callMcpQueued(parsed, apiKey) {
  return mcpQueue.then(() => callMcp(parsed, apiKey));
}

module.exports = { searchGoods, callMcpQueued, MCP_TOOLS };
