'use strict';
/**
 * xsignal — tokenintel.js  (2nd ingredient: Base token MARKET intel for trading agents)
 * ====================================================================================
 * A sellable x402 ingredient: given a Base token address, return liquidity / volume / price / age / buy-sell
 * pressure + plain MARKET flags — the data a trading agent needs before it acts. MARKET DATA, not a "trust
 * score" (reputation is deliberately NOT the thesis). Sourced from public DEX pools (DexScreener, free). Pure
 * packaging here (data injected) → testable + dependency-free. `node tokenintel.js` runs the self-test.
 *
 * Injected token shape: { symbol, name, addr, priceUsd, liquidityUsd, volume24, priceChange24,
 *                         pairCreatedAtMs, buys24, sells24, dex, url }
 */
function buildTokenIntel(t, opts = {}) {
  if (!t || !t.addr) return { addr: (t && t.addr) || null, found: false, flags: ['no-pool'], note: 'No DEX pool found for this token on Base — illiquid or not launched. Market data unavailable. Not investment advice.' };
  const now = Number.isInteger(opts.nowMs) ? opts.nowMs : Date.now();
  const ageH = Number.isFinite(t.pairCreatedAtMs) ? Math.max(0, Math.round((now - t.pairCreatedAtMs) / 3.6e6)) : null;
  const liq = Number(t.liquidityUsd) || 0;
  const vol = Number(t.volume24) || 0;
  const buys = Number(t.buys24) || 0, sells = Number(t.sells24) || 0;
  const buySell = sells > 0 ? Math.round((buys / sells) * 100) / 100 : (buys > 0 ? Infinity : null);
  const turnover = liq > 0 ? Math.round((vol / liq) * 100) / 100 : null; // 24h volume / liquidity
  const flags = [];
  if (liq < 10000) flags.push('thin-liquidity');           // < $10k pooled — high slippage / rug-prone
  if (ageH !== null && ageH < 24) flags.push('very-new');   // < 24h old
  if (sells > 0 && buys / sells < 0.5) flags.push('sell-pressure'); // 2x+ sells vs buys
  if (turnover !== null && turnover > 5) flags.push('high-turnover'); // churny
  if (liq >= 100000 && ageH !== null && ageH > 168) flags.push('established'); // >$100k + >1wk
  return {
    addr: t.addr, symbol: t.symbol || null, name: t.name || null, found: true,
    priceUsd: t.priceUsd != null ? Number(t.priceUsd) : null,
    liquidityUsd: liq, volume24: vol, priceChange24: t.priceChange24 != null ? Number(t.priceChange24) : null,
    ageHours: ageH, buys24: buys, sells24: sells, buySellRatio: buySell === Infinity ? 'all-buys' : buySell,
    turnover, dex: t.dex || null, url: t.url || null, flags,
    note: 'Market data from public DEX pools (Base). Flags are mechanical (liquidity/age/flow), NOT a safety or trust rating. Verify on-chain; not investment advice.',
  };
}

/** capped FREE preview — the headline stats + flags, not the full metrics/flow (pay via x402 for full). */
function previewTokenIntel(t, opts = {}) {
  const f = buildTokenIntel(t, opts);
  if (!f.found) return { addr: f.addr, found: false, flags: f.flags, preview: true, upgrade: 'x402 /token for full intel' };
  return { addr: f.addr, symbol: f.symbol, priceUsd: f.priceUsd, liquidityUsd: f.liquidityUsd, ageHours: f.ageHours, flags: f.flags, preview: true, upgrade: 'pay via x402 for full intel (volume, flow, buy/sell, turnover, price change)' };
}

module.exports = { buildTokenIntel, previewTokenIntel };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  const NOW = 1782900000000;
  const fresh = { symbol: 'PING', name: 'Ping', addr: '0xabc', priceUsd: 0.0004, liquidityUsd: 4200, volume24: 60000, priceChange24: 180, pairCreatedAtMs: NOW - 6 * 3.6e6, buys24: 900, sells24: 2100, dex: 'uniswap', url: 'https://dexscreener.com/base/0xabc' };
  const solid = { symbol: 'DEGEN', name: 'Degen', addr: '0xdef', priceUsd: 0.01, liquidityUsd: 2500000, volume24: 800000, priceChange24: -3, pairCreatedAtMs: NOW - 40 * 24 * 3.6e6, buys24: 1200, sells24: 1000, dex: 'uniswap', url: 'https://dexscreener.com/base/0xdef' };
  const none = { addr: '0x000' , pairCreatedAtMs: NaN };
  const noneNoAddr = null;

  const iF = buildTokenIntel(fresh, { nowMs: NOW });
  const iS = buildTokenIntel(solid, { nowMs: NOW });
  const iN = buildTokenIntel(noneNoAddr, { nowMs: NOW });
  const prev = previewTokenIntel(fresh, { nowMs: NOW });

  const checks = [
    ['fresh thin token → flags very-new + thin-liquidity + sell-pressure', iF.flags.includes('very-new') && iF.flags.includes('thin-liquidity') && iF.flags.includes('sell-pressure')],
    ['fresh: buy/sell ratio computed (900/2100 = 0.43)', iF.buySellRatio === 0.43],
    ['solid deep token → flag established, no thin/new', iS.flags.includes('established') && !iS.flags.includes('thin-liquidity') && !iS.flags.includes('very-new')],
    ['turnover = 24h volume / liquidity', iF.turnover === Math.round((60000 / 4200) * 100) / 100],
    ['no token → found:false + no-pool flag (honest, not a fake score)', iN.found === false && iN.flags.includes('no-pool')],
    ['flags are MARKET flags, note says NOT a safety/trust rating', /NOT a safety or trust rating/.test(iS.note)],
    ['preview: capped (no volume/flow) + upgrade hint', prev.preview === true && prev.volume24 === undefined && /x402/.test(prev.upgrade)],
    ['honesty: not investment advice + verify on-chain', /not investment advice/i.test(iS.note) && /verify on-chain/i.test(iS.note)],
    ['NO fund-moving executor in the surface (pure data)', !Object.keys(module.exports).some(k => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|transfer|withdraw)/i.test(k))],
  ];
  console.log('intel(fresh):', JSON.stringify({ flags: iF.flags, buySell: iF.buySellRatio, turnover: iF.turnover }));
  let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} checks passed`);
  process.exit(pass === checks.length ? 0 : 1);
}
