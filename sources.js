'use strict';
/**
 * xsignal — sources.js  (live candidate fetchers: X API v2 search + Grok)
 * =======================================================================
 * Turn a query into candidate items { id, text, author, likes, retweets, replies, verified, createdAtSec }
 * for signal.js to score. Adapted from XMoment's x-agent. `fetch` injectable → mock-tested. Gated on a key;
 * no key → throws (never fabricates). `node sources.js` runs the self-test.
 */
function iso(s) { const t = Date.parse(s || ''); return Number.isFinite(t) ? Math.floor(t / 1000) : undefined; }

/** X API v2 recent search → candidate items. Needs a bearer token. */
async function fetchXSearch(query, opts = {}) {
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) throw new Error('no fetch available');
  if (!opts.bearerToken) throw new Error('X_BEARER_TOKEN required for live X search');
  const q = (query || 'crypto') + ' -is:retweet -is:reply lang:en';
  const url = 'https://api.twitter.com/2/tweets/search/recent?max_results=' + (opts.max || 25) +
    '&tweet.fields=public_metrics,author_id,created_at&expansions=author_id&user.fields=username,verified&query=' + encodeURIComponent(q);
  const r = await fetchImpl(url, { headers: { authorization: 'Bearer ' + opts.bearerToken } });
  if (!r.ok) throw new Error('X search HTTP ' + r.status);
  const j = await r.json();
  const users = {}; ((j.includes && j.includes.users) || []).forEach((u) => { users[u.id] = u; });
  return ((j.data) || []).map((t) => { const u = users[t.author_id] || {}; const m = t.public_metrics || {};
    return { id: t.id, text: t.text, author: u.username, verified: !!u.verified, likes: m.like_count || 0, retweets: m.retweet_count || 0, replies: m.reply_count || 0, createdAtSec: iso(t.created_at) }; });
}

/** Grok (x.ai) → candidate items (real tweet ids only). Needs an xAI API key. */
async function fetchGrok(query, opts = {}) {
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) throw new Error('no fetch available');
  if (!opts.apiKey) throw new Error('XAI_API_KEY required for Grok');
  const r = await fetchImpl('https://api.x.ai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + opts.apiKey },
    body: JSON.stringify({ model: opts.model || 'grok-2-latest', temperature: 0.2, messages: [
      { role: 'system', content: 'You surface REAL, current viral X posts about the query. Return STRICT JSON only: {"items":[{"id","text","author","likes","retweets"}]}. Real tweet ids only — never fabricate.' },
      { role: 'user', content: 'Query: ' + (query || 'crypto') + ' — the most viral posts in the last few hours.' }] }),
  });
  if (!r.ok) throw new Error('Grok HTTP ' + r.status);
  const j = await r.json();
  const txt = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}').replace(/```json|```/g, '');
  let parsed = {}; try { parsed = JSON.parse(txt); } catch (e) { parsed = {}; }
  return (parsed.items || []).map((t) => ({ id: String(t.id), text: t.text, author: t.author, likes: t.likes || 0, retweets: t.retweets || 0 }));
}

/** Fetch candidates from the configured source (xsearch default, grok optional). */
async function fetchCandidates(query, opts = {}) {
  if (opts.source === 'grok') return fetchGrok(query, opts);
  return fetchXSearch(query, opts);
}

/** DexScreener (FREE, no key) → normalized Base token market data (top pair by liquidity). For tokenintel.js. */
async function fetchDexScreener(addr, opts = {}) {
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) throw new Error('no fetch available');
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(addr || ''))) throw new Error('valid 0x token address required');
  const r = await fetchImpl('https://api.dexscreener.com/latest/dex/tokens/' + addr);
  if (!r.ok) throw new Error('dexscreener HTTP ' + r.status);
  const j = await r.json();
  const pairs = ((j && j.pairs) || []).filter((p) => (p.chainId || '').toLowerCase() === 'base');
  if (!pairs.length) return { addr, found: false };
  const p = pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
  const tx = (p.txns && p.txns.h24) || {};
  return {
    addr, found: true,
    symbol: p.baseToken && p.baseToken.symbol, name: p.baseToken && p.baseToken.name,
    priceUsd: p.priceUsd != null ? Number(p.priceUsd) : null,
    liquidityUsd: (p.liquidity && p.liquidity.usd) || 0,
    volume24: (p.volume && p.volume.h24) || 0,
    priceChange24: (p.priceChange && p.priceChange.h24) != null ? Number(p.priceChange.h24) : null,
    pairCreatedAtMs: Number(p.pairCreatedAt) || NaN,
    buys24: tx.buys || 0, sells24: tx.sells || 0,
    dex: p.dexId || null, url: p.url || null,
  };
}

module.exports = { fetchXSearch, fetchGrok, fetchCandidates, fetchDexScreener };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  (async () => {
    const mockX = async () => ({ ok: true, json: async () => ({ data: [{ id: '9', text: 'ETH ripping', author_id: 'u', public_metrics: { like_count: 5000, retweet_count: 900, reply_count: 100 }, created_at: '2026-07-01T10:00:00Z' }], includes: { users: [{ id: 'u', username: 'trader', verified: true }] } }) });
    const mockGrok = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"items":[{"id":"8","text":"BTC new ATH","author":"whale","likes":80000,"retweets":12000}]}' } }] }) });
    const xs = await fetchXSearch('eth', { fetch: mockX, bearerToken: 't' });
    const gk = await fetchGrok('btc', { fetch: mockGrok, apiKey: 'k' });
    let noKey = false; try { await fetchXSearch('x', { fetch: mockX }); } catch (e) { noKey = true; }
    const mockDex = async () => ({ ok: true, json: async () => ({ pairs: [{ chainId: 'base', baseToken: { symbol: 'DEGEN', name: 'Degen' }, priceUsd: '0.01', liquidity: { usd: 2500000 }, volume: { h24: 800000 }, priceChange: { h24: -3 }, pairCreatedAt: 1782000000000, txns: { h24: { buys: 1200, sells: 1000 } }, dexId: 'uniswap', url: 'https://dexscreener.com/base/0xdef' }, { chainId: 'ethereum', liquidity: { usd: 9999999 } }] }) });
    const dx = await fetchDexScreener('0x' + 'de'.repeat(20), { fetch: mockDex });
    let dxBad = false; try { await fetchDexScreener('notaddr', { fetch: mockDex }); } catch (e) { dxBad = true; }

    const checks = [
      ['fetchXSearch: parses X API v2 → item w/ metrics + createdAtSec + handle', xs.length === 1 && xs[0].author === 'trader' && xs[0].likes === 5000 && Number.isInteger(xs[0].createdAtSec)],
      ['fetchGrok: parses Grok JSON → item (real id)', gk.length === 1 && gk[0].id === '8' && gk[0].author === 'whale'],
      ['gated: no key → throws (never fabricates)', noKey === true],
      ['fetchDexScreener: picks top Base pair, normalizes liq/vol/flow (ignores non-Base)', dx.found === true && dx.symbol === 'DEGEN' && dx.liquidityUsd === 2500000 && dx.buys24 === 1200],
      ['fetchDexScreener: rejects a non-address input', dxBad === true],
      ['NO fund-moving executor in the surface', !Object.keys(module.exports).some(k => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|withdraw)/i.test(k))],
    ];
    let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
    console.log(`\n${pass}/${checks.length} checks passed`);
    process.exit(pass === checks.length ? 0 : 1);
  })();
}
