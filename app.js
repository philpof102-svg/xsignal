'use strict';
/**
 * xsignal — app.js  (the deployable x402-paid "signal" ingredient for the agentic economy)
 * ========================================================================================
 * Agents (and humans) get a fresh, scored, CITED real-time X/social signal instead of stale training data.
 *   GET  /signal/preview?q=<topic>   → FREE capped preview (top 3, scores only)
 *   GET  /signal?q=<topic>           → x402-PAID full signal (402 + accepts until paid; verify via facilitator)
 *   POST /signal                     → paid; body {candidates?|query, terms?, source?, limit?}
 *   POST /mcp                        → MCP tool get_signal (streamable-http)
 *   GET  /health · /.well-known/mcp.json · /.well-known/agent-card.json
 * 🛑 SAFE: WE never sign / move funds. x402 = we RECEIVE USDC (verify-only). Live fetch gated on X_BEARER_TOKEN /
 * XAI_API_KEY (no key → a small DEMO seed so the preview always renders). `node app.js --selftest` tests it.
 */
const http = require('http');
const fs = require('fs');
const { buildSignal, previewSignal } = require('./signal');
const { buildTokenIntel, previewTokenIntel } = require('./tokenintel');
const { buildBrief, previewBrief } = require('./brief');
const { paymentRequired, verifyPayment, net } = require('./x402');
const { fetchCandidates, fetchDexScreener } = require('./sources');

const PAY_TO = process.env.XSIGNAL_PAYTO || '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9'; // receives USDC; public addr, no key
const PRICE_USD = Number(process.env.XSIGNAL_PRICE_USD || 0.01);
const BRIEF_PRICE_USD = Number(process.env.XSIGNAL_BRIEF_PRICE_USD || 0.05); // the fused brief is a "meal" (does the chaining an agent would) → priced above a single ingredient
const X402_NETWORK = process.env.X402_NETWORK || 'base'; // base (mainnet, CDP facilitator needs a key) | base-sepolia (testnet, keyless x402.org)
const FACILITATOR_URL = process.env.FACILITATOR_URL || net(X402_NETWORK).facilitator; // default facilitator per network
// Mainnet CDP facilitator auth — REUSE MainStreet's existing key (same env var names); never hard-coded.
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID || '';
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET || '';
const SERVER = { name: 'xsignal', version: '0.1.0' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-payment, mcp-protocol-version' };
const json = (res, code, obj, extra) => { res.writeHead(code, { 'content-type': 'application/json', ...CORS, ...(extra || {}) }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r(null); } }); });

// small DEMO seed so /signal/preview always renders even with no API keys (clearly labelled demo)
const SEED = [
  { id: 'demo1', text: 'BREAKING: major L2 airdrop just went live, gas spiking on Base', author: 'onchain_alpha', likes: 42000, retweets: 9100, replies: 2600, verified: true },
  { id: 'demo2', text: 'this memecoin just did 40x in an hour, CT is losing it', author: 'degen_news', likes: 31000, retweets: 7200, replies: 4100 },
  { id: 'demo3', text: 'new Clanker token trending, volume ripping on Base', author: 'base_daily', likes: 8800, retweets: 1500, replies: 600 },
];

async function getCandidates(a) {
  if (Array.isArray(a.candidates) && a.candidates.length) return { candidates: a.candidates, live: false };
  const key = process.env.X_BEARER_TOKEN || process.env.XAI_API_KEY;
  if (key) {
    try { const c = await fetchCandidates(a.query || 'crypto', { source: process.env.XAI_API_KEY && !process.env.X_BEARER_TOKEN ? 'grok' : a.source, bearerToken: process.env.X_BEARER_TOKEN, apiKey: process.env.XAI_API_KEY, max: 25 }); return { candidates: c, live: true }; }
    catch (e) { return { candidates: SEED, live: false, note: 'live fetch failed (' + e.message + ') — showing demo seed' }; }
  }
  return { candidates: SEED, live: false, note: 'no X_BEARER_TOKEN / XAI_API_KEY set — showing demo seed' };
}
const opForA = (a) => ({ query: a.query || null, terms: Array.isArray(a.terms) ? a.terms : (a.query ? String(a.query).split(/\s+/) : []), limit: Math.min(Number(a.limit) || 10, 25), minScore: a.minScore });

async function getToken(addr) { try { return await fetchDexScreener(addr, {}); } catch (e) { return { addr, found: false, error: e && e.message }; } }

// a MEAL: fuse token intel + real-time signal. Fetches both halves (token via DexScreener, signal via candidates/seed) then fuses.
async function getBrief(addr, query) {
  const intel = buildTokenIntel(await getToken(addr));
  const q = query || intel.symbol || '';
  const a = { query: q, terms: q ? String(q).split(/\s+/) : [] };
  const { candidates, live, note } = await getCandidates(a);
  const signal = buildSignal(candidates, opForA(a));
  return { intel, signal, query: q, live, note };
}

const TOOLS = [
  { name: 'get_signal', description: 'Real-time X/social signal for a topic: scored (virality+freshness) + CITED (source urls), deduped, ranked. Input: query (string) OR candidates[] (bring your own posts), terms?, source?(xsearch|grok), limit?. The live full signal is x402-paid at GET/POST /signal; this tool returns a preview unless candidates are supplied.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, candidates: { type: 'array' }, terms: { type: 'array' }, source: { type: 'string' }, limit: { type: 'integer' } } } },
  { name: 'get_token_intel', description: 'Base token MARKET intel (liquidity, 24h volume, price + change, pool age, buy/sell flow, mechanical flags) from public DEX pools. NOT a trust/safety rating. Input: addr (0x Base token). Full intel is x402-paid at GET/POST /token; this tool returns a preview.', inputSchema: { type: 'object', properties: { addr: { type: 'string' } } } },
  { name: 'get_token_brief', description: 'A fused MEAL: one call combines Base token MARKET intel (get_token_intel) + real-time social SIGNAL (get_signal) into a single "what is happening with $TOKEN right now" brief — market flags + top CITED social posts + a plain-language, non-advisory summary. Input: addr (0x Base token), query? (topic/symbol; defaults to the token symbol). Full brief is x402-paid at GET/POST /brief; this tool returns a preview.', inputSchema: { type: 'object', properties: { addr: { type: 'string' }, query: { type: 'string' } } } },
];

async function dispatch(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER });
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'ping') return ok({});
  if (method === 'tools/call') {
    const name = params && params.name;
    const a = (params && params.arguments) || {};
    if (name === 'get_signal') {
      const { candidates } = await getCandidates(a);
      const payload = Array.isArray(a.candidates) && a.candidates.length ? buildSignal(candidates, opForA(a)) : previewSignal(candidates, opForA(a));
      return ok({ content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false });
    }
    if (name === 'get_token_intel') {
      try { const payload = previewTokenIntel(await getToken(a.addr)); return ok({ content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false }); }
      catch (e) { return ok({ content: [{ type: 'text', text: 'error: ' + (e && e.message) }], isError: true }); }
    }
    if (name === 'get_token_brief') {
      try { const { intel, signal, query } = await getBrief(a.addr, a.query); const payload = previewBrief({ intel, signal, symbol: intel.symbol, query }); return ok({ content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false }); }
      catch (e) { return ok({ content: [{ type: 'text', text: 'error: ' + (e && e.message) }], isError: true }); }
    }
    return { jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      // the agent-installable skill (skill.md -> micro-paid plugin: how an agent uses the x402-paid tools)
      if (req.method === 'GET' && url === '/skill.md') { try { const md = fs.readFileSync(__dirname + '/SKILL.md', 'utf8'); res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', ...CORS }); return res.end(md); } catch (e) { return json(res, 404, { error: 'no skill' }); } }
      if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true, server: SERVER, paidRoutes: ['/signal', '/token', '/brief'], freeRoutes: ['/signal/preview', '/token/preview', '/brief/preview'], payTo: PAY_TO, priceUsd: PRICE_USD, briefPriceUsd: BRIEF_PRICE_USD, network: X402_NETWORK, facilitator: FACILITATOR_URL, cdpKeySet: !!(CDP_API_KEY_ID && CDP_API_KEY_SECRET) });

      if (url === '/mcp') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST JSON-RPC to /mcp' }, { allow: 'POST' });
        const m = await body(req); if (m === null) return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        const r = await dispatch(m); if (r === null) { res.writeHead(202, CORS); return res.end(); } return json(res, 200, r);
      }

      // FREE preview (open) — capped, scores only
      if (url === '/signal/preview') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { query: qs.get('q'), source: qs.get('source'), limit: qs.get('limit') };
        const { candidates, live, note } = await getCandidates(a);
        const p = previewSignal(candidates, opForA(a));
        return json(res, 200, { ...p, live, source_note: note });
      }

      // x402-PAID full signal
      if (url === '/signal') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { query: qs.get('q'), source: qs.get('source'), limit: qs.get('limit') };
        const reqs = paymentRequired({ priceUsd: PRICE_USD, payTo: PAY_TO, resource: '/signal', network: X402_NETWORK });
        const payHeader = req.headers['x-payment'];
        const v = await verifyPayment(payHeader, { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason }); // pay, then resubmit with X-PAYMENT
        const { candidates, live, note } = await getCandidates(a);
        return json(res, 200, { ...buildSignal(candidates, opForA(a)), live, source_note: note, paid: true });
      }

      // FREE token intel preview (open) — headline stats + flags. Data source (DexScreener) is free → works with no keys.
      if (url === '/token/preview') {
        const addr = req.method === 'POST' ? ((await body(req) || {}).addr) : qs.get('addr');
        return json(res, 200, previewTokenIntel(await getToken(addr)));
      }
      // x402-PAID full token intel
      if (url === '/token') {
        const addr = req.method === 'POST' ? ((await body(req) || {}).addr) : qs.get('addr');
        const reqs = paymentRequired({ priceUsd: PRICE_USD, payTo: PAY_TO, resource: '/token', description: 'xsignal — Base token market intel', network: X402_NETWORK });
        const v = await verifyPayment(req.headers["x-payment"], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        return json(res, 200, { ...buildTokenIntel(await getToken(addr)), paid: true });
      }

      // FREE fused-brief preview (open) — market flags + social counts only
      if (url === '/brief/preview') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), query: qs.get('q') };
        const { intel, signal, query } = await getBrief(a.addr, a.query);
        return json(res, 200, previewBrief({ intel, signal, symbol: intel.symbol, query }));
      }
      // x402-PAID fused brief — a MEAL (market intel + social signal fused), priced above a single ingredient
      if (url === '/brief') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), query: qs.get('q') };
        const reqs = paymentRequired({ priceUsd: BRIEF_PRICE_USD, payTo: PAY_TO, resource: '/brief', description: 'xsignal — fused token brief (market intel + social signal)', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        const { intel, signal, query, live, note } = await getBrief(a.addr, a.query);
        return json(res, 200, { ...buildBrief({ intel, signal, symbol: intel.symbol, query }), live, source_note: note, paid: true });
      }

      if (req.method === 'GET' && url === '/.well-known/mcp.json') return json(res, 200, { name: SERVER.name, version: SERVER.version, protocolVersion: '2024-11-05', description: 'xsignal — x402-paid real-time X/social signal (scored + cited) for agents.', mcp: { endpoint: baseUrl(req) + '/mcp', transport: 'streamable-http' }, tools: TOOLS.map((t) => ({ name: t.name, description: t.description })), paid: { routes: ['/signal', '/token', '/brief'], priceUsd: PRICE_USD, briefPriceUsd: BRIEF_PRICE_USD, asset: 'USDC', network: 'base', freePreview: ['/signal/preview', '/token/preview', '/brief/preview'] } });
      if (req.method === 'GET' && url === '/.well-known/agent-card.json') return json(res, 200, agentCard(baseUrl(req)));

      if (req.method === 'GET' && url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...CORS }); return res.end(landing()); }
      return json(res, 404, { error: 'not found' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  });
}

const baseUrl = (req) => (req.headers['x-forwarded-proto'] || 'https') + '://' + (req.headers.host || 'localhost');
function agentCard(base) {
  return { $schema: 'https://eips.ethereum.org/EIPS/eip-8004#agent-card', name: 'xsignal', description: 'x402-paid real-time X/social signal (scored + cited) for agents. Pay per call in USDC on Base; free preview available.', url: base,
    mcp: { endpoint: base + '/mcp', transport: 'streamable-http' },
    skills: [
      { id: 'real-time-signal', primary: true, name: 'Real-time X/social signal', description: 'Fresh, scored (virality+freshness), cited social signal for a topic. Full signal x402-paid; free preview at /signal/preview.', endpoint: base + '/signal', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'signal', 'x', 'social', 'realtime', 'base'] },
      { id: 'token-market-intel', name: 'Base token market intel', description: 'Liquidity/volume/price/age/buy-sell flow + mechanical flags for a Base token (market data, NOT a trust rating). Full intel x402-paid at /token; free preview at /token/preview.', endpoint: base + '/token', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'token', 'base', 'defi', 'market-data'] },
      { id: 'token-brief', name: 'Fused token brief (meal)', description: 'One call fuses Base token market intel + real-time social signal into a "what is happening with $TOKEN now" brief (market flags + cited top posts + a non-advisory summary). x402-paid at /brief; free preview at /brief/preview.', endpoint: base + '/brief', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(BRIEF_PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'brief', 'meal', 'base', 'token', 'signal'] },
    ],
    payment: { protocol: 'x402', network: 'base', asset: 'USDC', payTo: PAY_TO }, safety: { descriptorOnly: true, signsFunds: false } };
}
function landing() {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>xsignal — real-time signal for agents</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecf4;margin:0;padding:40px 20px;max-width:680px;margin:0 auto;line-height:1.6}
code{background:#1a2137;padding:2px 7px;border-radius:6px;font-size:13px}.t{background:#131a2e;border:1px solid #26304d;border-radius:14px;padding:18px;margin:14px 0}
h1{font-size:26px}.px{color:#6ee7b7;font-weight:700}a{color:#7aa2ff}</style></head><body>
<h1>⚡ xsignal</h1><p>A real-time X/social <b>signal</b> for AI agents — scored (virality + freshness) and <b>cited</b>,
instead of stale training data or generic search. Pay per call in <span class="px">USDC on Base via x402</span>. An
ingredient for the agentic economy.</p>
<div class="t"><b>Free preview</b><br/><code>GET /signal/preview?q=base+memecoin</code> — top 3, scores only.</div>
<div class="t"><b>Full signal (x402-paid, ${PRICE_USD} USDC)</b><br/><code>GET /signal?q=base+memecoin</code> — 402 until paid; full text, metrics, all items + citations.</div>
<div class="t"><b>Token intel (x402-paid)</b><br/><code>GET /token?addr=0x…</code> — liquidity, volume, price, pool age, buy/sell flow + market flags (data, not a trust rating). Free preview: <code>/token/preview?addr=0x…</code>.</div>
<div class="t"><b>Token brief — a meal (x402-paid, ${BRIEF_PRICE_USD} USDC)</b><br/><code>GET /brief?addr=0x…</code> — one call fuses market intel + social signal into a "what is happening with $TOKEN now" brief (flags + cited posts + summary). Free preview: <code>/brief/preview?addr=0x…</code>.</div>
<div class="t"><b>Agents</b> — MCP at <code>/mcp</code> (tool <code>get_signal</code>), discovery at <code>/.well-known/mcp.json</code> + <code>/.well-known/agent-card.json</code>.</div>
<p style="color:#8a97b5;font-size:13px">Signal is scored from public X posts — verify before acting; not financial advice. We never hold keys or move funds.</p></body></html>`;
}

module.exports = { createServer, dispatch, TOOLS };

if (require.main === module) {
  if (!process.argv.includes('--selftest')) {
    createServer().listen(process.env.PORT || 4520, () => console.log('xsignal live on :' + (process.env.PORT || 4520) + ' (/signal paid · /signal/preview free · /mcp · /health)'));
  } else {
    const srv = createServer();
    srv.listen(0, async () => {
      const port = srv.address().port;
      const get = (p) => new Promise((rs, rj) => { http.get({ host: '127.0.0.1', port, path: p }, (s) => { let b = ''; s.on('data', c => b += c); s.on('end', () => rs({ status: s.statusCode, body: b, headers: s.headers })); }).on('error', rj); });
      const post = (p, o, h) => new Promise((rs, rj) => { const d = JSON.stringify(o); const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d), ...(h || {}) } }, (s) => { let b = ''; s.on('data', c => b += c); s.on('end', () => rs({ status: s.statusCode, body: b })); }); r.on('error', rj); r.write(d); r.end(); });

      const health = await get('/health');
      const prev = await get('/signal/preview?q=base');
      const paid402 = await get('/signal?q=base');
      const scored = await post('/signal/preview', { candidates: [{ id: '1', text: 'ETH pumping', likes: 9000, retweets: 800 }], query: 'ETH' });
      const mcpList = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const mcpCall = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_signal', arguments: { candidates: [{ id: '1', text: 'ETH pumping hard', likes: 9000, retweets: 800, replies: 200 }] } } });
      const tok402 = await get('/token?addr=0x' + 'ab'.repeat(20));
      const briefPrev = await get('/brief/preview?addr=0xbad&q=base');
      const brief402 = await get('/brief?addr=0xbad');
      const mcpBrief = await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_token_brief', arguments: { addr: '0xbad', query: 'base' } } });
      const disc = await get('/.well-known/mcp.json');
      const card = await get('/.well-known/agent-card.json');

      const checks = [
        ['GET /health → ok + paidRoutes + network', health.status === 200 && JSON.parse(health.body).paidRoutes.includes('/signal') && !!JSON.parse(health.body).network],
        ['GET /signal/preview → 200 free preview (capped, scores only)', prev.status === 200 && JSON.parse(prev.body).preview === true],
        ['GET /signal → 402 (x402 accepts, USDC/base) until paid', paid402.status === 402 && JSON.parse(paid402.body).accepts[0].network === 'base' && JSON.parse(paid402.body).accepts[0].asset.startsWith('0x833589')],
        ['POST /signal/preview with candidates → scores them (preview)', scored.status === 200 && JSON.parse(scored.body).topScore > 0],
        ['MCP tools/list → get_signal', mcpList.status === 200 && JSON.parse(mcpList.body).result.tools[0].name === 'get_signal'],
        ['MCP get_signal (candidates) → full scored signal', mcpCall.status === 200 && JSON.parse(JSON.parse(mcpCall.body).result.content[0].text).items[0].score > 0],
        ['GET /token → x402-paid (402 until paid, payment-first, route wired)', tok402.status === 402],
        ['GET /.well-known/mcp.json → discovery lists all paid ingredients (/signal + /token + /brief)', disc.status === 200 && JSON.parse(disc.body).paid.routes.includes('/token') && JSON.parse(disc.body).paid.routes.includes('/brief') && JSON.parse(disc.body).tools.length === 3],
        ['GET /brief/preview → 200 fused-meal preview (capped)', briefPrev.status === 200 && JSON.parse(briefPrev.body).preview === true],
        ['GET /brief → x402-paid meal (402 until paid)', brief402.status === 402],
        ['MCP get_token_brief → preview brief (market + social fused)', mcpBrief.status === 200 && JSON.parse(JSON.parse(mcpBrief.body).result.content[0].text).preview === true],
        ['GET /.well-known/agent-card.json → ERC-8004 (x402 pricing, payTo)', card.status === 200 && JSON.parse(card.body).payment.protocol === 'x402'],
        ['paid route NEVER serves without a verified payment (no facilitator → 402)', paid402.status === 402],
      ];
      console.log('xsignal server self-test:');
      let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
      console.log(`\n${pass}/${checks.length} checks passed`);
      srv.close(); process.exit(pass === checks.length ? 0 : 1);
    });
  }
}
