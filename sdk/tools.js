'use strict';
/**
 * xsignal SDK — LLM tool definitions. One import, plug into any framework:
 *   OpenAI / Anthropic / Vercel AI SDK / LangChain / Mastra.
 *
 *   import { vercelAiSdk } from '@rakshasar/xsignal/tools';
 *   const result = await generateText({ model, tools: vercelAiSdk({ wallet: '0xYourAddr' }) });
 *
 * Each tool's execute() calls the hosted xsignal endpoint (3 free calls per wallet, then an x402 pay pointer)
 * and returns plain JSON the LLM ingests directly. Flagship: get_intent = the abstaining momentum verdict.
 */
const { client } = require('./index.js');

const intentSpec = {
  name: 'get_intent',
  description: 'FLAGSHIP. An outcome-priced Base-token momentum verdict that ABSTAINS below your confidence bar - the only x402 signal that refuses to answer (honestly) when it is not sure. Returns gaining/fading if confidence clears min_confidence, else abstain. Confidence is a transparent heuristic, not a prediction; not financial advice.',
  parameters: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' }, min_confidence: { type: 'number', description: '0-1, default 0.6; abstain below this', minimum: 0, maximum: 1 } } },
  execute: (a) => client().intent(a.addr, { minConfidence: a.min_confidence }),
};
const briefSpec = {
  name: 'get_token_brief',
  description: 'A fused MEAL: Base token market intel + real-time social signal in one "what is happening with $TOKEN now" brief (market flags + cited top posts + a non-advisory summary).',
  parameters: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' }, query: { type: 'string', description: 'optional topic/symbol for the social half' } } },
  execute: (a) => client().brief(a.addr, { query: a.query }),
};
const signalSpec = {
  name: 'get_signal',
  description: 'Real-time X/social signal for a topic: scored (virality + freshness) and CITED (source urls), deduped and ranked.',
  parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'topic/keywords' } } },
  execute: (a) => client().signal(a.query),
};
const tokenIntelSpec = {
  name: 'get_token_intel',
  description: 'Base token market data (liquidity, 24h volume, price + change, pool age, buy/sell flow, mechanical flags) from public DEX pools. Market data, NOT a trust rating. Best as an input to get_token_brief.',
  parameters: { type: 'object', required: ['addr'], properties: { addr: { type: 'string', description: '0x Base token address' } } },
  execute: (a) => client().tokenIntel(a.addr),
};

const ALL = [intentSpec, briefSpec, signalSpec, tokenIntelSpec];

// Build tool objects whose execute() is bound to a client with per-call opts ({ wallet, origin, fetch }).
function withOpts(opts = {}) {
  const c = client(opts);
  const call = { get_intent: (a) => c.intent(a.addr, { minConfidence: a.min_confidence }), get_token_brief: (a) => c.brief(a.addr, { query: a.query }), get_signal: (a) => c.signal(a.query), get_token_intel: (a) => c.tokenIntel(a.addr) };
  return ALL.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, execute: call[t.name] }));
}

/** OpenAI function-calling shape. */
function openai() { return ALL.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })); }
/** Anthropic Claude tools shape. */
function anthropic() { return ALL.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })); }
/** Vercel AI SDK tools object (keyed by name, with execute bound to your wallet/origin). */
function vercelAiSdk(opts = {}) { const out = {}; for (const t of withOpts(opts)) out[t.name] = { description: t.description, parameters: t.parameters, execute: t.execute }; return out; }
/** LangChain DynamicStructuredTool plain-object shape. Wrap with `new DynamicStructuredTool(...)`. */
function langchain(opts = {}) { return withOpts(opts).map((t) => ({ name: t.name, description: t.description, schema: t.parameters, func: t.execute })); }
/** Mastra createTool() compatible spec. */
function mastra(opts = {}) { return withOpts(opts).map((t) => ({ id: t.name, description: t.description, inputSchema: t.parameters, execute: ({ context }) => t.execute(context) })); }
/** Generic JSON Schema dump. */
function specs() { return ALL.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })); }
/** Direct execute by tool name (opts: { wallet, origin, fetch }). */
async function execute(name, args, opts = {}) { const t = withOpts(opts).find((x) => x.name === name); if (!t) throw new Error('unknown xsignal tool: ' + name); return t.execute(args || {}); }

module.exports = { openai, anthropic, vercelAiSdk, langchain, mastra, specs, execute, intentSpec, briefSpec, signalSpec, tokenIntelSpec };
module.exports.default = module.exports;
