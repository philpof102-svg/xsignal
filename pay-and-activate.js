#!/usr/bin/env node
/**
 * pay-and-activate.js — make ONE real x402 payment to xsignal so the CDP Bazaar auto-lists it.
 * ============================================================================================
 * HUMAN-RUN ONLY. You (Phil) provide PAYER_PRIVATE_KEY in your env — a Base wallet holding a little USDC.
 * This script signs an x402 payment authorization with YOUR key and calls a paid xsignal endpoint.
 * It NEVER stores, logs, or transmits the key anywhere except to sign locally. Claude never sees it.
 *
 * There is no "contract to sign" for the Bazaar (unlike MainStreet's ERC-8004 register). The Bazaar
 * catalogs a service on its FIRST SETTLED payment. This script is that first payment.
 *
 * PREREQS
 *   1. On xsignal's Railway service, set (same values as MainStreet) and redeploy:
 *        X402_NETWORK=base
 *        CDP_API_KEY_ID=...        CDP_API_KEY_SECRET=...
 *      (Without these, xsignal stays on base-sepolia/testnet and a mainnet payment cannot settle → no Bazaar listing.)
 *   2. A Base wallet with a little USDC (>= the endpoint price, e.g. $0.05). Gas is sponsored by the CDP
 *      facilitator (EIP-3009 gasless), so you do NOT need ETH — you need USDC on Base.
 *   3. Install the payer libs (once):   npm i x402-fetch viem
 *   4. Run:   PAYER_PRIVATE_KEY=0xyourkey node pay-and-activate.js
 *
 * A distinct payer wallet (not the payTo 0xAC3ca7c5…) is cleaner — a self-payment technically settles + lists,
 * but self-dealing is what wash-trade filters flag. For a real first customer, pay from a different funded wallet.
 */
const URL = (process.env.XSIGNAL_URL || 'https://xsignal-production.up.railway.app').replace(/\/$/, '');
const ENDPOINT = process.env.XSIGNAL_ENDPOINT || '/preflight?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed';
const KEY = process.env.PAYER_PRIVATE_KEY;

async function main() {
  if (!KEY) {
    console.error('Set PAYER_PRIVATE_KEY (a Base wallet holding a little USDC). It stays in your env; it is never logged.');
    console.error('Then: npm i x402-fetch viem  &&  PAYER_PRIVATE_KEY=0x... node pay-and-activate.js');
    process.exit(1);
  }
  let wrapFetchWithPayment, privateKeyToAccount, createWalletClient, http, base;
  try {
    ({ wrapFetchWithPayment } = require('x402-fetch'));
    ({ privateKeyToAccount } = require('viem/accounts'));
    ({ createWalletClient, http } = require('viem'));
    ({ base } = require('viem/chains'));
  } catch (e) {
    console.error('Missing payer deps. Run:  npm i x402-fetch viem'); process.exit(1);
  }
  const account = privateKeyToAccount(KEY.startsWith('0x') ? KEY : '0x' + KEY);
  const wallet = createWalletClient({ account, chain: base, transport: http() });
  const fetchWithPay = wrapFetchWithPayment(fetch, wallet);
  console.log('Payer wallet:', account.address);
  console.log('Calling (pays via x402 on the 402):', URL + ENDPOINT);
  const r = await fetchWithPay(URL + ENDPOINT);
  const status = r.status;
  let bodyText = ''; try { bodyText = await r.text(); } catch {}
  console.log('HTTP', status);
  console.log(bodyText.slice(0, 800));
  const payResp = r.headers.get('x-payment-response');
  if (payResp) console.log('x-payment-response (settlement):', payResp);
  if (status === 200) {
    console.log('\n✅ Paid + served. The payment SETTLED via the CDP facilitator → xsignal auto-lists on the Bazaar (recomputed ~every 6h).');
    console.log('   Verify listing later: GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?q=xsignal');
  } else if (status === 402) {
    console.log('\n⚠️ Still 402 — payment did not settle. Check: xsignal is on X402_NETWORK=base with the CDP key set + redeployed, and the wallet holds USDC on Base.');
  }
}
main().catch((e) => { console.error('error:', e && e.message ? e.message : e); process.exit(1); });
