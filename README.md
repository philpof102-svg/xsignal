# ⚡ xsignal

An **x402-paid real-time X/social signal** for AI agents — a sellable *ingredient* for the agentic economy on **Base**.
Agents pay a few cents in USDC to get a **fresh, scored, cited** signal instead of stale training data or generic search.

## Why
The x402 rail + discovery catalog are commoditized (Coinbase/Circle/AWS/Stripe). The defensible thing is a **useful
ingredient with a moat** — here, real-time social signal scored for *freshness + virality* and **cited** to source posts,
serving the crypto-native agents/traders who are the actual x402 buyers today.

## Endpoints
| | |
|---|---|
| `GET /signal/preview?q=<topic>` | **FREE** capped preview (top 3, scores only) |
| `GET /signal?q=<topic>` | **x402-paid** full signal — HTTP 402 + `accepts` until paid, then full text + metrics + citations |
| `POST /signal` | paid; body `{candidates?[] \| query, terms?, source?, limit?}` |
| `POST /mcp` | MCP `get_signal` tool (streamable-http) |
| `GET /health` · `/.well-known/mcp.json` · `/.well-known/agent-card.json` | health + agent discovery |

## Safety
**We never sign or move funds.** x402 means we *receive* USDC to `payTo`; payment is **verify-only** via a facilitator.
The signal is scored from public X posts — *verify before acting; not financial advice.*

## Config (env)
| Var | Purpose |
|---|---|
| `XSIGNAL_PAYTO` | address that receives USDC (public; no key). Default = the operator address. |
| `XSIGNAL_PRICE_USD` | price per full signal (default `0.01`) |
| `FACILITATOR_URL` / `FACILITATOR_KEY` | x402 facilitator (Coinbase CDP) — until set, the paid route correctly stays `402` |
| `X_BEARER_TOKEN` **or** `XAI_API_KEY` | live candidate source (X search / Grok). No key → a small labelled DEMO seed so the preview always renders. |

## Run
```bash
npm start      # :4520
npm test       # 30/30 self-tests
```
Zero runtime dependencies — plain Node (>=18). Adapted from XMoment's `x-agent` scoring.
