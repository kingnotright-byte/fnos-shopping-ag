// 拼多多方舟商品搜索（pdd.ddk.goods.search）
const crypto = require('crypto');

const GATEWAY = 'https://gw-api.pinduoduo.com/api/router';

// 签名：secret + 参数按 ASCII 升序拼接(kv) + secret，MD5 转大写
function sign(params, secret) {
  const sorted = Object.keys(params).sort();
  const raw = secret + sorted.map((k) => `${k}${params[k]}`).join('') + secret;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase();
}

async function search(parsed, config) {
  const keyword = (parsed.keyword || '').trim();
  if (!keyword) throw { code: 400, msg: '缺少 keyword 字段' };

  const page = Math.max(1, parseInt(parsed.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(parsed.page_size || '10', 10) || 10));
  const sortType = parsed.sort_type || 0;

  const params = {
    client_id: config.clientId,
    type: 'pdd.ddk.goods.search',
    timestamp: String(Math.floor(Date.now() / 1000)),
    data_type: 'JSON',
    version: 'V1',
    keyword,
    page,
    page_size: pageSize,
    sort_type: sortType,
    pid: config.pid,
    custom_parameters: config.customParams,
  };
  params.sign = sign(params, config.clientSecret);

  const r = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw { code: 502, msg: '拼多多返回非 JSON: ' + text.slice(0, 200) };
  }

  if (data.error_response) {
    const er = data.error_response;
    throw { code: 502, msg: `${er.error_msg || '拼多多错误'}${er.sub_msg ? '：' + er.sub_msg : ''} (${er.sub_code || er.error_code})` };
  }

  const gs = data.goods_search_response || {};
  const goodsList = (gs.goods_list || []).map((g) => ({
    goods_id: g.goods_id,
    goods_name: g.goods_name,
    goods_desc: g.goods_desc,
    min_group_price: (g.min_group_price || 0) / 100, // 分为单位，转为元
    min_normal_price: (g.min_normal_price || 0) / 100,
    sales_tip: g.sales_tip || '',
    promotion_rate: g.promotion_rate || 0,
    mall_name: g.mall_name || '',
    goods_image_url: g.goods_image_url || '',
    goods_thumbnail_url: g.goods_thumbnail_url || '',
    coupon_discount: (g.coupon_discount || 0) / 100,
    has_coupon: !!g.has_coupon,
    category_name: g.category_name || '',
  }));

  return { code: 0, result: { keyword, total: goodsList.length, goods_list: goodsList, request_id: gs.request_id || '' } };
}

module.exports = { search };
