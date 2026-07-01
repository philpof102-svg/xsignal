'use strict';
/**
 * xsignal — signal.js  (the core: score + rank + CITE a real-time X/social signal for agents)
 * =========================================================================================
 * The sellable "ingredient" for the agentic economy (x402-paid). Agents pay a few cents to get a fresh,
 * scored, cited social signal instead of relying on stale training data or generic search. Grounded in
 * XMoment's x-agent scoring; here the OUTPUT is a signal (not a coin). Dependency-free + testable
 * (candidates injected). WE never sign / move funds — the x402 layer RECEIVES USDC (see x402.js).
 *
 * A candidate item: { id?, text, author?, url?, likes?, retweets?, replies?, verified?, createdAtSec? }
 * `node signal.js` runs the self-test.
 */
const norm = (s) => String(s || '').toLowerCase();

/** Score a candidate: virality (likes/rt/replies, log-scaled) + topic match + freshness + verified bump. */
function scoreItem(it, opts = {}) {
  const now = Number.isInteger(opts.nowSec) ? opts.nowSec : Math.floor(Date.now() / 1000);
  const terms = (opts.terms || []).map(norm).filter(Boolean);
  const text = norm(it && it.text);
  const reasons = [];
  let score = 0;
  const hits = terms.length ? terms.filter((t) => text.includes(t)) : [];
  if (hits.length) { score += 20 + 6 * Math.min(hits.length, 4); reasons.push('match:' + hits.slice(0, 3).join('/')); }
  const vir = (it.likes || 0) + 2 * (it.retweets || 0) + 3 * (it.replies || 0); // replies/RTs weigh more than likes
  if (vir > 0) { score += Math.min(55, Math.round(Math.log10(1 + vir) * 17)); reasons.push('virality:' + vir); }
  // freshness counts ONLY when there is real signal (topic match or meaningful virality) — a fresh boring post shouldn't rank
  if (Number.isInteger(it.createdAtSec) && (hits.length || vir >= 100)) { const ageH = (now - it.createdAtSec) / 3600; if (ageH >= 0 && ageH <= 24) { const f = Math.round(20 * (1 - ageH / 24)); if (f > 0) { score += f; reasons.push('fresh:' + Math.max(1, Math.round(24 - ageH)) + 'h'); } } }
  if (it.verified) { score += 5; reasons.push('verified'); }
  return { score, reasons };
}

/** Build a ranked, deduped, CITED signal from candidates. `nowSec` injectable for deterministic tests. */
function buildSignal(candidates, opts = {}) {
  const seen = new Set();
  const min = Number.isFinite(opts.minScore) ? opts.minScore : 1;
  const items = (candidates || [])
    .map((it) => ({ raw: it, ...scoreItem(it, opts) }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score)
    .filter((c) => { const it = c.raw; const k = it.id || it.url || (norm(it.author) + norm(it.text).slice(0, 40)); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, opts.limit || 10)
    .map((c) => { const it = c.raw; return { text: it.text, author: it.author || null, url: it.url || (it.id ? 'https://x.com/i/status/' + it.id : null), score: c.score, reasons: c.reasons, metrics: { likes: it.likes || 0, retweets: it.retweets || 0, replies: it.replies || 0 } }; });
  return {
    query: opts.query || null,
    generatedAtSec: Number.isInteger(opts.nowSec) ? opts.nowSec : Math.floor(Date.now() / 1000),
    count: items.length,
    topScore: items[0] ? items[0].score : 0,
    items,
    note: 'Real-time social signal, scored + cited from public X posts. Verify before acting; not financial advice.',
  };
}

/** A capped FREE preview (top N, scores only, no full text/metrics) — the try-before-you-pay tier. */
function previewSignal(candidates, opts = {}) {
  const full = buildSignal(candidates, { ...opts, limit: Math.min(opts.limit || 3, 3) });
  return {
    query: full.query, generatedAtSec: full.generatedAtSec, count: full.count, topScore: full.topScore,
    items: full.items.map((i) => ({ author: i.author, url: i.url, score: i.score })), // no text/metrics in the free tier
    preview: true, upgrade: 'pay via x402 for the full scored + cited signal (text, metrics, all items)',
  };
}

module.exports = { scoreItem, buildSignal, previewSignal };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  const NOW = 1782900000;
  const cands = [
    { id: '1', text: 'BREAKING: ETH ETF approved, market ripping', author: 'a', likes: 90000, retweets: 20000, replies: 8000, verified: true, createdAtSec: NOW - 3600 },
    { id: '2', text: 'i ate a sandwich', author: 'b', likes: 2, createdAtSec: NOW - 3600 },
    { id: '3', text: 'ETH pumping hard, alt season loading', author: 'c', likes: 5000, retweets: 900, replies: 300, createdAtSec: NOW - 40 * 3600 }, // stale (>24h)
    { id: '1', text: 'BREAKING: ETH ETF approved, market ripping', author: 'a', likes: 90000, retweets: 20000, replies: 8000, verified: true, createdAtSec: NOW - 3600 }, // dup id
  ];
  const sig = buildSignal(cands, { query: 'ETH', terms: ['eth', 'etf'], nowSec: NOW });
  const prev = previewSignal(cands, { query: 'ETH', terms: ['eth'], nowSec: NOW });
  const s1 = scoreItem(cands[0], { terms: ['eth', 'etf'], nowSec: NOW });
  const sBoring = scoreItem(cands[1], { terms: ['eth'], nowSec: NOW });

  const checks = [
    ['scoreItem: viral + on-topic + fresh + verified scores high', s1.score >= 70 && s1.reasons.some(r => r.startsWith('match')) && s1.reasons.some(r => r.startsWith('virality')) && s1.reasons.some(r => r.startsWith('fresh'))],
    ['scoreItem: boring off-signal scores low', sBoring.score < 20],
    ['buildSignal: ranks by score, top item is the viral ETF one', sig.items.length >= 1 && /ETF/.test(sig.items[0].text) && sig.topScore >= 70],
    ['buildSignal: dedupes by id (no double #1)', sig.items.filter(i => /ETF/.test(i.text)).length === 1],
    ['buildSignal: CITES sources (url per item)', sig.items.every(i => i.url && /x\.com/.test(i.url))],
    ['buildSignal: freshness — stale (>24h) scores lower than fresh', (() => { const fresh = scoreItem(cands[0], { nowSec: NOW }); const stale = scoreItem(cands[2], { nowSec: NOW }); return fresh.score > stale.score; })()],
    ['previewSignal: free tier capped (<=3) + strips text/metrics (pay for full)', prev.preview === true && prev.items.length <= 3 && prev.items.every(i => i.text === undefined && i.metrics === undefined)],
    ['honesty: signal notes "verify before acting; not financial advice"', /verify before acting/i.test(sig.note) && /not financial advice/i.test(sig.note)],
    ['NO fund-moving executor in the surface (pure scoring)', !Object.keys(module.exports).some(k => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|transfer|withdraw)/i.test(k))],
  ];
  console.log('signal:', JSON.stringify({ top: sig.items[0] && sig.items[0].score, count: sig.count }));
  let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
  console.log(`\n${pass}/${checks.length} checks passed`);
  process.exit(pass === checks.length ? 0 : 1);
}
