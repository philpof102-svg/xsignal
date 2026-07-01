---
name: xsignal
description: Pay-per-call data ingredients for agents on Base — a scored + CITED real-time X/social signal, Base token market intel, a fused token brief (meal), and an outcome-priced momentum verdict that ABSTAINS below your confidence bar. Every call is micro-paid via x402 (USDC on Base) from $0.01; there is no free tier. Use when you need current social virality on a topic, or to size up / read the momentum of a Base token before acting.
homepage: https://xsignal-production.up.railway.app
license: MIT
---

# xsignal — pay-per-call data ingredients for agents

xsignal is a set of **paid ingredients for the agentic economy**: an agent calls one to get data it can't get from training
data or generic search, priced per call in **USDC on Base via x402**. **No free tier** — every data call is x402-paid,
from **$0.01**. It never signs or moves your funds; it returns data (or a calibrated abstain), you decide.

## The tools
- **get_signal** ($0.01) — what's *trending / viral / being said right now* about a topic (a token, a narrative, an
  event). Ranked posts scored by virality + freshness, **with source URLs** (cite them; verify before acting).
- **get_token_intel** ($0.01) — liquidity / 24h volume / price + change / pool age / buy-sell flow + mechanical flags
  (thin-liquidity, very-new, sell-pressure, established) for a **Base token**. Market data, **not** a trust/safety rating.
- **get_token_brief** ($0.05, a MEAL) — one call fuses `get_token_intel` + `get_signal` into a single "what is happening
  with $TOKEN right now" brief: market flags + top **cited** posts + a plain-language, non-advisory summary.
- **get_intent** ($0.01, outcome-priced) — pay-first, then a mechanical **momentum** verdict (gaining/fading) if
  confidence meets your `min_confidence`, else a **calibrated ABSTAIN** (the flat fee is the no-fill fee). Paid answers
  carry a keyless tamper-evidence receipt `{inputHash, outputHash, settlementTx}`.

## How to call it

### A) MCP (streamable-http) — for discovery
Endpoint: `POST https://xsignal-production.up.railway.app/mcp` (JSON-RPC 2.0, protocol 2024-11-05, CORS-open).
`tools/list` to discover the four tools. A `tools/call` returns an **x402 payment pointer** (price + `accepts` + the HTTP
endpoint to pay) — MCP has no payment rail, so the data itself comes from the paid HTTP route below.

### B) HTTP (x402 pay-per-call) — where the data is served
Every route is paid (no `/preview`):
- `GET /signal?q=<topic>` ($0.01) · `GET /token?addr=<0x…>` ($0.01) · `GET /brief?addr=<0x…>` ($0.05)
- `GET /intent?addr=<0x…>&min_confidence=<0-1>` ($0.01)

Flow: the first request returns **HTTP 402** with an `accepts` array (price in USDC, network `base`, `payTo`). Pay per
x402 (e.g. `x402-axios` / `x402-fetch` with your funded Base wallet) and resubmit with the `X-PAYMENT` header to receive
the full result. `/intent` is pay-first: you pay, then get a verdict **or** an honest abstain if it can't meet your bar.

Discovery (free, no data): `GET /health`, `GET /.well-known/mcp.json`, `GET /.well-known/agent-card.json` (ERC-8004),
`GET /skill.md` (this file).

## Cost & safety
- From **$0.01 USDC** per call on Base. No free tier — a funded agent pays in one hop; the $0.01 floor filters noise
  without real friction.
- Honest by design: signal is scored from **public X posts**; token intel + momentum are **public DEX-pool data**. All
  are inputs, not decisions — *verify before acting; not financial advice.* `get_intent` confidence is a transparent
  signal-agreement heuristic (**not** a calibrated probability or a prediction); weak/conflicting signals → abstain.
- xsignal is verify-only and holds no keys/funds.

## Example (buyer agent)
```js
// pay for a token's momentum read; you either get a verdict or an honest abstain (both cost the flat $0.01)
const res = await x402fetch(
  'https://xsignal-production.up.railway.app/intent?addr=' + addr + '&min_confidence=0.7'
).then(r => r.json());
if (res.served) act(res.verdict, res.evidence, res.receipt); // 'gaining' | 'fading' + cited evidence + receipt
else skip(res.reason);                                       // abstained: confidence below your bar
```
