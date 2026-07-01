'use strict';
/**
 * xsignal — x402.js  (x402 payment gating for the paid signal route)
 * ==================================================================
 * Grounded on the x402 spec (Coinbase CDP / Circle facilitators). We are the SELLER: an agent hits the paid
 * route, we answer HTTP 402 + an `accepts` array, the agent pays USDC on Base to our payTo and resubmits with
 * an X-PAYMENT header, we VERIFY it via the facilitator (read-only), then serve. WE never sign — we only receive.
 * `fetch` is injectable for tests. `node x402.js` runs the self-test.
 */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC (6 decimals)

/** Build the 402 body: the payment requirements the agent must satisfy (x402Version 1, one `accepts` entry). */
function paymentRequired(opts = {}) {
  const priceUsd = Number(opts.priceUsd || 0.01);
  const atomic = String(Math.max(1, Math.round(priceUsd * 1e6))); // USDC has 6 decimals
  return {
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: atomic,
      resource: opts.resource || '/signal',
      description: opts.description || 'xsignal — real-time X/social signal (scored + cited)',
      mimeType: 'application/json',
      payTo: opts.payTo,
      maxTimeoutSeconds: 60,
      asset: USDC_BASE,
      extra: { name: 'USDC', version: '2' },
    }],
    error: 'X-PAYMENT required: pay ' + priceUsd + ' USDC on Base, then resubmit with the X-PAYMENT header',
  };
}

/** Verify an X-PAYMENT header via the facilitator (env-configured). Returns {ok, reason}. No facilitator → not verified. */
async function verifyPayment(paymentHeader, opts = {}) {
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!paymentHeader) return { ok: false, reason: 'no X-PAYMENT header' };
  if (!opts.facilitatorUrl) return { ok: false, reason: 'facilitator not configured (set FACILITATOR_URL)' };
  if (!fetchImpl) return { ok: false, reason: 'no fetch available' };
  try {
    const r = await fetchImpl(opts.facilitatorUrl.replace(/\/$/, '') + '/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: 'Bearer ' + opts.apiKey } : {}) },
      body: JSON.stringify({ x402Version: 1, paymentHeader, paymentRequirements: opts.requirements }),
    });
    if (!r.ok) return { ok: false, reason: 'facilitator HTTP ' + r.status };
    const j = await r.json();
    return { ok: !!j.isValid, reason: j.isValid ? 'verified' : (j.invalidReason || 'invalid payment') };
  } catch (e) { return { ok: false, reason: 'verify error: ' + (e && e.message || e) }; }
}

module.exports = { paymentRequired, verifyPayment, USDC_BASE };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  (async () => {
    const PAY_TO = '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9';
    const req = paymentRequired({ priceUsd: 0.01, payTo: PAY_TO, resource: '/signal' });
    const a = req.accepts[0];
    const noHeader = await verifyPayment(null, {});
    const noFac = await verifyPayment('0xpay', {});
    const mockOk = async () => ({ ok: true, json: async () => ({ isValid: true }) });
    const mockBad = async () => ({ ok: true, json: async () => ({ isValid: false, invalidReason: 'insufficient' }) });
    const okV = await verifyPayment('0xpay', { facilitatorUrl: 'https://f.x', fetch: mockOk });
    const badV = await verifyPayment('0xpay', { facilitatorUrl: 'https://f.x', fetch: mockBad });

    const checks = [
      ['402 body: x402Version 1 + one accepts entry (exact/base/USDC)', req.x402Version === 1 && a.scheme === 'exact' && a.network === 'base' && a.asset === USDC_BASE],
      ['402: price → USDC atomic units (0.01 → 10000, 6 decimals)', a.maxAmountRequired === '10000'],
      ['402: payTo + resource carried', a.payTo === PAY_TO && a.resource === '/signal'],
      ['verify: no header → not ok', noHeader.ok === false && /no X-PAYMENT/.test(noHeader.reason)],
      ['verify: no facilitator configured → not ok (never fakes a pass)', noFac.ok === false && /facilitator/.test(noFac.reason)],
      ['verify: facilitator says valid → ok', okV.ok === true],
      ['verify: facilitator says invalid → not ok (+ reason)', badV.ok === false && /insufficient/.test(badV.reason)],
      ['NO fund-moving executor in the surface (we only verify + receive)', !Object.keys(module.exports).some(k => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|transfer|settle|withdraw)/i.test(k))],
    ];
    let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
    console.log(`\n${pass}/${checks.length} checks passed`);
    process.exit(pass === checks.length ? 0 : 1);
  })();
}
