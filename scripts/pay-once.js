#!/usr/bin/env node
/**
 * pay-once.js — make ONE real x402 USDC payment to an xsignal endpoint, so xsignal gets its first SETTLED payment
 * and the Coinbase CDP Bazaar auto-catalogs it. **YOU run this with YOUR funded Base wallet.** This script never
 * commits, logs, or transmits your key — it reads it from an env var at runtime. Claude never runs this and never
 * sees the key (descriptor-only: a human signs the payment).
 *
 * Prereqs (all yours):
 *   1. xsignal must be on MAINNET so the CDP facilitator settles + catalogs it. On xsignal's Railway set:
 *        X402_NETWORK=base
 *        CDP_API_KEY_ID=...        (reuse MainStreet's existing CDP key)
 *        CDP_API_KEY_SECRET=...
 *      then redeploy. (On base-sepolia this settles too, but does NOT list on the mainnet Bazaar.)
 *   2. A Base wallet funded with a little USDC (the PAYER). Gas is sponsored by the facilitator (EIP-3009),
 *      so the payer only needs USDC, not ETH. Ideally payer != payTo (self-pay is flagged as wash), but any
 *      settled payment triggers the catalog.
 *   3. npm i x402-fetch viem     (viem is already a dep here)
 *
 * Run:
 *   PowerShell:  $env:PAYER_PRIVATE_KEY="0xYourFundedWalletKey"; node scripts/pay-once.js
 *   bash:        PAYER_PRIVATE_KEY=0x... node scripts/pay-once.js
 *   (optional)   PAY_ENDPOINT="/token?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"  # a $0.01 call
 */
'use strict';
const URL = (process.env.XSIGNAL_URL || 'https://xsignal-production.up.railway.app').replace(/\/$/, '');
const ENDPOINT = process.env.PAY_ENDPOINT || '/intent?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&min_confidence=0.1';
const key = process.env.PAYER_PRIVATE_KEY;

if (!key) { console.error('✗ Set PAYER_PRIVATE_KEY (your funded Base wallet key). It is never committed or logged.'); process.exit(1); }

(async () => {
  let wrapFetchWithPayment, privateKeyToAccount;
  try { ({ wrapFetchWithPayment } = require('x402-fetch')); ({ privateKeyToAccount } = require('viem/accounts')); }
  catch (e) { console.error('✗ Missing deps. Run:  npm i x402-fetch viem\n', e.message); process.exit(1); }

  const account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key);
  console.log('Payer :', account.address);
  console.log('Target:', URL + ENDPOINT);

  const fetchWithPay = wrapFetchWithPayment(fetch, account);
  const r = await fetchWithPay(URL + ENDPOINT);
  const body = await r.json().catch(() => ({}));
  console.log('HTTP', r.status);
  console.log(JSON.stringify(body, null, 2).slice(0, 1000));

  const settled = r.headers.get('x-payment-response');
  if (settled) {
    console.log('\n✅ SETTLED. x-payment-response:', settled);
    console.log('If on mainnet, xsignal is now cataloged in the CDP Bazaar (quality rank recomputes ~every 6h).');
  } else if (r.status === 402) {
    console.log('\nStill 402 — payment did not go through. Check: wallet funded with USDC? xsignal on the same network as your wallet? deps installed?');
  }
})().catch((e) => { console.error('✗', e && e.message); process.exit(1); });
