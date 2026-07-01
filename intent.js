'use strict';
/**
 * xsignal — intent.js  (OUTCOME-PRICED / ABSTAINING ingredient — the Bazaar white space)
 * ======================================================================================
 * The differentiator (foresight vector 2): the fixed-price catalog has no OUTCOME pricing. An agent posts an intent
 * `{addr, min_confidence, max_price}` and xsignal returns a mechanical momentum verdict ONLY if it can meet that
 * confidence bar within that budget — otherwise it ABSTAINS (no verdict, no charge). Calibrated abstention as a
 * PRICING mechanism, staying in the blessed data-ingredient lane (NOT a "solver network", NOT a trust oracle).
 *
 * HONESTY: `confidence` = how strongly the available public signals AGREE on a direction (a transparent heuristic),
 * NOT a calibrated probability and NOT a prediction. Price is FLAT (never scaled up by confidence — that would reward
 * inflating it); the outcome pricing is "you only pay when your bar is met, else abstain". Pure fusion (inputs
 * injected) → testable. WE never sign / move funds. `node intent.js` runs the self-test.
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const ABSTAIN_NOTE = 'xsignal ABSTAINED: the mechanical read did not meet your min_confidence within your max_price. No verdict served, no charge. Abstention is a calibrated non-answer (a feature), not a failure.';
const VERDICT_NOTE = 'Mechanical momentum read of public DEX + social data. confidence = how strongly the available signals AGREE on a direction (a heuristic, NOT a calibrated probability and NOT a prediction). Verify before acting; not financial advice.';

/** Mechanical momentum read from an already-built token intel + signal. Transparent votes → verdict + confidence. */
function assessMomentum(inp = {}) {
  const intel = inp.intel || { found: false };
  const signal = inp.signal || { count: 0, topScore: 0 };
  const votes = []; // {dir:+1 gaining/-1 fading, w:weight, why}
  if (intel.found) {
    const chg = Number(intel.priceChange24);
    if (Number.isFinite(chg)) {
      if (chg >= 15) votes.push({ dir: 1, w: 1.0, why: 'price +' + chg + '% 24h' });
      else if (chg <= -15) votes.push({ dir: -1, w: 1.0, why: 'price ' + chg + '% 24h' });
    }
    const bs = intel.buySellRatio;
    if (bs === 'all-buys' || (typeof bs === 'number' && bs >= 1.3)) votes.push({ dir: 1, w: 0.8, why: 'buys > sells (' + bs + ')' });
    else if (typeof bs === 'number' && bs <= 0.7) votes.push({ dir: -1, w: 0.8, why: 'sells > buys (' + bs + ')' });
    if ((intel.flags || []).includes('sell-pressure')) votes.push({ dir: -1, w: 0.6, why: 'sell-pressure flag' });
  }
  if ((signal.count || 0) > 0 && (signal.topScore || 0) >= 60) votes.push({ dir: 1, w: 0.6, why: 'strong social signal (top ' + signal.topScore + ')' });
  const agreeW = votes.reduce((s, v) => s + v.w, 0);
  const netW = votes.reduce((s, v) => s + v.dir * v.w, 0);
  let verdict = 'unknown', confidence = 0, direction = 0;
  if (agreeW > 0) {
    const agreement = Math.abs(netW) / agreeW;     // 0..1 how aligned the signals are
    const sufficiency = Math.min(1, agreeW / 2.0);  // 0..1 is there enough evidence (>=2.0 total weight = full)
    confidence = Math.round(agreement * sufficiency * 100) / 100;
    direction = netW > 0 ? 1 : (netW < 0 ? -1 : 0);
    verdict = confidence >= 0.15 && direction !== 0 ? (direction > 0 ? 'gaining' : 'fading') : 'unknown';
  }
  return { verdict, confidence, direction, signals: votes.map((v) => v.why) };
}

/** Decide serve-vs-abstain for an intent (no evidence revealed — used by the route decision + the free preview). */
function quoteIntent(inp = {}) {
  const m = assessMomentum(inp);
  const minConfidence = clamp(inp.minConfidence == null ? 0.6 : Number(inp.minConfidence), 0, 1);
  const maxPrice = inp.maxPrice == null ? Infinity : Number(inp.maxPrice);
  const price = Number(inp.price) || 0.05;
  const priceOk = price <= maxPrice;
  const confOk = m.verdict !== 'unknown' && m.confidence >= minConfidence;
  const wouldServe = priceOk && confOk;
  const reason = wouldServe ? 'intent met' : (!confOk
    ? ('confidence ' + m.confidence + ' < min_confidence ' + minConfidence + (m.verdict === 'unknown' ? ' (signals too weak/conflicting → unknown)' : ''))
    : ('quoted price ' + price + ' > max_price ' + maxPrice));
  return { wouldServe, verdict: m.verdict, confidence: m.confidence, direction: m.direction, signals: m.signals, minConfidence, maxPrice: maxPrice === Infinity ? null : maxPrice, quotedPrice: price, reason };
}

/** The full SERVED payload (verdict + signals + cited evidence) — called only after a verified payment. Or the abstain. */
function buildIntent(inp = {}) {
  const q = quoteIntent(inp);
  const base = { question: inp.question || null, minConfidence: q.minConfidence, maxPrice: q.maxPrice, confidence: q.confidence };
  if (!q.wouldServe) return { ...base, served: false, abstain: true, verdict: 'abstain', reason: q.reason, note: ABSTAIN_NOTE };
  const intel = inp.intel || {}; const signal = inp.signal || { items: [] };
  return {
    ...base, served: true, verdict: q.verdict, direction: q.direction, signals: q.signals,
    evidence: {
      market: intel.found ? { symbol: intel.symbol, liquidityUsd: intel.liquidityUsd, priceChange24: intel.priceChange24, buySellRatio: intel.buySellRatio, flags: intel.flags } : { found: false },
      social: { count: signal.count || 0, topScore: signal.topScore || 0, top: (signal.items || []).slice(0, 3).map((i) => ({ text: i.text, url: i.url, score: i.score })) },
    },
    price: q.quotedPrice, note: VERDICT_NOTE,
  };
}

/** Free preview / quote — reveals wouldServe + confidence + quoted price, but NOT the verdict direction or evidence (paid). */
function previewIntent(inp = {}) {
  const q = quoteIntent(inp);
  return {
    wouldServe: q.wouldServe, confidence: q.confidence, minConfidence: q.minConfidence, maxPrice: q.maxPrice, quotedPrice: q.quotedPrice, reason: q.reason,
    verdict: q.wouldServe ? '(pay at /intent to reveal the verdict + evidence)' : 'abstain', preview: true,
    upgrade: q.wouldServe ? 'pay via x402 at /intent for the verdict (gaining/fading) + signals + cited evidence + receipt' : 'raise max_price or lower min_confidence, or try another token',
  };
}

module.exports = { assessMomentum, quoteIntent, buildIntent, previewIntent };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  const gaining = { intel: { found: true, symbol: 'UP', priceChange24: 40, buySellRatio: 'all-buys', liquidityUsd: 250000, flags: [] }, signal: { count: 2, topScore: 88, items: [{ text: 'UP ripping on Base', url: 'https://x.com/i/status/1', score: 88 }] } };
  const fading = { intel: { found: true, symbol: 'DN', priceChange24: -30, buySellRatio: 0.4, liquidityUsd: 250000, flags: ['sell-pressure'] }, signal: { count: 0, topScore: 0, items: [] } };
  const weak = { intel: { found: true, symbol: 'FLAT', priceChange24: 3, buySellRatio: 1.0, liquidityUsd: 250000, flags: [] }, signal: { count: 0, topScore: 0, items: [] } };
  const conflict = { intel: { found: true, symbol: 'MIX', priceChange24: 40, buySellRatio: 0.4, liquidityUsd: 250000, flags: [] }, signal: { count: 0, topScore: 0, items: [] } };
  const moderate = { intel: { found: true, symbol: 'MOD', priceChange24: 40, buySellRatio: 1.0, liquidityUsd: 250000, flags: [] }, signal: { count: 0, topScore: 0, items: [] } }; // one signal only → confidence 0.5

  const mG = assessMomentum(gaining);
  const servedG = buildIntent({ ...gaining, minConfidence: 0.7, maxPrice: 0.10, price: 0.05, question: 'is $UP gaining?' });
  const abstainConf = buildIntent({ ...moderate, minConfidence: 0.99, maxPrice: 0.10, price: 0.05 }); // conf 0.5 < 0.99 → abstain
  const abstainPrice = buildIntent({ ...gaining, minConfidence: 0.7, maxPrice: 0.01, price: 0.05 });
  const abstainWeak = buildIntent({ ...conflict, minConfidence: 0.2, maxPrice: 1, price: 0.05 });
  const prevServe = previewIntent({ ...gaining, minConfidence: 0.7, maxPrice: 0.10, price: 0.05 });
  const mF = assessMomentum(fading);

  const checks = [
    ['assessMomentum: aligned bullish signals → gaining, high confidence', mG.verdict === 'gaining' && mG.confidence >= 0.7],
    ['assessMomentum: aligned bearish signals → fading', mF.verdict === 'fading' && mF.confidence >= 0.7],
    ['assessMomentum: weak/no directional signal → unknown (honest)', assessMomentum(weak).verdict === 'unknown'],
    ['assessMomentum: conflicting signals → low confidence → unknown (does NOT fake certainty)', assessMomentum(conflict).verdict === 'unknown'],
    ['buildIntent SERVES when confidence >= min within budget (verdict + cited evidence)', servedG.served === true && servedG.verdict === 'gaining' && servedG.evidence.social.top[0].url.includes('x.com')],
    ['buildIntent ABSTAINS when min_confidence unreachable (no charge, honest reason)', abstainConf.served === false && abstainConf.abstain === true && /min_confidence/.test(abstainConf.reason)],
    ['buildIntent ABSTAINS when quoted price > max_price', abstainPrice.served === false && /max_price/.test(abstainPrice.reason)],
    ['buildIntent ABSTAINS on unknown even at low min_confidence (weak signals never forced into a verdict)', abstainWeak.served === false && abstainWeak.verdict === 'abstain'],
    ['previewIntent: quote reveals wouldServe + confidence but HIDES the verdict direction (pay to reveal)', prevServe.preview === true && prevServe.wouldServe === true && /pay at \/intent/.test(prevServe.verdict)],
    ['honesty: abstain = "not a failure"; verdict note = NOT a calibrated probability / prediction / advice', /not a failure/.test(ABSTAIN_NOTE) && /NOT a calibrated probability/.test(VERDICT_NOTE) && /not financial advice/.test(VERDICT_NOTE)],
    ['NO fund-moving executor in the surface (pure assessment)', !Object.keys(module.exports).some((k) => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|transfer|withdraw)/i.test(k))],
  ];
  console.log('intent:', JSON.stringify({ gaining: { v: mG.verdict, c: mG.confidence }, served: servedG.served, abstainWeak: abstainWeak.verdict }));
  let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} checks passed`);
  process.exit(pass === checks.length ? 0 : 1);
}
