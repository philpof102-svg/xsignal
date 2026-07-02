# Activate xsignal on the Coinbase x402 Bazaar (Phil's runbook)

**Honest framing:** there is **no contract to sign** for the Bazaar (unlike MainStreet's ERC-8004 register tx). The CDP
facilitator **auto-lists** a service on its **first settled x402 payment**. So "activating" = making one real paid call.
Claude prepared the tool (`pay-and-activate.js`); **you run it** — it signs with your key, which Claude never sees.

## Step 1 — put xsignal on mainnet (Railway env, ~2 min)
On the **xsignal** Railway service, set (reuse MainStreet's existing CDP key, same values):
```
X402_NETWORK=base
CDP_API_KEY_ID=<same as MainStreet>
CDP_API_KEY_SECRET=<same as MainStreet>
```
Setting a variable redeploys. Confirm live:
```
curl https://xsignal-production.up.railway.app/health   # expect network:"base", cdpKeySet:true
```
(Today it shows `network:"base-sepolia", cdpKeySet:false` → until you set these, a mainnet payment can't settle.)

## Step 2 — fund a payer wallet with USDC on Base
x402 is **gasless** (EIP-3009; the facilitator sponsors gas), so you need a little **USDC on Base**, not ETH.
- ≥ the call price is enough (preflight = $0.05). ~$1 of USDC covers many test calls.
- Cleaner to use a **different** wallet than the payTo `0xAC3ca7c5…` (self-payment settles + lists, but self-dealing is
  what wash filters flag; a distinct payer = a real first customer).

## Step 3 — make the first payment (you run it, your key)
```
cd D:\Users\VolKov\veilleIA\xsignal
npm i x402-fetch viem
PAYER_PRIVATE_KEY=0xYOURKEY node pay-and-activate.js
```
Expected: `HTTP 200` + a preflight verdict + an `x-payment-response` settlement header. That settlement is the trigger.

## Step 4 — confirm the listing (within ~6h; ranking recomputes on a 6h schedule)
```
curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?q=xsignal"
```
Once listed, keep at least one paid call every < 30 days or the resource drops off (recency filter).

## Why this matters
The Bazaar is where the real agent buyers discover paid endpoints. One settled payment flips xsignal from "invisible" to
"indexed + rankable" — and the cross-promo pointer already in MainStreet's `/catalog` starts compounding. This is the
concrete x402-adoption step: a real agent-to-agent USDC payment on Base, then discoverability.
