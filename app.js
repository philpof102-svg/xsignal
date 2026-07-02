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
const { quoteIntent, buildIntent, previewIntent, assessMomentum } = require('./intent');
const { buildPreflight } = require('./preflight');
const { paymentRequired, verifyPayment, net } = require('./x402');
const { fetchCandidates, fetchDexScreener } = require('./sources');

const PAY_TO = process.env.XSIGNAL_PAYTO || '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9'; // receives USDC; public addr, no key
const PUBLIC_URL = (process.env.XSIGNAL_PUBLIC_URL || 'https://xsignal-production.up.railway.app').replace(/\/$/, ''); // canonical URL used as the x402 'resource' → the CDP Bazaar catalogs a callable endpoint on first settlement
const PRICE_USD = Number(process.env.XSIGNAL_PRICE_USD || 0.01);
const BRIEF_PRICE_USD = Number(process.env.XSIGNAL_BRIEF_PRICE_USD || 0.05); // the fused brief is a "meal" (does the chaining an agent would) → priced above a single ingredient
const INTENT_PRICE_USD = Number(process.env.XSIGNAL_INTENT_PRICE_USD || 0.01); // outcome-priced momentum verdict, pay-first (the fee IS the no-fill fee); FLAT price, floor $0.01
const PREFLIGHT_PRICE_USD = Number(process.env.XSIGNAL_PREFLIGHT_PRICE_USD || 0.05); // composed Base preflight (MainStreet safety + xsignal momentum)
const SCREEN_PRICE_USD = Number(process.env.XSIGNAL_SCREEN_PRICE_USD || 0.10); // batch preflight over a watchlist (up to 10 tokens)
const MAINSTREET_URL = (process.env.MAINSTREET_URL || 'https://avisradar-production.up.railway.app').replace(/\/$/, ''); // trust layer: MainStreet's public on-chain classification
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

// Live transparency for the abstaining flagship: rolling counters since restart (honest ACTIVITY, NOT a win-rate).
// Set XSIGNAL_LOG_DIR to a mounted volume to also append an immutable verdict log — the seed for a calibrated
// Brier/risk-coverage track record once realized outcomes are resolved (the one moat a bluffer cannot fake).
const LOG_DIR = process.env.XSIGNAL_LOG_DIR || '';
const stats = { since: Math.floor(Date.now() / 1000), total: 0, served: 0, abstained: 0, gaining: 0, fading: 0, conf: { lo: 0, mid: 0, hi: 0 } };
function recordVerdict(payload, addr) {
  stats.total++;
  if (payload.served) { stats.served++; if (payload.verdict === 'gaining') stats.gaining++; else if (payload.verdict === 'fading') stats.fading++; }
  else stats.abstained++;
  const c = Number(payload.confidence) || 0;
  stats.conf[c < 0.3 ? 'lo' : c < 0.6 ? 'mid' : 'hi']++;
  if (LOG_DIR) { try { const sym = payload.evidence && payload.evidence.market && payload.evidence.market.symbol; fs.appendFileSync(LOG_DIR + '/verdicts.jsonl', JSON.stringify({ t: Math.floor(Date.now() / 1000), addr, symbol: sym || null, verdict: payload.verdict, confidence: payload.confidence, served: !!payload.served, outcome: null }) + '\n'); } catch (e) { /* best-effort logging */ } }
}

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

// Trust layer: MainStreet's public on-chain token classification (SAFE/WATCH/AVOID + rug flags). Free, graceful on error.
async function getMainstreetSafety(addr) {
  try {
    const r = await fetch(MAINSTREET_URL + '/api/agent/token/' + addr + '/onchain-info');
    if (!r.ok) return { classification: 'UNKNOWN', reason: 'mainstreet HTTP ' + r.status };
    const j = await r.json();
    const oc = j.onchainInfo || j.onchain || j.conduct || j; // tolerate shape
    const pick = (k) => (oc && oc[k] != null ? oc[k] : j[k]);
    const safety = pick('safety') || {};
    const verdict = pick('verdict') || {};
    return {
      classification: pick('classification') || 'UNKNOWN',
      riskLevel: verdict.level || pick('riskLevel') || null,
      hardFail: !!safety.hardFail,
      flags: Array.isArray(safety.flags) ? safety.flags : [],
      symbol: (j.price && j.price.defiLlama && j.price.defiLlama.symbol) || null,
    };
  } catch (e) { return { classification: 'UNKNOWN', reason: 'mainstreet error: ' + (e && e.message) }; }
}

// the composed Base PREFLIGHT: MainStreet safety ⊕ xsignal momentum.
async function getPreflight(addr, query) {
  const { intel, signal } = await getBrief(addr, query);
  const momentum = assessMomentum({ intel, signal });
  const safety = await getMainstreetSafety(addr);
  return { safety, momentum, symbol: intel.symbol || safety.symbol };
}

// BATCH: run the preflight over a watchlist (up to 10) — "which of my tokens are safe AND moving right now?"
async function screenTokens(addrs) {
  const list = (Array.isArray(addrs) ? addrs : String(addrs || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
  const results = await Promise.all(list.map(async (addr) => {
    const { safety, momentum, symbol } = await getPreflight(addr);
    return buildPreflight({ safety, momentum, addr, symbol });
  }));
  const summary = { GO: 0, CAUTION: 0, AVOID: 0, AVOID_ENTRY: 0, NEUTRAL: 0, UNVERIFIED: 0 };
  results.forEach((r) => { summary[r.recommendation] = (summary[r.recommendation] || 0) + 1; });
  return { count: results.length, summary, safeMovers: results.filter((r) => r.recommendation === 'GO').map((r) => r.symbol || r.token), results, note: 'Batch preflight over your watchlist: safety (MainStreet) gates momentum (xsignal). GO = safe + gaining. Not financial advice.' };
}

const TOOLS = [
  { name: 'get_intent', description: 'FLAGSHIP. An outcome-priced momentum verdict that ABSTAINS below your confidence bar - the only x402 signal that refuses to answer (honestly) when it is not sure. Post {addr, min_confidence 0-1} then pay $0.01, and get a mechanical momentum verdict "gaining" or "fading" IF the signal agreement clears your bar, else a calibrated "abstain". Paid answers carry a keyless tamper-evidence receipt. confidence is a transparent heuristic, NOT a prediction; not financial advice. x402-paid at GET/POST /intent (3 free calls per wallet via ?wallet=0x…). Example: GET /intent?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&min_confidence=0.7', inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address to read momentum for' }, min_confidence: { type: 'number', description: '0-1; abstain (no verdict, you still pay the flat fee) if mechanical confidence is below this. Default 0.6' }, question: { type: 'string', description: 'optional free-text label / social query; defaults to the token symbol' } } } },
  { name: 'get_token_brief', description: 'A fused MEAL: one call combines Base token market intel + real-time social signal into a single "what is happening with $TOKEN right now" brief - market flags + top CITED social posts + a plain-language, non-advisory summary. Saves an agent the fetch-and-fuse work. x402-paid at GET/POST /brief ($0.05; 3 free per wallet via ?wallet=0x…). Example: GET /brief?addr=0x4ed4…&q=degen', inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' }, query: { type: 'string', description: 'optional topic/symbol for the social half; defaults to the token symbol' } } } },
  { name: 'get_signal', description: 'Real-time X/social signal for a topic: scored (virality + freshness) and CITED (source urls), deduped and ranked. Input: query (topic) OR candidates[] (bring your own posts to score). x402-paid at GET/POST /signal ($0.01; 3 free per wallet via ?wallet=0x…). Example: GET /signal?q=base+memecoin', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'the topic/keywords to get a signal for' }, candidates: { type: 'array', description: 'optional: your own posts to score instead of a live fetch' }, terms: { type: 'array', description: 'optional explicit match terms' }, source: { type: 'string', description: 'xsearch | grok (live source, if a key is set)' }, limit: { type: 'integer', description: 'max items to return (<=25)' } } } },
  { name: 'get_token_intel', description: 'Base token MARKET data (liquidity, 24h volume, price + change, pool age, buy/sell flow, mechanical flags) from public DEX pools. Market data, NOT a trust/safety rating. Best used as an input to get_token_brief. x402-paid at GET/POST /token ($0.01; 3 free per wallet via ?wallet=0x…).', inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' } } } },
  { name: 'get_preflight', description: 'The Base PREFLIGHT: one call fuses MainStreet on-chain SAFETY (SAFE/WATCH/AVOID + rug flags) with xsignal MOMENTUM (the abstaining read) into a single recommendation (GO / CAUTION / AVOID / AVOID_ENTRY / NEUTRAL / UNVERIFIED) answering "is this token safe to touch AND moving?". Safety GATES momentum - never green-lights a token that can rug. x402-paid at GET/POST /preflight ($0.05; 3 free per wallet via ?wallet=0x…). Input: addr (0x Base token). Not financial advice.', inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' } } } },
  { name: 'get_screen', description: 'BATCH watchlist screen: run the preflight (safety ⊕ momentum) over up to 10 Base tokens in one call → which are GO (safe + moving), plus a per-token verdict + a summary count. For an agent screening a watchlist. x402-paid at GET/POST /screen ($0.10; 3 free per wallet via ?wallet=0x…). Input: addrs (array or comma-separated 0x addresses). Not financial advice.', inputSchema: { type: 'object', required: ['addrs'], properties: { addrs: { type: 'array', items: { type: 'string' }, description: 'up to 10 0x Base token addresses' } } } },
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
    const PAID = { get_signal: [PUBLIC_URL + '/signal', PRICE_USD, 'xsignal - real-time X/social signal'], get_token_intel: [PUBLIC_URL + '/token', PRICE_USD, 'xsignal - Base token market intel'], get_token_brief: [PUBLIC_URL + '/brief', BRIEF_PRICE_USD, 'xsignal - fused token brief (meal)'], get_intent: [PUBLIC_URL + '/intent', INTENT_PRICE_USD, 'xsignal - outcome-priced momentum verdict (may abstain)'], get_preflight: [PUBLIC_URL + '/preflight', PREFLIGHT_PRICE_USD, 'xsignal - Base preflight (MainStreet safety + xsignal momentum)'], get_screen: [PUBLIC_URL + '/screen', SCREEN_PRICE_USD, 'xsignal - watchlist preflight screen (up to 10 tokens)'] };
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
      if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true, server: SERVER, paidRoutes: ['/signal', '/token', '/brief', '/intent', '/preflight', '/screen'], noFreeTier: true, freeProbePerWallet: PROBE_MAX, trackRecord: '/track-record', prices: { '/signal': PRICE_USD, '/token': PRICE_USD, '/brief': BRIEF_PRICE_USD, '/intent': INTENT_PRICE_USD, '/preflight': PREFLIGHT_PRICE_USD, '/screen': SCREEN_PRICE_USD }, payTo: PAY_TO, priceUsd: PRICE_USD, network: X402_NETWORK, facilitator: FACILITATOR_URL, cdpKeySet: !!(CDP_API_KEY_ID && CDP_API_KEY_SECRET) });

      if (req.method === 'GET' && url === '/track-record') return json(res, 200, {
        note: 'Live transparency for the abstaining flagship (get_intent): descriptive activity since restart, NOT a win-rate. Calibration (Brier score + reliability diagram) requires realized forward outcomes — on the roadmap once verdicts accrue on a persistent volume.',
        since: stats.since, total: stats.total, served: stats.served, abstained: stats.abstained,
        abstentionRate: stats.total ? Math.round((stats.abstained / stats.total) * 100) / 100 : null,
        coverage: stats.total ? Math.round((stats.served / stats.total) * 100) / 100 : null,
        verdicts: { gaining: stats.gaining, fading: stats.fading }, confidence: stats.conf, durableLog: !!LOG_DIR,
      });

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
        const reqs = paymentRequired({ priceUsd: PRICE_USD, payTo: PAY_TO, resource: PUBLIC_URL + '/signal', network: X402_NETWORK });
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
        const reqs = paymentRequired({ priceUsd: PRICE_USD, payTo: PAY_TO, resource: PUBLIC_URL + '/token', description: 'xsignal - Base token market intel', network: X402_NETWORK });
        const v = await verifyPayment(req.headers["x-payment"], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        return json(res, 200, { ...buildTokenIntel(await getToken(a.addr)), paid: true });
      }

      // x402-PAID fused brief - a MEAL (market intel + social signal fused); 3 free probe calls per wallet via ?wallet=0x…
      if (url === '/brief') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), query: qs.get('q'), wallet: qs.get('wallet') };
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) { const { intel, signal, query, live, note } = await getBrief(a.addr, a.query); return json(res, 200, { ...buildBrief({ intel, signal, symbol: intel.symbol, query }), live, source_note: note, probe }); }
        const reqs = paymentRequired({ priceUsd: BRIEF_PRICE_USD, payTo: PAY_TO, resource: PUBLIC_URL + '/brief', description: 'xsignal - fused token brief (market intel + social signal)', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        const { intel, signal, query, live, note } = await getBrief(a.addr, a.query);
        return json(res, 200, { ...buildBrief({ intel, signal, symbol: intel.symbol, query }), live, source_note: note, paid: true });
      }

      // COMPOSED Base preflight - MainStreet SAFETY ⊕ xsignal MOMENTUM (safety gates momentum); 3 free per wallet via ?wallet=0x…
      if (url === '/preflight') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), query: qs.get('q'), wallet: qs.get('wallet') };
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) { const { safety, momentum, symbol } = await getPreflight(a.addr, a.query); return json(res, 200, { ...buildPreflight({ safety, momentum, addr: a.addr, symbol }), probe }); }
        const reqs = paymentRequired({ priceUsd: PREFLIGHT_PRICE_USD, payTo: PAY_TO, resource: PUBLIC_URL + '/preflight', description: 'xsignal - Base preflight (safety + momentum)', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        const { safety, momentum, symbol } = await getPreflight(a.addr, a.query);
        return json(res, 200, { ...buildPreflight({ safety, momentum, addr: a.addr, symbol }), paid: true });
      }

      // BATCH watchlist screen - preflight over up to 10 Base tokens; 3 free per wallet via ?wallet=0x…
      if (url === '/screen') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addrs: qs.get('addrs'), wallet: qs.get('wallet') };
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) return json(res, 200, { ...(await screenTokens(a.addrs)), probe });
        const reqs = paymentRequired({ priceUsd: SCREEN_PRICE_USD, payTo: PAY_TO, resource: PUBLIC_URL + '/screen', description: 'xsignal - watchlist preflight screen', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        return json(res, 200, { ...(await screenTokens(a.addrs)), paid: true });
      }

      // OUTCOME-PRICED intent -x402-PAID (from $0.01), pay-first: then a momentum verdict OR a calibrated ABSTAIN.
      // The paid fee IS the no-fill fee (no free quote → no adverse-selection farming). Paid answers carry a keyless receipt.
      if (url === '/intent') {
        const a = req.method === 'POST' ? (await body(req) || {}) : { addr: qs.get('addr'), question: qs.get('question') || qs.get('q'), min_confidence: qs.get('min_confidence'), wallet: qs.get('wallet') };
        const minConfidence = a.min_confidence != null ? a.min_confidence : a.minConfidence;
        const probe = grantProbe(a.wallet || qs.get('wallet'));
        if (probe) { const { intel, signal, query } = await getBrief(a.addr, a.question); const payload = buildIntent({ intel, signal, question: a.question || query || null, minConfidence, price: INTENT_PRICE_USD }); const receipt = makeReceipt({ addr: a.addr, question: payload.question, minConfidence: payload.minConfidence }, payload, null); recordVerdict(payload, a.addr); return json(res, 200, { ...payload, receipt, probe }); }
        const reqs = paymentRequired({ priceUsd: INTENT_PRICE_USD, payTo: PAY_TO, resource: PUBLIC_URL + '/intent', description: 'xsignal - outcome-priced momentum verdict (may abstain)', network: X402_NETWORK });
        const v = await verifyPayment(req.headers['x-payment'], { facilitatorUrl: FACILITATOR_URL, cdpKeyId: CDP_API_KEY_ID, cdpKeySecret: CDP_API_KEY_SECRET, requirements: reqs.accepts[0] });
        if (!v.ok) return json(res, 402, { ...reqs, verify: v.reason });
        const { intel, signal, query } = await getBrief(a.addr, a.question);
        const inp = { intel, signal, question: a.question || query || null, minConfidence, price: INTENT_PRICE_USD };
        const payload = buildIntent(inp);
        recordVerdict(payload, a.addr);
        const receipt = makeReceipt({ addr: a.addr, question: inp.question, minConfidence: payload.minConfidence }, payload, v.txHash);
        return json(res, 200, { ...payload, receipt, paid: true });
      }

      if (req.method === 'GET' && url === '/.well-known/mcp.json') return json(res, 200, { name: SERVER.name, version: SERVER.version, protocolVersion: '2024-11-05', description: 'xsignal - x402-paid data ingredients for Base agents. Flagship get_intent: an outcome-priced momentum verdict that ABSTAINS below your confidence bar (nothing else in x402 abstains). Also cited X/social signal, token market intel, a fused brief. 3 free calls per wallet, then from $0.01 USDC.', mcp: { endpoint: baseUrl(req) + '/mcp', transport: 'streamable-http' }, tools: TOOLS.map((t) => ({ name: t.name, description: t.description })), paid: { routes: ['/signal', '/token', '/brief', '/intent', '/preflight', '/screen'], priceUsd: PRICE_USD, briefPriceUsd: BRIEF_PRICE_USD, intentPriceUsd: INTENT_PRICE_USD, preflightPriceUsd: PREFLIGHT_PRICE_USD, screenPriceUsd: SCREEN_PRICE_USD, asset: 'USDC', network: 'base', noFreeTier: true, freeProbePerWallet: PROBE_MAX } });
      if (req.method === 'GET' && url === '/.well-known/agent-card.json') return json(res, 200, agentCard(baseUrl(req)));

      if (req.method === 'GET' && url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...CORS }); return res.end(landing()); }
      if (req.method === 'GET' && url === '/pay') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...CORS }); return res.end(payPage()); }
      return json(res, 404, { error: 'not found' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  });
}

const baseUrl = (req) => (req.headers['x-forwarded-proto'] || 'https') + '://' + (req.headers.host || 'localhost');
function agentCard(base) {
  return { $schema: 'https://eips.ethereum.org/EIPS/eip-8004#agent-card', name: 'xsignal', description: 'x402-paid data ingredients for Base agents. Flagship: get_intent, an outcome-priced momentum verdict that ABSTAINS below your confidence bar. 3 free calls per wallet, then from $0.01 USDC. Verify-only; never signs or moves funds.', url: base,
    mcp: { endpoint: base + '/mcp', transport: 'streamable-http' },
    skills: [
      { id: 'base-preflight', primary: true, name: 'Base token preflight (safety + momentum)', description: 'One call fuses MainStreet on-chain SAFETY (SAFE/WATCH/AVOID + rug flags) with xsignal MOMENTUM into a single recommendation (GO / CAUTION / AVOID / NEUTRAL) - is this token safe to touch AND moving? Safety gates momentum. x402-paid at /preflight ($0.05; 3 free per wallet via ?wallet=0x…). Not financial advice.', endpoint: base + '/preflight', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(PREFLIGHT_PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'preflight', 'safety', 'momentum', 'base', 'rug-check'] },
      { id: 'intent-momentum', name: 'Outcome-priced momentum intent (abstains)', description: 'The only x402 signal that ABSTAINS below your confidence bar. Post {addr, min_confidence} → pay a flat fee, then a mechanical momentum verdict (gaining/fading) if confidence clears your bar, else a calibrated abstain. Paid answers carry a keyless tamper-evidence receipt. x402-paid at /intent (from $0.01; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/intent', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(INTENT_PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'intent', 'outcome-priced', 'abstain', 'base', 'momentum'] },
      { id: 'token-brief', name: 'Fused token brief (meal)', description: 'One call fuses Base token market intel + real-time social signal into a "what is happening with $TOKEN now" brief (market flags + cited top posts + a non-advisory summary). x402-paid at /brief ($0.05; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/brief', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(BRIEF_PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'brief', 'meal', 'base', 'token', 'signal'] },
      { id: 'real-time-signal', name: 'Real-time X/social signal', description: 'Fresh, scored (virality+freshness), cited social signal for a topic. x402-paid at /signal (from $0.01 USDC on Base; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/signal', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'signal', 'x', 'social', 'realtime', 'base'] },
      { id: 'token-market-intel', name: 'Base token market intel', description: 'Liquidity/volume/price/age/buy-sell flow + mechanical flags for a Base token (market data, NOT a trust rating). Best as an input to the brief. x402-paid at /token ($0.01; 3 free per wallet via ?wallet=0x…).', endpoint: base + '/token', method: 'GET', pricing: { scheme: 'x402-exact', amount: String(PRICE_USD), currency: 'USDC', network: 'eip155:8453' }, tags: ['x402', 'token', 'base', 'defi', 'market-data'] },
    ],
    payment: { protocol: 'x402', network: 'base', asset: 'USDC', payTo: PAY_TO }, safety: { descriptorOnly: true, signsFunds: false } };
}
// /pay — pay any xsignal x402 endpoint from a browser wallet (MetaMask / Coinbase ext).
// The page NEVER sees a private key: it builds the EIP-3009 TransferWithAuthorization
// typed data FROM the live 402 challenge (domain name/version, payTo, amount all come
// from accepts[0]) and asks the injected wallet to sign; settlement stays server-side
// via the CDP facilitator on the paid re-fetch. Same-origin → no CORS friction.
function payPage() {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>xsignal · pay from your browser</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecf4;margin:0;padding:40px 20px;max-width:680px;margin:0 auto;line-height:1.6}
h1{font-size:24px}.px{color:#6ee7b7;font-weight:700}a{color:#7aa2ff}
input,select{width:100%;box-sizing:border-box;background:#131a2e;border:1px solid #26304d;border-radius:10px;color:#e8ecf4;padding:10px;font-size:14px;margin:6px 0}
button{background:#2f6bff;border:0;border-radius:10px;color:#fff;font-weight:700;padding:12px 18px;font-size:15px;cursor:pointer;margin:8px 0}button:disabled{opacity:.5}
pre{background:#131a2e;border:1px solid #26304d;border-radius:10px;padding:12px;font-size:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.s{color:#93a2c8;font-size:13px}</style></head><body>
<h1>⚡ xsignal — <span class="px">pay from your browser</span></h1>
<p class="s">Pick a tool, connect a wallet holding USDC on Base, sign one gasless authorization (EIP-3009 — no ETH needed). Your key never leaves your wallet; this page only builds the request from the live 402 challenge. Don't pay from the payTo wallet itself. Not financial advice.</p>
<select id="ep">
<option value="/preflight?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed">get_preflight — safety ⊕ momentum ($0.05)</option>
<option value="/intent?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed">get_intent — abstaining momentum ($0.01)</option>
<option value="/brief?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed">get_token_brief — fused brief ($0.05)</option>
</select>
<input id="custom" placeholder="…or a custom path, e.g. /preflight?addr=0xYourToken"/>
<button id="go">Connect wallet &amp; pay</button>
<div id="log" class="s"></div><pre id="out" style="display:none"></pre>
<script>
const log=(m)=>{document.getElementById('log').innerHTML+='<div>'+m+'</div>'};
const hex=(b)=>'0x'+[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
document.getElementById('go').onclick=async()=>{
 const out=document.getElementById('out');out.style.display='none';document.getElementById('log').innerHTML='';
 try{
  const eth=window.ethereum; if(!eth){log('❌ No browser wallet found. Install MetaMask or Coinbase Wallet extension.');return;}
  const path=(document.getElementById('custom').value.trim()||document.getElementById('ep').value);
  const [from]=await eth.request({method:'eth_requestAccounts'});
  log('wallet: '+from);
  try{await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x2105'}]});}catch(e){log('⚠️ switch to Base refused: '+(e.message||e));}
  const r0=await fetch(path); if(r0.status!==402){out.style.display='block';out.textContent=await r0.text();log(r0.ok?'✅ served without payment (free probe?)':'unexpected status '+r0.status);return;}
  const ch=await r0.json(); const a=(ch.accepts||[])[0]; if(!a){log('❌ malformed 402 (no accepts)');return;}
  log('402: pay '+(Number(a.maxAmountRequired)/1e6)+' USDC → '+a.payTo.slice(0,8)+'… on '+a.network);
  const nonce=hex(crypto.getRandomValues(new Uint8Array(32)));
  const now=Math.floor(Date.now()/1e3);
  const auth={from,to:a.payTo,value:String(a.maxAmountRequired),validAfter:String(now-600),validBefore:String(now+(a.maxTimeoutSeconds||60)),nonce};
  const typed={types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},primaryType:'TransferWithAuthorization',domain:{name:(a.extra&&a.extra.name)||'USDC',version:(a.extra&&a.extra.version)||'2',chainId:8453,verifyingContract:a.asset},message:auth};
  log('signing in your wallet…');
  const signature=await eth.request({method:'eth_signTypedData_v4',params:[from,JSON.stringify(typed)]});
  const xp=btoa(JSON.stringify({x402Version:1,scheme:a.scheme,network:a.network,payload:{signature,authorization:auth}}));
  log('paying + fetching…');
  const r1=await fetch(path,{headers:{'X-PAYMENT':xp}});
  const body=await r1.text(); out.style.display='block'; out.textContent=body;
  const pr=r1.headers.get('x-payment-response');
  if(r1.status===200){log('✅ PAID + SERVED (HTTP 200).'+(pr?' settlement: '+pr:''));}
  else{log('❌ HTTP '+r1.status+' — payment did not settle (check USDC balance on Base / wallet is an EOA).');}
 }catch(e){log('❌ '+(e&&e.message||e));}
};
</script></body></html>`;
}
function landing() {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>xsignal, real-time signal for agents</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecf4;margin:0;padding:40px 20px;max-width:680px;margin:0 auto;line-height:1.6}
code{background:#1a2137;padding:2px 7px;border-radius:6px;font-size:13px}.t{background:#131a2e;border:1px solid #26304d;border-radius:14px;padding:18px;margin:14px 0}
h1{font-size:26px}.px{color:#6ee7b7;font-weight:700}a{color:#7aa2ff}</style></head><body>
<h1>⚡ xsignal</h1><p>Pay-per-call data ingredients for AI agents on <span class="px">Base</span>, via x402 (USDC).
No free tier, but <b>3 free calls per wallet</b> to try, then from $${PRICE_USD}/call. Verify-only: we never hold keys or move funds.</p>
<div class="t"><b>🎯 Preflight - is this token safe to touch AND moving?</b><br/><code>GET /preflight?addr=0x…</code> - $${PREFLIGHT_PRICE_USD}. Fuses on-chain <b>safety</b> (SAFE/WATCH/AVOID + rug flags, via MainStreet) with <b>momentum</b> into one verdict: <b>GO / CAUTION / AVOID</b>. Safety gates momentum, so it never green-lights a token that can rug.</div>
<div class="t"><b>Intent - the signal that abstains when it isn't sure</b><br/><code>GET /intent?addr=0x…&min_confidence=0.7</code> - pay $${INTENT_PRICE_USD}, get a momentum verdict (gaining/fading) ONLY if it clears your confidence bar, else a calibrated <b>abstain</b>. The one thing no other x402 signal does. Paid answers carry a keyless receipt.</div>
<div class="t"><b>Token brief - a meal (${BRIEF_PRICE_USD} USDC)</b><br/><code>GET /brief?addr=0x…</code> - one call fuses market intel + cited social signal into a "what is happening with $TOKEN now" brief.</div>
<div class="t"><b>Signal (${PRICE_USD} USDC)</b><br/><code>GET /signal?q=base+memecoin</code> - scored + cited real-time X/social signal (text, metrics, all items).</div>
<div class="t"><b>Token intel (${PRICE_USD} USDC)</b><br/><code>GET /token?addr=0x…</code> - liquidity, volume, price, pool age, buy/sell flow + market flags (data, not a trust rating).</div>
<div class="t"><b>Try free</b> - add <code>?wallet=0xYourAddr</code> to any call for 3 free full results, then pay via x402. <b>Agents:</b> MCP at <code>/mcp</code>, discovery at <code>/.well-known/mcp.json</code> + <code>/.well-known/agent-card.json</code>.</div>
<div class="t"><b>Transparency</b> - live abstention rate + coverage at <code>/track-record</code> (how often it stays quiet; honest activity, not a win-rate).</div>
<p style="color:#8a97b5;font-size:13px">Signals are scored from public X posts + public DEX data - verify before acting; not financial advice. Confidence is a mechanical heuristic, not a prediction.</p></body></html>`;
}

module.exports = { createServer, dispatch, TOOLS };

if (require.main === module) {
  if (!process.argv.includes('--selftest')) {
    createServer().listen(process.env.PORT || 4520, () => console.log('xsignal live on :' + (process.env.PORT || 4520) + ' (5 x402-paid tools incl /preflight · 3 free/wallet · /mcp · /health)'));
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
      const probeIntent = await get('/intent?addr=0xbad&min_confidence=0.9&wallet=0x' + 'ab'.repeat(20));
      const trackRec = await get('/track-record');
      const preflight402 = await get('/preflight?addr=0xbad');
      const mcpPreflight = await post('/mcp', { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_preflight', arguments: { addr: '0xbad' } } });
      const screen402 = await get('/screen?addrs=0xbad');
      const mcpScreen = await post('/mcp', { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_screen', arguments: { addrs: ['0xbad'] } } });

      const checks = [
        ['GET /health → ok + paidRoutes + noFreeTier flag', health.status === 200 && JSON.parse(health.body).paidRoutes.includes('/signal') && JSON.parse(health.body).noFreeTier === true],
        ['GET /signal → 402 (x402 accepts, USDC/base) -paid-only, no free tier', sig402.status === 402 && JSON.parse(sig402.body).accepts[0].network === 'base' && JSON.parse(sig402.body).accepts[0].asset.startsWith('0x833589')],
        ['GET /token → 402 (paid-only)', tok402.status === 402],
        ['GET /brief → 402 (paid-only meal)', brief402.status === 402],
        ['GET /intent → 402 (pay-first; the fee IS the no-fill fee, no free quote)', intent402.status === 402],
        ['removed free-preview route → 404 (no free data tier)', previewGone.status === 404],
        ['MCP tools/list → 6 tools, flagship get_intent first', mcpList.status === 200 && JSON.parse(mcpList.body).result.tools.length === 6 && JSON.parse(mcpList.body).result.tools[0].name === 'get_intent' && JSON.parse(mcpList.body).result.tools.some(t => t.name === 'get_screen')],
        ['GET /signal?wallet=0x… → 200 FREE probe call (3 free per wallet)', probeCall.status === 200 && JSON.parse(probeCall.body).probe && JSON.parse(probeCall.body).probe.free === true],
        ['GET /track-record → 200 live abstention transparency (reflects the intent call)', trackRec.status === 200 && JSON.parse(trackRec.body).total >= 1 && JSON.parse(trackRec.body).abstentionRate !== null],
        ['MCP get_signal → x402 PAYMENT POINTER (paymentRequired + accepts, NOT free data)', mcpSignal.status === 200 && JSON.parse(JSON.parse(mcpSignal.body).result.content[0].text).paymentRequired === true],
        ['MCP get_intent → x402 payment pointer (no free quote)', mcpIntent.status === 200 && JSON.parse(JSON.parse(mcpIntent.body).result.content[0].text).paymentRequired === true],
        ['GET /preflight → 402 (composed Base preflight, paid-only)', preflight402.status === 402],
        ['MCP get_preflight → x402 payment pointer', mcpPreflight.status === 200 && JSON.parse(JSON.parse(mcpPreflight.body).result.content[0].text).paymentRequired === true],
        ['GET /screen → 402 (batch watchlist screen, paid-only)', screen402.status === 402],
        ['MCP get_screen → x402 payment pointer', mcpScreen.status === 200 && JSON.parse(JSON.parse(mcpScreen.body).result.content[0].text).paymentRequired === true],
        ['GET /.well-known/mcp.json → 6 paid routes + 6 tools + noFreeTier', disc.status === 200 && JSON.parse(disc.body).paid.routes.length === 6 && JSON.parse(disc.body).tools.length === 6 && JSON.parse(disc.body).paid.noFreeTier === true],
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
