---
name: xsignal
description: Pay-per-call data ingredients for agents on Base. Flagship get_intent is the only x402 signal that ABSTAINS below your confidence bar (it refuses to answer, honestly, when it is not sure) instead of always returning a guess. Also: a fused token brief, a scored + CITED real-time X/social signal, and Base token market intel. 3 free calls per wallet to try, then micro-paid via x402 (USDC on Base) from $0.01.
homepage: https://xsignal-production.up.railway.app
license: MIT
---

# xsignal — data ingredients that know when to shut up

xsignal sells **paid data ingredients for agents** on Base, priced per call in **USDC via x402**. What makes it different
from every other x402 data feed: the flagship tool **abstains** — it returns "no verdict" (and says so) when the signal
isn't strong enough, instead of always answering and always charging. **3 free calls per wallet** to try, then from
**$0.01**. Verify-only: it never signs or moves your funds.

## The tools (flagship first)
- **get_preflight** ($0.05) — the composed Base preflight: on-chain **safety** (SAFE/WATCH/AVOID + rug flags, via MainStreet) ⊕ **momentum** → one verdict (GO/CAUTION/AVOID). Safety gates momentum. Answers "is this token safe to touch AND moving?"
- **get_intent** ($0.01) — an **outcome-priced momentum verdict that ABSTAINS**. Post `{addr, min_confidence}` → get a
  mechanical `gaining`/`fading` verdict **only if** the signal agreement clears your bar, else a calibrated `abstain`.
  This is the one thing no other x402 signal does (the protocol norm is "always answer, always charge"). Paid answers
  carry a keyless tamper-evidence receipt `{inputHash, outputHash, settlementTx}`. Confidence is a transparent heuristic,
  **not** a prediction.
- **get_token_brief** ($0.05, a MEAL) — one call fuses token market intel + real-time social signal into a
  "what is happening with $TOKEN right now" brief: market flags + top **cited** posts + a plain-language summary.
- **get_signal** ($0.01) — a scored (virality + freshness) and **cited** real-time X/social signal for any topic.
- **get_token_intel** ($0.01) — Base token market data (liquidity, volume, price, pool age, buy/sell flow, flags) from
  public DEX pools. Market data, **not** a trust rating. Best used as an input to the brief.

## How to call it

### Try it free (3 calls per wallet)
Add `?wallet=0xYourAddress` to any route to get 3 free FULL results, so you can evaluate quality before paying:
`GET /intent?addr=0x…&min_confidence=0.7&wallet=0xYourAddr`. After 3, that wallet pays via x402.

### x402 (pay-per-call) — where the data is served
Every route is paid after the free probe: `GET /intent?addr=0x…&min_confidence=0.7` ($0.01) ·
`GET /brief?addr=0x…` ($0.05) · `GET /signal?q=<topic>` ($0.01) · `GET /token?addr=0x…` ($0.01).
Flow: the first (post-probe) request returns **HTTP 402** with an `accepts` array (price in USDC, network `base`, `payTo`).
Pay with `x402-axios`/`x402-fetch` and a funded Base wallet, resubmit with the `X-PAYMENT` header, receive the result.
`/intent` is pay-first: you pay, then get a verdict **or** an honest abstain.

### MCP (discovery)
`POST /mcp` (JSON-RPC 2.0). `tools/list` discovers the four tools; a `tools/call` returns an **x402 payment pointer**
(price + `accepts` + the HTTP endpoint) — MCP has no payment rail, so data is served from the paid HTTP route.
Discovery (free, no data): `GET /health`, `/.well-known/mcp.json`, `/.well-known/agent-card.json`, `/skill.md`.

## Cost & safety
- **3 free calls per wallet**, then from **$0.01 USDC** on Base. A funded agent pays in one hop.
- Honest by design: signals are scored from **public X posts** + **public DEX data**; all are inputs, not decisions —
  *verify before acting; not financial advice.* Confidence is a mechanical heuristic, not a calibrated probability.
- Verify-only; holds no keys/funds.

## Example (buyer agent)
```js
// 3 free probe calls first (?wallet=you), then x402fetch pays automatically once the probe is used up
const res = await x402fetch(
  'https://xsignal-production.up.railway.app/intent?addr=' + addr + '&min_confidence=0.7&wallet=' + myWallet
).then(r => r.json());
if (res.served) act(res.verdict, res.evidence, res.receipt); // 'gaining' | 'fading' + cited evidence + receipt
else skip(res.reason);                                       // abstained: confidence below your bar
```
