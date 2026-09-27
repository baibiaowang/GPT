/* agu-ann-feed adapter
 * Dedicated adapter for https://agu-ann-feed.app.workbuddy.host
 * Converts RSS/preview responses into unified Article objects.
 */

export const AGU_FEED_DEFAULTS = {
  baseUrl: 'https://agu-ann-feed.app.workbuddy.host',
  token: ''
};

export function buildFeedUrl({baseUrl=AGU_FEED_DEFAULTS.baseUrl, token, category, begin, end}={}) {
  const u = new URL('/feed', baseUrl);
  if (token) u.searchParams.set('token', token);
  if (category) u.searchParams.set('category', category);
  if (begin) u.searchParams.set('begin', begin);
  if (end) u.searchParams.set('end', end);
  return u.toString();
}

export function normalizeAguItem(item={}) {
  let answers = {};
  try { answers = typeof item.answers === 'string' ? JSON.parse(item.answers) : (item.answers || {}); } catch (_) {}

  return {
    guid: String(item.guid || item.art_code || ''),
    title: item.title || '',
    category: item.category || '其他',
    publishedAt: item.updated_at || item.notice_date || item.pubDate || '',
    summary: item.summary || '',
    answers,
    stock: {
      code: item.stock_code || '',
      name: item.stock_name || ''
    },
    links: {
      announcement: item.ann_url || '',
      pdf: item.pdf_url || ''
    },
    market: {
      close: item.close ?? null,
      preClose: item.pre_close ?? null
    }
  };
}

export async function fetchPreview({baseUrl=AGU_FEED_DEFAULTS.baseUrl, token, params={}}={}) {
  const url = new URL('/api/feed/preview', baseUrl);
  url.searchParams.set('token', token);
  Object.entries(params).forEach(([k,v])=>{
    if(v!==undefined && v!==null && v!=='') url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`agu-ann-feed ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(normalizeAguItem);
}
