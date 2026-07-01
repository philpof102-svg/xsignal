'use strict';
/**
 * xsignal SDK — a tiny client for the hosted x402 data ingredients on Base.
 *
 *   const xsignal = require('@rakshasar/xsignal');
 *   const x = xsignal.client({ wallet: '0xYourAddr' });   // wallet → 3 free calls, then x402
 *   const verdict = await x.intent('0x4ed4…', { minConfidence: 0.7 });
 *
 * Every method returns the parsed JSON (a served verdict, an abstain, or an x402 pay pointer with `.paymentRequired`).
 * `fetch` and `origin` are injectable for tests. Flagship: intent() = the abstaining momentum verdict.
 */
const ORIGIN = (process.env.XSIGNAL_ORIGIN || 'https://xsignal-production.up.railway.app').replace(/\/$/, '');

function client(opts = {}) {
  const base = (opts.origin || ORIGIN).replace(/\/$/, '');
  const wallet = opts.wallet || process.env.XSIGNAL_WALLET || '';
  const f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  const w = wallet ? '&wallet=' + wallet : '';
  async function call(path) {
    if (!f) throw new Error('no fetch available (Node 18+ or pass opts.fetch)');
    const r = await f(base + path);
    const j = await r.json().catch(() => ({}));
    return r.status === 402 ? { paymentRequired: true, ...j } : j;
  }
  return {
    /** FLAGSHIP: momentum verdict that abstains below minConfidence. */
    intent: (addr, o = {}) => call(`/intent?addr=${addr}&min_confidence=${o.minConfidence != null ? o.minConfidence : 0.6}` + w),
    /** fused brief (market intel + social signal). */
    brief: (addr, o = {}) => call(`/brief?addr=${addr}` + (o.query ? `&q=${encodeURIComponent(o.query)}` : '') + w),
    /** scored + cited real-time X/social signal for a topic. */
    signal: (query, o = {}) => call(`/signal?q=${encodeURIComponent(query || '')}` + w),
    /** Base token market data from public DEX pools. */
    tokenIntel: (addr) => call(`/token?addr=${addr}` + w),
    /** live abstention transparency (not a win-rate). */
    trackRecord: () => call('/track-record'),
    origin: base, wallet,
  };
}

module.exports = { client, ORIGIN };
module.exports.default = module.exports;
