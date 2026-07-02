#!/usr/bin/env node
/**
 * xsignal MCP server (stdio transport).
 *
 * Exposes xsignal's pay-per-call data ingredients as a Model Context Protocol server so any
 * Claude Desktop / Claude Code / Cursor / agent SDK that speaks MCP can attach it as a tool.
 * Flagship: get_intent — the only x402 signal that ABSTAINS below your confidence bar.
 *
 * Install (Claude Desktop / Cursor mcp config):
 *   {
 *     "mcpServers": {
 *       "xsignal": {
 *         "command": "npx",
 *         "args": ["-y", "@rakshasar/xsignal", "xsignal-mcp"],
 *         "env": { "XSIGNAL_WALLET": "0xYourAddress" }
 *       }
 *     }
 *   }
 *
 * Set XSIGNAL_WALLET for 3 free calls per wallet; beyond that the tools return an x402 pay pointer.
 * No deps beyond Node 18+ (native JSON-RPC over stdio; global fetch).
 */
const ORIGIN = (process.env.XSIGNAL_ORIGIN || 'https://xsignal-production.up.railway.app').replace(/\/$/, '');
const WALLET = process.env.XSIGNAL_WALLET || '';
const SERVER_NAME = 'xsignal';
const SERVER_VERSION = require('../package.json').version;
const w = () => (WALLET ? '&wallet=' + WALLET : '');

const TOOLS = [
  {
    name: 'get_intent',
    description: 'FLAGSHIP. An outcome-priced Base-token momentum verdict that ABSTAINS below your confidence bar - the only x402 signal that refuses to answer (honestly) when it is not sure, instead of always guessing. Returns "gaining"/"fading" if confidence clears min_confidence, else "abstain". Confidence is a transparent heuristic, not a prediction; not financial advice.',
    inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' }, min_confidence: { type: 'number', description: '0-1, default 0.6; abstain below this' } } },
  },
  {
    name: 'get_token_brief',
    description: 'A fused MEAL: Base token market intel + real-time social signal in one "what is happening with $TOKEN now" brief (market flags + cited top posts + a non-advisory summary).',
    inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' }, query: { type: 'string', description: 'optional topic/symbol for the social half' } } },
  },
  {
    name: 'get_signal',
    description: 'Real-time X/social signal for a topic: scored (virality + freshness) and CITED (source urls), deduped and ranked.',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'topic/keywords' } } },
  },
  {
    name: 'get_token_intel',
    description: 'Base token market data (liquidity, 24h volume, price + change, pool age, buy/sell flow, mechanical flags) from public DEX pools. Market data, NOT a trust rating.',
    inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' } } },
  },
  {
    name: 'get_preflight',
    description: 'The Base PREFLIGHT: one call fuses MainStreet on-chain SAFETY (SAFE/WATCH/AVOID + rug flags) with xsignal MOMENTUM (the abstaining read) into a single recommendation (GO/CAUTION/AVOID/AVOID_ENTRY/NEUTRAL/UNVERIFIED) answering "is this token safe to touch AND moving?". Safety GATES momentum. Not financial advice.',
    inputSchema: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' } } },
  },
  {
    name: 'get_screen',
    description: 'Batch watchlist preflight: the safety⊕momentum preflight over up to 10 Base tokens in one call — per-token verdicts + summary counts + the safeMovers (GO) list. Not financial advice.',
    inputSchema: { type: 'object', required: ['addrs'], properties: { addrs: { type: 'string', description: 'comma-separated 0x Base token addresses (max 10)' } } },
  },
  {
    name: 'get_track_record',
    description: 'Live transparency for the abstaining flagship: abstention rate + coverage since restart (descriptive activity, not a win-rate).',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callApi(path) {
  const r = await fetch(ORIGIN + path);
  const j = await r.json().catch(() => ({}));
  if (r.status === 402) return { paymentRequired: true, ...j, hint: WALLET ? 'Free probe used up for this wallet - pay via x402 (x402-fetch/axios) to continue.' : 'Set XSIGNAL_WALLET env for 3 free calls per wallet, or pay via x402.' };
  return j;
}

async function execTool(name, a) {
  switch (name) {
    case 'get_intent': return callApi(`/intent?addr=${a.addr}&min_confidence=${a.min_confidence != null ? a.min_confidence : 0.6}` + w());
    case 'get_token_brief': return callApi(`/brief?addr=${a.addr}` + (a.query ? `&q=${encodeURIComponent(a.query)}` : '') + w());
    case 'get_signal': return callApi(`/signal?q=${encodeURIComponent(a.query || '')}` + w());
    case 'get_token_intel': return callApi(`/token?addr=${a.addr}` + w());
    case 'get_preflight': return callApi(`/preflight?addr=${a.addr}` + w());
    case 'get_screen': return callApi(`/screen?addrs=${encodeURIComponent(a.addrs || '')}` + w());
    case 'get_track_record': return callApi('/track-record');
    default: throw new Error('unknown tool: ' + name);
  }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

// Minimal JSON-RPC 2.0 over stdio (MCP spec)
async function handle(req) {
  const { id, method, params } = req;
  try {
    if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    if (method === 'tools/call') { const result = await execTool(params.name, params.arguments || {}); return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }; }
    if (method === 'notifications/initialized') return null;
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } };
  } catch (e) { return { jsonrpc: '2.0', id, error: { code: -32000, message: e.message } }; }
}

let buffer = '';
process.stdin.on('data', async (chunk) => {
  buffer += chunk.toString('utf8');
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let req; try { req = JSON.parse(line); } catch { continue; }
    const resp = await handle(req);
    if (resp) send(resp);
  }
});
process.stderr.write(`[xsignal MCP] ready, ${TOOLS.length} tools, origin=${ORIGIN}${WALLET ? ', probe wallet set' : ' (no XSIGNAL_WALLET - tools return pay pointers)'}\n`);
