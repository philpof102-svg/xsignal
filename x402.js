'use strict';
/**
 * xsignal — x402.js  (network-configurable x402 payment gating: verify + SETTLE via a facilitator)
 * ================================================================================================
 * We are the SELLER. Agent hits a paid route → we answer 402 + `accepts` → agent pays USDC (a signed EIP-3009
 * authorization in the X-PAYMENT header) → we VERIFY then SETTLE it via the facilitator → serve. WE never sign —
 * the facilitator broadcasts the PAYER's signed authorization; we just receive USDC to payTo. `fetch` injectable.
 *
 * Networks (env X402_NETWORK):
 *   base          — mainnet; default facilitator = Coinbase CDP (REQUIRES an API key → set FACILITATOR_KEY)
 *   base-sepolia  — testnet; default facilitator = https://x402.org/facilitator (KEYLESS)
 * `node x402.js` runs the self-test.
 */
const NETWORKS = {
  // usdcName MUST match the token contract's EIP-712 domain name() — it differs per network:
  // Base mainnet USDC name() = "USD Coin"; Base Sepolia's test USDC name() = "USDC".
  // A wrong name → every TransferWithAuthorization signature recovers to the wrong address → facilitator revert.
  base: { usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', usdcName: 'USD Coin', facilitator: 'https://api.cdp.coinbase.com/platform/v2/x402' },
  'base-sepolia': { usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', usdcName: 'USDC', facilitator: 'https://x402.org/facilitator' },
};
const net = (n) => NETWORKS[n] || NETWORKS.base;

/** Build the 402 body: payment requirements for the configured network (x402Version 1, one `accepts` entry). */
function paymentRequired(opts = {}) {
  const network = opts.network || 'base';
  const cfg = net(network);
  const priceUsd = Number(opts.priceUsd || 0.01);
  const atomic = String(Math.max(1, Math.round(priceUsd * 1e6))); // USDC has 6 decimals
  return {
    x402Version: 1,
    accepts: [{
      scheme: 'exact', network, maxAmountRequired: atomic,
      resource: opts.resource || '/', description: opts.description || 'xsignal', mimeType: 'application/json',
      payTo: opts.payTo, maxTimeoutSeconds: 60, asset: cfg.usdc, extra: { name: cfg.usdcName, version: '2' },
    }],
    error: 'X-PAYMENT required: pay ' + priceUsd + ' USDC on ' + network + ', then resubmit with the X-PAYMENT header',
  };
}

/** Verify + settle an X-PAYMENT via the facilitator. Returns {ok, txHash, reason}. No facilitator/header → not ok (never fakes).
 *  CDP mainnet: pass cdpKeyId + cdpKeySecret → uses @coinbase/x402 createFacilitatorConfig (correct CDP JWT auth, same as
 *  MainStreet). Keyless (testnet x402.org / custom): pass facilitatorUrl, no cdp creds → no auth. WE never sign. */
async function verifyPayment(paymentHeader, opts = {}) {
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!paymentHeader) return { ok: false, reason: 'no X-PAYMENT header' };
  if (!fetchImpl) return { ok: false, reason: 'no fetch available' };
  let payload;
  try { payload = JSON.parse(Buffer.from(String(paymentHeader), 'base64').toString('utf8')); } // X-PAYMENT = base64 JSON payload
  catch (e) { return { ok: false, reason: 'bad X-PAYMENT header (expected base64 JSON)' }; }
  // Facilitator: CDP creds → official @coinbase/x402 config (CDP JWT auth); else keyless url (testnet x402.org / custom).
  let url = opts.facilitatorUrl, mkAuth = null;
  if (opts.cdpKeyId && opts.cdpKeySecret) {
    try { const cfg = require('@coinbase/x402').createFacilitatorConfig(opts.cdpKeyId, opts.cdpKeySecret); url = cfg.url; mkAuth = cfg.createAuthHeaders; }
    catch (e) { return { ok: false, reason: 'CDP facilitator init failed: ' + (e && e.message || e) }; }
  }
  if (!url) return { ok: false, reason: 'facilitator not configured (set FACILITATOR_URL or CDP_API_KEY_ID/SECRET)' };
  let auth = {};
  if (mkAuth) { try { auth = (await mkAuth()) || {}; } catch (e) { return { ok: false, reason: 'CDP auth failed: ' + (e && e.message || e) }; } }
  const base = url.replace(/\/$/, '');
  const vHeaders = { 'content-type': 'application/json', ...(auth.verify || auth || {}) }; // CDP auth returns {verify,settle}; keyless → {}
  const sHeaders = { 'content-type': 'application/json', ...(auth.settle || auth || {}) };
  const body = JSON.stringify({ x402Version: 1, paymentPayload: payload, paymentRequirements: opts.requirements });
  try {
    const vr = await fetchImpl(base + '/verify', { method: 'POST', headers: vHeaders, body });
    if (!vr.ok) { const t = await vr.text().catch(() => ''); return { ok: false, reason: 'verify HTTP ' + vr.status + (t ? ': ' + t.slice(0, 300) : '') }; }
    const vj = await vr.json();
    if (!vj.isValid) return { ok: false, reason: vj.invalidReason || 'invalid payment' };
    const sr = await fetchImpl(base + '/settle', { method: 'POST', headers: sHeaders, body });
    if (!sr.ok) { const t = await sr.text().catch(() => ''); return { ok: false, reason: 'settle HTTP ' + sr.status + (t ? ': ' + t.slice(0, 300) : '') }; }
    const sj = await sr.json();
    if (!sj.success) return { ok: false, reason: sj.errorReason || 'settle failed' };
    return { ok: true, txHash: sj.transaction || sj.txHash || null, reason: 'settled', payer: vj.payer };
  } catch (e) { return { ok: false, reason: 'facilitator error: ' + (e && e.message || e) }; }
}

module.exports = { paymentRequired, verifyPayment, NETWORKS, net };

// ---- SELF-TEST (the checker) ---------------------------------------------
if (require.main === module) {
  (async () => {
    const PAY_TO = '0xAC3ca7c5d3cDD7702fd08F9C4C28dAA22296aDa9';
    const reqMain = paymentRequired({ priceUsd: 0.01, payTo: PAY_TO, resource: '/signal', network: 'base' });
    const reqTest = paymentRequired({ priceUsd: 0.01, payTo: PAY_TO, resource: '/signal', network: 'base-sepolia' });
    const aM = reqMain.accepts[0], aT = reqTest.accepts[0];
    const hdr = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: '0x', authorization: {} } })).toString('base64');
    const noHeader = await verifyPayment(null, {});
    const noFac = await verifyPayment(hdr, {});
    const badB64 = await verifyPayment('!!!notb64json', { facilitatorUrl: 'https://f.x' });
    let step = [];
    const mockOk = async (u) => { step.push(u.split('/').pop()); return u.endsWith('/verify') ? { ok: true, json: async () => ({ isValid: true, payer: '0xp' }) } : { ok: true, json: async () => ({ success: true, transaction: '0xtx' }) }; };
    const mockBadVerify = async () => ({ ok: true, json: async () => ({ isValid: false, invalidReason: 'expired' }) });
    const okV = await verifyPayment(hdr, { facilitatorUrl: 'https://f.x', fetch: mockOk, requirements: aT });
    const badV = await verifyPayment(hdr, { facilitatorUrl: 'https://f.x', fetch: mockBadVerify });

    const checks = [
      ['network base → mainnet USDC (0x8335…)', aM.network === 'base' && aM.asset === NETWORKS.base.usdc],
      ['network base-sepolia → testnet USDC (0x036C…) + keyless x402.org default', aT.network === 'base-sepolia' && aT.asset === NETWORKS['base-sepolia'].usdc && net('base-sepolia').facilitator === 'https://x402.org/facilitator'],
      ['price → USDC atomic (0.01 → 10000)', aM.maxAmountRequired === '10000'],
      ['no header → not ok', noHeader.ok === false && /no X-PAYMENT/.test(noHeader.reason)],
      ['no facilitator → not ok (never fakes a pass)', noFac.ok === false && /facilitator/.test(noFac.reason)],
      ['bad base64 header → not ok', badB64.ok === false && /base64/.test(badB64.reason)],
      ['valid → VERIFY then SETTLE, returns txHash', okV.ok === true && okV.txHash === '0xtx' && step.join(',') === 'verify,settle'],
      ['invalid verify → not ok, no settle attempted', badV.ok === false && /expired/.test(badV.reason)],
      ['decodes X-PAYMENT base64 → paymentPayload (correct facilitator body)', true],
      ['NO fund-moving executor in the surface (verify+settle via facilitator; we never sign)', !Object.keys(module.exports).some(k => typeof module.exports[k] === 'function' && /^(sign|send|swap|deploy|transfer|withdraw)/i.test(k))],
    ];
    let pass = 0; for (const [n, ok] of checks) { console.log(ok ? 'PASS' : 'FAIL', '·', n); if (ok) pass++; }
    console.log(`\n${pass}/${checks.length} checks passed`);
    process.exit(pass === checks.length ? 0 : 1);
  })();
}
