---
name: xsignal
description: Pay-per-call real-time signal for agents on Base — get a fresh, scored, CITED X/social signal for a topic, or Base token market intel (liquidity/volume/age/flow), instead of relying on stale training data. Use when you need current social sentiment/virality on a topic, or to size up a Base token before acting. Micro-paid via x402 (USDC on Base); free preview first.
homepage: https://xsignal-production.up.railway.app
license: MIT
---

# xsignal — a micro-paid plugin for agents

xsignal is a **paid ingredient for the agentic economy**: an agent calls it to get data it can't get from training
data or generic search — priced per call in **USDC on Base via x402**. Two skills, each with a **free preview** so you
can try before you pay. It never signs or moves your funds; it returns data, you decide.

## When to use
- **get_signal** — you need what's *trending / viral / being said right now* about a topic (a token, a narrative, an
  event). Returns ranked posts scored by virality + freshness, **with source URLs** (cite them; verify before acting).
- **get_token_intel** — you're about to touch a **Base token** and need liquidity / 24h volume / price + change / pool
  age / buy-sell flow + mechanical flags (thin-liquidity, very-new, sell-pressure, established). Market data, **not** a
  trust/safety rating.

## How to call it

### A) MCP (streamable-http) — recommended for agents
Endpoint: `POST https://xsignal-production.up.railway.app/mcp` (JSON-RPC 2.0, protocol 2024-11-05, CORS-open).
Tools: `get_signal`, `get_token_intel`. `tools/list` to discover, `tools/call` to invoke. The MCP tools return the
**free preview** (or full when you supply your own candidates); the paid full result is the HTTP route below.

### B) HTTP (x402 pay-per-call)
- Free preview (no payment): `GET /signal/preview?q=<topic>` · `GET /token/preview?addr=<0x…>`
- Paid full: `GET /signal?q=<topic>` · `GET /token?addr=<0x…>`
  1. First request returns **HTTP 402** with an `accepts` array (price in USDC, network `base`, `payTo`).
  2. Pay per x402 (e.g. `x402-axios` / `x402-fetch` with your funded Base wallet) and resubmit with the `X-PAYMENT` header.
  3. You get the full result (all items, text, metrics, citations / full token intel).

Discovery: `GET /.well-known/mcp.json` (endpoint + tools + price) and `/.well-known/agent-card.json` (ERC-8004).

## Cost & safety
- Price: ~$0.01 USDC per full call on Base (see the 402 body / `/health` for the live price).
- **Free preview is always available** — use it to decide if the full call is worth paying for.
- Honest by design: signal is scored from **public X posts**; token intel is **public DEX-pool data**. Both are inputs,
  not decisions — *verify before acting; not financial advice.* xsignal is verify-only and holds no keys/funds.

## Example (buyer agent)
```js
// 1) free preview to decide
const p = await fetch('https://xsignal-production.up.railway.app/token/preview?addr=' + addr).then(r => r.json());
if (p.flags?.includes('thin-liquidity')) { /* maybe skip */ }
// 2) pay for the full intel via x402 (x402-fetch wraps fetch with your Base wallet)
const full = await x402fetch('https://xsignal-production.up.railway.app/token?addr=' + addr).then(r => r.json());
```
