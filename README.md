# ⚡ xsignal

**Pay-per-call data ingredients for AI agents on Base**, via x402 (USDC). The flagship is the one thing no other x402
signal does: **`get_intent` abstains** — it returns *"no verdict"* (and says so) when it isn't confident enough, instead
of always answering and always charging. **3 free calls per wallet** to try, then from **$0.01**. Verify-only: never
signs or moves funds.

## The tools (flagship first)
| Tool / route | Price | What you get |
|---|---|---|
| **`get_preflight`** · `GET /preflight?addr=0x…` | $0.05 | **The composed Base preflight:** fuses on-chain safety (SAFE/WATCH/AVOID + rug flags, via MainStreet) with momentum into one verdict — GO / CAUTION / AVOID. Safety gates momentum, so it never green-lights a token that can rug. |
| **`get_intent`** · `GET /intent?addr=0x…&min_confidence=0.7` | $0.01 | An outcome-priced momentum verdict (`gaining`/`fading`) **only if** confidence clears your bar, else a calibrated `abstain`. Paid answers carry a keyless tamper-evidence receipt. |
| `get_token_brief` · `GET /brief?addr=0x…` | $0.05 | A **meal**: fuses market intel + cited social signal into a "what is happening with $TOKEN now" brief. |
| `get_signal` · `GET /signal?q=<topic>` | $0.01 | A scored (virality + freshness) and **cited** real-time X/social signal. |
| `get_token_intel` · `GET /token?addr=0x…` | $0.01 | Base token market data (liquidity/volume/price/age/flow + flags). Best as an input to the brief. |
| `POST /mcp` | — | MCP (streamable-http): `tools/list` discovers the 5 tools; a `tools/call` returns an x402 **payment pointer**. |
| `GET /health` · `/.well-known/mcp.json` · `/.well-known/agent-card.json` · `/skill.md` | free | health + agent discovery + the installable skill (no data). |

## Try it free (3 calls per wallet)
Add `?wallet=0xYourAddress` to any route for **3 free full results**, so you can evaluate quality before paying. After 3,
that wallet pays via x402.
```bash
curl "https://xsignal-production.up.railway.app/intent?addr=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&min_confidence=0.5&wallet=0xYourAddr"
```
Then run the example — a **watchlist alerter** that surfaces only the tokens confidently moving (and stays quiet on the rest):
```bash
WALLET=0xYourAddr node examples/watchlist-alerter.js
```

## Pay with x402 (beyond the free probe)
The first post-probe request returns **HTTP 402** with an `accepts` array (price in USDC, network `base`, `payTo`). Pay
with `x402-fetch`/`x402-axios` and a funded Base wallet, resubmit with the `X-PAYMENT` header, get the result. `/intent`
is pay-first: you pay, then get a verdict **or** an honest abstain.

## Safety
**We never sign or move funds.** x402 means we *receive* USDC to `payTo`; payment is **verify-only** via a facilitator.
Signals are scored from public X posts + public DEX data — *verify before acting; not financial advice.* Confidence is a
mechanical heuristic, not a calibrated probability or a prediction.

## Config (env)
| Var | Purpose |
|---|---|
| `XSIGNAL_PAYTO` | address that receives USDC (public; no key). Default = the operator address. |
| `XSIGNAL_PRICE_USD` / `XSIGNAL_BRIEF_PRICE_USD` / `XSIGNAL_INTENT_PRICE_USD` | per-call prices (default `0.01` / `0.05` / `0.01`) |
| `XSIGNAL_PROBE_FREE` | free probe calls per wallet (default `3`) |
| `X402_NETWORK` / `FACILITATOR_URL` | `base` (mainnet CDP, needs `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`) or `base-sepolia` (keyless x402.org) |
| `X_BEARER_TOKEN` **or** `XAI_API_KEY` | live X/Grok source for `get_signal` (token intel + intent are keyless via DexScreener). No key → a labelled DEMO seed. |

## Run
```bash
npm start      # :4520
npm test       # full self-test suite (signal · tokenintel · brief · intent · x402 · sources · server)
```
Zero **runtime** deps for the core (plain Node >=18); `@coinbase/x402` is used only for CDP-facilitator auth on mainnet.
