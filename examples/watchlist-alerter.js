'use strict';
/**
 * xsignal example — watchlist momentum alerter  (the "reusable workflow" agents pay for)
 * =====================================================================================
 * Scan a watchlist of Base tokens and surface ONLY the ones that are confidently moving. This is the
 * abstention flagship (get_intent) doing what incumbents can't: it stays QUIET on the tokens it isn't
 * sure about, so your agent acts on signal, not noise.
 *
 * Runs FREE out of the box: set WALLET to your 0x address and each token spends one of your 3 free
 * probe calls per wallet. Beyond 3, wrap fetch with x402 (x402-fetch / x402-axios + a funded Base
 * wallet) and drop the ?wallet= param — the SAME code then pays $0.01/call automatically.
 *
 *   WALLET=0xYourAddr node examples/watchlist-alerter.js
 */
const BASE = process.env.XSIGNAL_URL || 'https://xsignal-production.up.railway.app';
const WALLET = process.env.WALLET || '0x0000000000000000000000000000000000000000'; // your addr → 3 free calls, then pay via x402
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 0.25); // raise it (e.g. 0.7) to watch xsignal abstain on weak movers

// A Base token watchlist (add your own 0x addresses; xsignal reads the on-chain symbol).
const WATCHLIST = [
  '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', // DEGEN
  // '0x...your token...',
];

async function readIntent(addr) {
  const url = `${BASE}/intent?addr=${addr}&min_confidence=${MIN_CONFIDENCE}&wallet=${WALLET}`;
  const r = await fetch(url);
  if (r.status === 402) return { addr, paywalled: true }; // free probe used up → pay via x402 to continue
  if (!r.ok) return { addr, error: 'HTTP ' + r.status };
  return { addr, ...(await r.json()) };
}

(async () => {
  console.log(`xsignal watchlist alerter — surfacing only what is confidently moving (min_confidence ${MIN_CONFIDENCE})\n`);
  const results = await Promise.all(WATCHLIST.map(readIntent));
  for (const r of results) {
    const sym = (r.evidence && r.evidence.market && r.evidence.market.symbol) || r.addr.slice(0, 8);
    if (r.paywalled) console.log(`…  ${r.addr}  free probe used up — add x402 payment to continue`);
    else if (r.error) console.log(`…  ${r.addr}  (${r.error})`);
    else if (r.served) console.log(`${r.verdict === 'gaining' ? '🟢' : '🔴'}  $${sym}  ${r.verdict}  (confidence ${r.confidence})`);
    else console.log(`·   $${sym}  abstain — not confident enough (${r.confidence}); xsignal stays quiet`);
  }
  const movers = results.filter((r) => r.served);
  console.log(`\n${movers.length}/${WATCHLIST.length} confidently moving. The rest: xsignal abstained rather than guess.`);
  console.log('Not financial advice. Confidence is a mechanical heuristic, not a prediction.');
})();
