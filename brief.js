'use strict';
/**
 * xsignal — brief.js  (a MEAL: fuse token MARKET intel + real-time SIGNAL into one paid call)
 * ==========================================================================================
 * The @base "What Are Agents Paying For?" thesis: agents don't just buy INGREDIENTS, they buy MEALS —
 * "the reusable workflow becomes the thing worth paying for." A brief fuses get_token_intel + get_signal into
 * one "what's going on with $TOKEN right now" call: market flags + top CITED social posts + a plain-language,
 * NON-advisory summary. Pure fusion here (both inputs injected) → testable + dependency-free. WE never sign.
 * Priced above a single ingredient (it does the work an agent would otherwise chain itself). `node brief.js` tests it.
 */
const fmtUsd = (n) => { n = Number(n) || 0; return n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'k' : '$' + Math.round(n); };

function marketLine(intel) {
  if (!intel || intel.found === false) return 'no DEX pool on Base (illiquid, not launched, or data unavailable)';
  const chg = intel.priceChange24 == null ? '' : ', ' + (intel.priceChange24 >= 0 ? '+' : '') + intel.priceChange24 + '% 24h';
  const fl = intel.flags && intel.flags.length ? ', flags: ' + intel.flags.join('/') : '';
  return fmtUsd(intel.liquidityUsd) + ' liquidity' + chg + fl;
}
function socialLine(signal) {
  if (!signal || !signal.count) return 'no notable social signal right now';
  return signal.count + ' scored post' + (signal.count === 1 ? '' : 's') + ' (top score ' + signal.topScore + ')';
}

/** Fuse an already-built token intel + signal into one brief. Inputs injected → pure + testable. */
function buildBrief(inp = {}, opts = {}) {
  const intel = inp.intel || { found: false, flags: ['no-pool'] };
  const signal = inp.signal || { count: 0, topScore: 0, items: [] };
  const symbol = inp.symbol || intel.symbol || null;
  const query = inp.query || symbol || null;
  const top = (signal.items || []).slice(0, 3).map((i) => ({ text: i.text, author: i.author, url: i.url, score: i.score }));
  const summary = (symbol ? '$' + symbol : (intel.addr || 'token')) + ' — market: ' + marketLine(intel) + '. Social: ' + socialLine(signal) + '.';
  return {
    token: intel.addr || null, symbol, query,
    market: intel.found === false ? { found: false, flags: intel.flags || ['no-pool'] } : {
      found: true, priceUsd: intel.priceUsd, liquidityUsd: intel.liquidityUsd, priceChange24: intel.priceChange24,
      ageHours: intel.ageHours, buySellRatio: intel.buySellRatio, flags: intel.flags || [], url: intel.url || null,
    },
    social: { query, count: signal.count || 0, topScore: signal.topScore || 0, top },
    summary,
    note: 'A fused brief (public DEX market data + public social posts). Both are inputs, not decisions — verify before acting; not financial advice. xsignal is verify-only and holds no keys/funds.',
  };
}

/** capped FREE preview — flags + counts, NOT the fused summary or the cited posts (pay via x402 for full). */
function previewBrief(inp = {}, opts = {}) {
  const b = buildBrief(inp, opts);
  return {
    token: b.token, symbol: b.symbol,
    market: { found: b.market.found, flags: b.market.flags || [] },
    social: { count: b.social.count, topScore: b.social.topScore },
    preview: true, upgrade: 'pay via x402 at /brief for the full fused brief (summary, market metrics + cited top social posts)',
  };
}

module.exports = { buildBrief, previewBrief };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  const intel = { addr: '0xdef', symbol: 'DEGEN', found: true, priceUsd: 0.01, liquidityUsd: 2500000, volume24: 800000, priceChange24: -3, ageHours: 960, buySellRatio: 1.2, flags: ['established'], url: 'https://dexscreener.com/base/0xdef' };
  const signal = { query: 'DEGEN', count: 2, topScore: 88, items: [{ text: 'DEGEN trending again on Base', author: 'a', url: 'https://x.com/i/status/1', score: 88, metrics: {} }, { text: 'degen volume ripping', author: 'b', url: 'https://x.com/i/status/2', score: 40, metrics: {} }] };
  const b = buildBrief({ intel, signal });
  const noPool = buildBrief({ intel: { addr: '0x0', found: false, flags: ['no-pool'] }, signal: { count: 0, topScore: 0, items: [] } });
  const prev = previewBrief({ intel, signal });

  const checks = [
    ['fuses market + social into ONE summary (symbol, liquidity, social count)', /\$DEGEN/.test(b.summary) && /2\.5M liquidity/.test(b.summary) && /2 scored posts/.test(b.summary)],
    ['market fields propagate (found + established flag + liquidity)', b.market.found === true && b.market.flags.includes('established') && b.market.liquidityUsd === 2500000],
    ['social: CITED top posts (url each), capped <=3', b.social.top.length <= 3 && b.social.top.every(p => /x\.com/.test(p.url)) && b.social.count === 2],
    ['no-pool token → market.found false + summary says no DEX pool (honest)', noPool.market.found === false && /no DEX pool/.test(noPool.summary)],
    ['preview: capped — strips summary + cited posts, keeps flags + counts', prev.preview === true && prev.summary === undefined && prev.social.top === undefined && prev.market.flags.includes('established')],
    ['honesty: verify before acting; not financial advice + verify-only', /verify before acting/i.test(b.note) && /not financial advice/i.test(b.note)],
    ['NO fund-moving executor in the surface (pure fusion)', !Object.keys(module.exports).some(k => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|transfer|withdraw)/i.test(k))],
  ];
  console.log('brief:', JSON.stringify({ summary: b.summary }));
  let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} checks passed`);
  process.exit(pass === checks.length ? 0 : 1);
}
