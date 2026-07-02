'use strict';
/**
 * xsignal — preflight.js : the composed Base preflight = SAFETY (MainStreet trust) ⊕ MOMENTUM (xsignal signal).
 * =========================================================================================================
 * One call answers what an agent actually needs before touching a Base token: "is it SAFE, and is it MOVING?"
 * SAFETY = MainStreet's public on-chain classification (SAFE / WATCH / AVOID + rug flags) — the layer with the real
 * agent audience. MOMENTUM = xsignal's abstaining read. Safety GATES momentum: never green-light a token that can rug,
 * whatever the chart says. Mechanical, NOT financial advice. Pure fusion (inputs injected) → testable.
 */
const NOTE = 'Composed preflight: SAFETY = MainStreet on-chain classification (SAFE/WATCH/AVOID + flags); MOMENTUM = xsignal abstaining read. Both are inputs, not decisions. Safety gates momentum. Verify before acting; not financial advice.';

function buildPreflight(inp = {}) {
  const s = inp.safety || {};
  const m = inp.momentum || {};
  const classification = String(s.classification || 'UNKNOWN').toUpperCase(); // SAFE | WATCH | AVOID | UNKNOWN
  const hardFail = !!s.hardFail;
  const flags = Array.isArray(s.flags) ? s.flags : [];
  const verdict = m.verdict || 'unknown'; // gaining | fading | abstain | unknown
  const confidence = m.confidence != null ? m.confidence : null;

  let recommendation, reason;
  if (hardFail || classification === 'AVOID') {
    recommendation = 'AVOID';
    reason = 'safety says AVOID' + (flags.length ? ' (' + flags.slice(0, 3).join(', ') + ')' : '') + ' - momentum is irrelevant when it can rug.';
  } else if (classification === 'UNKNOWN') {
    recommendation = 'UNVERIFIED';
    reason = 'no safety classification available - treat as unverified.';
  } else if (verdict === 'gaining') {
    recommendation = classification === 'SAFE' ? 'GO' : 'CAUTION';
    reason = classification + ' + gaining (confidence ' + confidence + ')' + (classification === 'WATCH' ? ' - safe-ish but watch the flags.' : '.');
  } else if (verdict === 'fading') {
    recommendation = 'AVOID_ENTRY';
    reason = classification + ' but fading - momentum is against an entry.';
  } else { // abstain | unknown
    recommendation = 'NEUTRAL';
    reason = classification + ' but no momentum edge (xsignal abstained). No signal to act on.';
  }
  return {
    token: inp.addr || null, symbol: inp.symbol || s.symbol || null,
    recommendation, reason,
    safety: { classification, riskLevel: s.riskLevel || null, hardFail, flags },
    momentum: { verdict, confidence, signals: Array.isArray(m.signals) ? m.signals : [] },
    note: NOTE,
  };
}

module.exports = { buildPreflight };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  const safe = { classification: 'SAFE', riskLevel: 'LOW', hardFail: false, flags: [], symbol: 'DEGEN' };
  const gaining = { verdict: 'gaining', confidence: 0.8, signals: ['price +40% 24h'] };
  const checks = [
    ['SAFE + gaining → GO', buildPreflight({ safety: safe, momentum: gaining }).recommendation === 'GO'],
    ['AVOID gates momentum → AVOID (even if gaining)', buildPreflight({ safety: { classification: 'AVOID', flags: ['honeypot'] }, momentum: gaining }).recommendation === 'AVOID'],
    ['hardFail gates → AVOID', buildPreflight({ safety: { classification: 'SAFE', hardFail: true }, momentum: gaining }).recommendation === 'AVOID'],
    ['WATCH + gaining → CAUTION', buildPreflight({ safety: { classification: 'WATCH', flags: ['thin-liq'] }, momentum: gaining }).recommendation === 'CAUTION'],
    ['SAFE + fading → AVOID_ENTRY', buildPreflight({ safety: safe, momentum: { verdict: 'fading', confidence: 0.7 } }).recommendation === 'AVOID_ENTRY'],
    ['SAFE + abstain → NEUTRAL', buildPreflight({ safety: safe, momentum: { verdict: 'abstain', confidence: 0.3 } }).recommendation === 'NEUTRAL'],
    ['no safety → UNVERIFIED', buildPreflight({ safety: {}, momentum: gaining }).recommendation === 'UNVERIFIED'],
    ['carries both layers + reason', (() => { const p = buildPreflight({ safety: safe, momentum: gaining, addr: '0xabc' }); return p.safety.classification === 'SAFE' && p.momentum.verdict === 'gaining' && !!p.reason; })()],
    ['honesty: safety gates momentum + not financial advice', /Safety gates momentum/.test(NOTE) && /not financial advice/.test(NOTE)],
    ['NO fund-moving executor in the surface', !Object.keys(module.exports).some((k) => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|transfer|withdraw)/i.test(k))],
  ];
  console.log('preflight:', JSON.stringify(buildPreflight({ safety: safe, momentum: gaining, addr: '0xabc' })));
  let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} checks passed`);
  process.exit(pass === checks.length ? 0 : 1);
}
