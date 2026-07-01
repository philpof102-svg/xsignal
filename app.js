'use strict';
/**
 * xsignal -app.js  (the deployable x402-paid "signal" ingredient for the agentic economy)
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
const crypto = require('crypto');
const { buildSignal, previewSignal } = require('./signal');
const { buildTokenIntel, previewTokenIntel } = require('./tokenintel');
const { buildBrief, previewBrief } = require('./brief');
const { quoteIntent, buildIntent, previewIntent } = require('./intent');
const { paymentRequired, verifyPayment, net } = require('./x402');
const { fetchCandidates, fetchDexScreener } = require('./sources');

const PAY_TO = process.env.XSIGNAL_PAYTO || '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9'; // receives USDC; public addr, no key
const PRICE_USD = Number(process.env.XSIGNAL_PRICE_USD || 0.01);
const BRIEF_PRICE_USD = Number(process.env.XSIGNAL_BRIEF_PRICE_USD || 0.05); // the fused brief is a "meal" (does the chaining an agent would) → priced above a single ingredient
const INTENT_PRICE_USD = Number(process.env.XSIGNAL_INTENT_PRICE_USD || 0.01); // outcome-priced momentum verdict, pay-first (the fee IS the no-fill fee); FLAT price, floor $0.01
const X402_NETWORK = process.env.X402_NETWORK || 'base'; // base (mainnet, CDP facilitator needs a key) | base-sepolia (testnet, keyless x402.org)
const FACILITATOR_URL = process.env.FACILITATOR_URL || net(X402_NETWORK).facilitator; // default facilitator per network
// Mainnet CDP facilitator auth -REUSE MainStreet's existing key (same env var names); never hard-coded.
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID || '';
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET || '';
const SERVER = { name: 'xsignal', version: '0.1.0' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-payment, mcp-protocol-version' };
const json = (res, code, obj, extra) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...CORS, ...(extra || {}) }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r(null); } }); });
const sha256 = (s) => 'sha256:' + crypto.createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');
// keyless tamper-evidence receipt (the safe residue of the "receipt" vector -hashes, NOT a trustless proof / signature)
function makeReceipt(input, output, settlementTx) { return { inputHash: sha256(input), outputHash: sha256(output), issuedAtSec: Math.floor(Date.now() / 1000), settlementTx: settlementTx || null, note: 'Tamper-evidence hashes (keyless), NOT a trustless proof of inference.' }; }
const isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test(String(s || ''));
// Capped FREE PROBE: 3 free full calls per wallet, so a stranger can EVALUATE quality before committing (closes the
// "pay-blind-to-an-unknown" gap for a zero-rep service) WITHOUT opening a free tier. Caller self-identifies via ?wallet=0x…
// In-memory (resets on redeploy — fine for a marketing probe; abuse via rotating addrs is worth ~$0.03, not worth defending).
const PROBE_MAX = Number(process.env.XSIGNAL_PROBE_FREE || 3);
const probeUsage = new Map();
function grantProbe(wallet) { if (!isAddr(wallet)) return null; const w = String(wallet).toLowerCase(); const used = probeUsage.get(w) || 0; if (used >= PROBE_MAX) return null; probeUsage.set(w, used + 1); return { free: true, trial: used + 1, of: PROBE_MAX, remaining: PROBE_MAX - (used + 1), note: 'Free trial call ' + (used + 1) + '/' + PROBE_MAX + ' for this wallet. After that, pay via x402.' }; }

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
    catch (e) { return { candidates: SEED, live: false, note: 'live fetch failed (' + e.message + ') - showing demo seed' }; }
  }
  return { candidates: SEED, live: false, note: 'no X_BEARER_TOKEN / XAI_API_KEY set - showing demo seed' };
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
  { name: 'get_intent', description: 'FLAGSHIP. An outcome-priced momentum verdict that ABSTAINS below your confidence bar - the only x402 signal that refuses to answer (honestly) when it is not sure. Post {addr, min_confidence 0-1} then pay $0.01, and get a mechanical momentum verdict "gaining" or "fading" IF the signal agreement clears your bar, else a calibrated "abstain". Paid answers carry a keyless tamper-evidence receipt. confidence is a transparent heuristic, NOT a prediction; not financial advice. x402-paid at GET/POST /intent (3 free calls per wallet via ?wallet=0x…). Example: GET /intent?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&min_confidence=0.7', inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address to read momentum for' }, min_confidence: { type: 'number', description: '0-1; abstain (no verdict, you still pay the flat fee) if mechanical confidence is below this. Default 0.6' }, question: { type: 'string', description: 'optional free-text label / social query; defaults to the token symbol' } } } },
  { name: 'get_token_brief', description: 'A fused MEAL: one call combines Base token market intel + real-time social signal into a single "what is happening with $TOKEN right now" brief - market flags + top CITED social posts + a plain-language, non-advisory summary. Saves an agent the fetch-and-fuse work. x402-paid at GET/POST /brief ($0.05; 3 free per wallet via ?wallet=0x…). Example: GET /brief?addr=0x4ed4…&q=degen', inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' }, query: { type: 'string', description: 'optional topic/symbol for the social half; defaults to the token symbol' } } } },
  { name: 'get_signal', description: 'Real-time X/social signal for a topic: scored (virality + freshness) and CITED (source urls), deduped and ranked. Input: query (topic) OR candidates[] (bring your own posts to score). x402-paid at GET/POST /signal ($0.01; 3 free per wallet via ?wallet=0x…). Example: GET /signal?q=base+memecoin', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'the topic/keywords to get a signal for' }, candidates: { type: 'array', description: 'optional: your own posts to score instead of a live fetch' }, terms: { type: 'array', description: 'optional explicit match terms' }, source: { type: 'string', description: 'xsearch | grok (live source, if a key is set)' }, limit: { type: 'integer', description: 'max items to return (<=25)' } } } },
  { name: 'get_token_intel', description: 'Base token MARKET data (liquidity, 24h volume, price + change, pool age, buy/sell flow, mechanical flags) from public DEX pools. Market data, NOT a trust/safety rating. Best used as an input to get_token_brief. x402-paid at GET/POST /token ($0.01; 3 free per wallet via ?wallet=0x…).', inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' } } } },
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
    // NO FREE TIER: MCP tools return an x402 PAYMENT POINTER (price + accepts + how to pay), not free data.
    const PAID = { get_signal: ['/signal', PRICE_USD, 'xsignal - real-time X/social signal'], get_token_intel: ['/token', PRICE_USD, 'xsignal - Base token market intel'], get_token_brief: ['/brief', BRIEF_PRICE_USD, 'xsignal - fused token brief (meal)'], get_intent: ['/intent', INTENT_PRICE_USD, 'xsignal - outcome-priced momentum verdict (may abstain)'] };
    if (PAID[name]) {
      const [resource, price, description] = PAID[name];
      const reqs = paymentRequired({ priceUsd: price, payTo: PAY_TO, resource, description, network: X402_NETWORK });
      return ok({ content: [{ type: 'text', text: JSON.stringify({ paymentRequired: true, ...reqs, httpEndpoint: resource, note: 'No free tier - pay via x402 at ' + resource + ' (HTTP) to receive the result. ' + price + ' USDC on Base.' }) }], isError: false });
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
      if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true, server: SERVER, paidRoutes: ['/signal', '/token', '/brief', '/intent'], noFreeTier: true, freeProbePerWallet: PROBE_MAX, prices: { '/signal': PRICE_USD, '/token': PRICE_USD, '/brief': BRIEF_PRICE_USD, '/intent': INTENT_PRICE_USD }, payTo: PAY_TO, priceUsd: PRICE_USD, network: X402_NETWORK, facilitator: FACILITATOR_URL, cdpKeySet: !!(CDP_API_KEY_ID && CDP_API_KEY_SECRET) });

      if (url === '/mcp') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST JSON-RPC to /mcp' }, { allow: 'POST' });
        const m = await body(req); if (m === null) return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        const r = await dispatch(m); if (r === null) { res.writeHead(202, CORS); return res.end(); } return json(res, 200, r);
      }

      // x402-PAID full signal (3 free probe calls per wallet via ?wallet=0x…)
      if (url === '/signal') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { query: qs.get('q'), source: qs.get('source'), limit: qs.get('limit') };
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) { const { candidates, live, note } = await getCandidates(a); return json(res, 200, { ...buildSignal(candidates, opForA(a)), live, source_note: note, probe }); }
        const reqs = paymentRequired({ priceUsd: PRICE_USD, payTo: PAY_TO, resource: '/signal', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason }); // pay, then resubmit with X-PAYMENT
        const { candidates, live, note } = await getCandidates(a);
        return json(res, 200, { ...buildSignal(candidates, opForA(a)), live, source_note: note, paid: true });
      }

      // x402-PAID full token intel (3 free probe calls per wallet via ?wallet=0x…)
      if (url === '/token') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), wallet: qs.get('wallet') };
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) return json(res, 200, { ...buildTokenIntel(await getToken(a.addr)), probe });
        const reqs = paymentRequired({ priceUsd: PRICE_USD, payTo: PAY_TO, resource: '/token', description: 'xsignal - Base token market intel', network: X402_NETWORK });
        const v = await verifyPayment(req.headers["x-payment"], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        return json(res, 200, { ...buildTokenIntel(await getToken(a.addr)), paid: true });
      }

      // x402-PAID fused brief - a MEAL (market intel + social signal fused); 3 free probe calls per wallet via ?wallet=0x…
      if (url === '/brief') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), query: qs.get('q'), wallet: qs.get('wallet') };
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) { const { intel, signal, query, live, note } = await getBrief(a.addr, a.query); return json(res, 200, { ...buildBrief({ intel, signal, symbol: intel.symbol, query }), live, source_note: note, probe }); }
        const reqs = paymentRequired({ priceUsd: BRIEF_PRICE_USD, payTo: PAY_TO, resource: '/brief', description: 'xsignal - fused token brief (market intel + social signal)', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        const { intel, signal, query, live, note } = await getBrief(a.addr, a.query);
        return json(res, 200, { ...buildBrief({ intel, signal, symbol: intel.symbol, query }), live, source_note: note, paid: true });
      }

      // OUTCOME-PRICED intent -x402-PAID (from $0.01), pay-first: then a momentum verdict OR a calibrated ABSTAIN.
      // The paid fee IS the no-fill fee (no free quote → no adverse-selection farming). Paid answers carry a keyless receipt.
      if (url === '/intent') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), question: qs.get('question') || qs.get('q'), min_confidence: qs.get('min_confidence'), wallet: qs.get('wallet') };
        const minConfidence = a.min_confidence != null ? a.min_confidence : a.minConfidence;
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) { const { intel, signal, query } = await getBrief(a.addr, a.question); const payload = buildIntent({ intel, signal, question: a.question || query || null, minConfidence, price: INTENT_PRICE_USD }); const receipt = makeReceipt({ addr: a.addr, question: payload.question, minConfidence: payload.minConfidence }, payload, null); return json(res, 200, { ...payload, receipt, probe }); }
        const reqs = paymentRequired({ priceUsd: INTENT_PRICE_USD, payTo: PAY_TO, resource: '/intent', description: 'xsignal - outcome-priced momentum verdict (may abstain)', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        const { intel, signal, query } = await getBrief(a.addr, a.question);
        const inp = { intel, signal, question: a.question || query || null, minConfidence, price: INTENT_PRICE_USD };
        const payload = buildIntent(inp);
        const receipt = makeReceipt({ addr: a.addr, question: inp.question, minConfidence: payload.minConfidence }, payload, v.txHash);
        return json(res, 200, { ...payload, receipt, paid: true });
      }

      if (req.method === 'GET' && url === '/.well-known/mcp.json') return json(res, 200, { name: SERVER.name, version: SERVER.version, protocolVersion: '2024-11-05', description: 'xsignal - x402-paid data ingredients for Base agents. Flagship get_intent: an outcome-priced momentum verdict that ABSTAINS below your confidence bar (nothing else in x402 abstains). Also cited X/social signal, token market intel, a fused brief. 3 free calls per wallet, then from $0.01 USDC.', mcp: { endpoint: baseUrl(req) + '/mcp', transport: 'streamable-http' }, tools: TOOLS.map((t) => ({ name: t.name, description: t.description })), paid: { routes: ['/signal', '/token', '/brief', '/intent'], priceUsd: PRICE_USD, briefPriceUsd: BRIEF_PRICE_USD, intentPriceUsd: INTENT_PRICE_USD, asset: 'USDC', network: 'base', noFreeTier: true, freeProbePerWallet: PROBE_MAX } });
      if (req.method === 'GET' && url === '/.well-known/agent-card.json') return json(res, 200, agentCard(baseUrl(req)));

      if (req.method === 'GET' && url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...CORS }); return res.end(landing()); }
      return json(res, 404, { error: 'not found' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  });
}

const baseUrl = (req) => (req.headers['x-forwarded-proto'] || 'https') + '://' + (req.headers.host || 'localhost');
function agentCard(base) {
  return { $schema: 'https://eips.ethereum.org/EIPS/eip-8004#agent-card', name: 'xsignal', description: 'x402-paid data ingredients for Base agents. Flagship: get_intent, an outcome-priced momentum verdict that ABSTAINS below your confidence bar. 3 free calls per wallet, then from $0.01 USDC. Verify-only; never signs or moves funds.', url: base,
    mcp: { endpoint: base + '/mcp', transport: 'streamable-http' },
    skills: [
      { id: 'intent-momentum', primary: true, name: 'Outcome-priced momentum intent (abstains)', description: 'The only x402 signal that ABSTAINS below your confidence bar. Post {addr, min_confidence} → pay a flat fee, then a mechanical momentum verdict (gaining/fading) if confidence clears your bar, else a calibrated abstain. Paid answers carry a keyless tamper-evidence receipt. x402-paid at /intent (from $0.01; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/intent', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(INTENT_PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'intent', 'outcome-priced', 'abstain', 'base', 'momentum'] },
      { id: 'token-brief', name: 'Fused token brief (meal)', description: 'One call fuses Base token market intel + real-time social signal into a "what is happening with $TOKEN now" brief (market flags + cited top posts + a non-advisory summary). x402-paid at /brief ($0.05; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/brief', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(BRIEF_PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'brief', 'meal', 'base', 'token', 'signal'] },
      { id: 'real-time-signal', name: 'Real-time X/social signal', description: 'Fresh, scored (virality+freshness), cited social signal for a topic. x402-paid at /signal (from $0.01 USDC on Base; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/signal', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'signal', 'x', 'social', 'realtime', 'base'] },
      { id: 'token-market-intel', name: 'Base token market intel', description: 'Liquidity/volume/price/age/buy-sell flow + mechanical flags for a Base token (market data, NOT a trust rating). Best as an input to the brief. x402-paid at /token ($0.01; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/token', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'token', 'base', 'defi', 'market-data'] },
    ],
    payment: { protocol: 'x402', network: 'base', asset: 'USDC', payTo: PAY_TO }, safety: { descriptorOnly: true, signsFunds: false } };
}
function landing() {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>xsignal, real-time signal for agents</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecf4;margin:0;padding:40px 20px;max-width:680px;margin:0 auto;line-height:1.6}
code{background:#1a2137;padding:2px 7px;border-radius:6px;font-size:13px}.t{background:#131a2e;border:1px solid #26304d;border-radius:14px;padding:18px;margin:14px 0}
h1{font-size:26px}.px{color:#6ee7b7;font-weight:700}a{color:#7aa2ff}</style></head><body>
<h1>⚡ xsignal</h1><p>Pay-per-call data ingredients for AI agents on <span class="px">Base</span>, via x402 (USDC).
No free tier, but <b>3 free calls per wallet</b> to try, then from $${PRICE_USD}/call. Verify-only: we never hold keys or move funds.</p>
<div class="t"><b>🎯 Flagship: Intent - the signal that abstains when it isn't sure</b><br/><code>GET /intent?addr=0x…&min_confidence=0.7</code> - pay $${INTENT_PRICE_USD}, get a momentum verdict (gaining/fading) ONLY if it clears your confidence bar, else a calibrated <b>abstain</b>. The one thing no other x402 signal does. Paid answers carry a keyless receipt.</div>
<div class="t"><b>Token brief - a meal (${BRIEF_PRICE_USD} USDC)</b><br/><code>GET /brief?addr=0x…</code> - one call fuses market intel + cited social signal into a "what is happening with $TOKEN now" brief.</div>
<div class="t"><b>Signal (${PRICE_USD} USDC)</b><br/><code>GET /signal?q=base+memecoin</code> - scored + cited real-time X/social signal (text, metrics, all items).</div>
<div class="t"><b>Token intel (${PRICE_USD} USDC)</b><br/><code>GET /token?addr=0x…</code> - liquidity, volume, price, pool age, buy/sell flow + market flags (data, not a trust rating).</div>
<div class="t"><b>Try free</b> - add <code>?wallet=0xYourAddr</code> to any call for 3 free full results, then pay via x402. <b>Agents:</b> MCP at <code>/mcp</code>, discovery at <code>/.well-known/mcp.json</code> + <code>/.well-known/agent-card.json</code>.</div>
<p style="color:#8a97b5;font-size:13px">Signals are scored from public X posts + public DEX data - verify before acting; not financial advice. Confidence is a mechanical heuristic, not a prediction.</p></body></html>`;
}

module.exports = { createServer, dispatch, TOOLS };

if (require.main === module) {
  if (!process.argv.includes('--selftest')) {
    createServer().listen(process.env.PORT || 4520, () => console.log('xsignal live on :' + (process.env.PORT || 4520) + ' (4 x402-paid tools · 3 free/wallet · /mcp · /health)'));
  } else {
    const srv = createServer();
    srv.listen(0, async () => {
      const port = srv.address().port;
      const get = (p) => new Promise((rs, rj) => { http.get({ host: '127.0.0.1', port, path: p }, (s) => { let b = ''; s.on('data', c => b += c); s.on('end', () => rs({ status: s.statusCode, body: b, headers: s.headers })); }).on('error', rj); });
      const post = (p, o, h) => new Promise((rs, rj) => { const d = JSON.stringify(o); const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d), ...(h || {}) } }, (s) => { let b = ''; s.on('data', c => b += c); s.on('end', () => rs({ status: s.statusCode, body: b })); }); r.on('error', rj); r.write(d); r.end(); });

      const health = await get('/health');
      const sig402 = await get('/signal?q=base');
      const tok402 = await get('/token?addr=0x' + 'ab'.repeat(20));
      const brief402 = await get('/brief?addr=0xbad');
      const intent402 = await get('/intent?addr=0xbad&min_confidence=0.9');
      const previewGone = await get('/signal/preview?q=base');
      const mcpList = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const mcpSignal = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_signal', arguments: { query: 'base' } } });
      const mcpIntent = await post('/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_intent', arguments: { addr: '0xbad', min_confidence: 0.9 } } });
      const disc = await get('/.well-known/mcp.json');
      const card = await get('/.well-known/agent-card.json');
      const probeCall = await get('/signal?q=base&wallet=0x' + 'cd'.repeat(20));

      const checks = [
        ['GET /health → ok + paidRoutes + noFreeTier flag', health.status === 200 && JSON.parse(health.body).paidRoutes.includes('/signal') && JSON.parse(health.body).noFreeTier === true],
        ['GET /signal → 402 (x402 accepts, USDC/base) -paid-only, no free tier', sig402.status === 402 && JSON.parse(sig402.body).accepts[0].network === 'base' && JSON.parse(sig402.body).accepts[0].asset.startsWith('0x833589')],
        ['GET /token → 402 (paid-only)', tok402.status === 402],
        ['GET /brief → 402 (paid-only meal)', brief402.status === 402],
        ['GET /intent → 402 (pay-first; the fee IS the no-fill fee, no free quote)', intent402.status === 402],
        ['removed free-preview route → 404 (no free data tier)', previewGone.status === 404],
        ['MCP tools/list → 4 tools, flagship get_intent first', mcpList.status === 200 && JSON.parse(mcpList.body).result.tools.length === 4 && JSON.parse(mcpList.body).result.tools[0].name === 'get_intent' && JSON.parse(mcpList.body).result.tools.some(t => t.name === 'get_signal')],
        ['GET /signal?wallet=0x… → 200 FREE probe call (3 free per wallet)', probeCall.status === 200 && JSON.parse(probeCall.body).probe && JSON.parse(probeCall.body).probe.free === true],
        ['MCP get_signal → x402 PAYMENT POINTER (paymentRequired + accepts, NOT free data)', mcpSignal.status === 200 && JSON.parse(JSON.parse(mcpSignal.body).result.content[0].text).paymentRequired === true],
        ['MCP get_intent → x402 payment pointer (no free quote)', mcpIntent.status === 200 && JSON.parse(JSON.parse(mcpIntent.body).result.content[0].text).paymentRequired === true],
        ['GET /.well-known/mcp.json → 4 paid routes + 4 tools + noFreeTier', disc.status === 200 && JSON.parse(disc.body).paid.routes.length === 4 && JSON.parse(disc.body).tools.length === 4 && JSON.parse(disc.body).paid.noFreeTier === true],
        ['GET /.well-known/agent-card.json → ERC-8004 (x402 pricing, payTo)', card.status === 200 && JSON.parse(card.body).payment.protocol === 'x402'],
        ['paid route NEVER serves without a verified payment (no facilitator → 402)', sig402.status === 402],
      ];
      console.log('xsignal server self-test:');
      let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
      console.log(`\n${pass}/${checks.length} checks passed`);
      srv.close(); process.exit(pass === checks.length ? 0 : 1);
    });
  }
}
