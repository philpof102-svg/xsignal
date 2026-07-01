# Upstream PR drafts — distribution (copied from MainStreet's proven playbook)

Ready-to-paste content to get xsignal listed in third-party framework docs + ecosystem lists. Each is a self-contained
PR. The npm package `@rakshasar/xsignal` (+ `/tools` adapters) is the enabler — publish it first (see below), then these PRs
land one-line integrations in each framework. Submission = Phil (PRs to third-party public repos).

## 0. Publish the package (unlocks everything else)
- `npm publish --access public` (needs Phil's npm login / `NPM_TOKEN`), OR push a `v0.2.0` tag → `.github/workflows/publish.yml`
  runs tests → npm publish → `mcp-publisher login github-oidc` → publish (updates the MCP Registry entry with the npm package,
  so xsignal lists as an INSTALLABLE `npx @rakshasar/xsignal xsignal-mcp`, not just a remote).
- Then the installable-MCP surfaces auto/near-auto index it: Smithery (`smithery mcp publish …/mcp`), mcp.so (web form),
  Glama / PulseMCP (auto-ingest from the MCP Registry).

## 1. LangChain JS — community tools
**Repo:** `langchain-ai/langchainjs` → `libs/langchain-community/src/tools/`. **PR:** `community: add xsignal Base-token signal tools`
```ts
// libs/langchain-community/src/tools/xsignal.ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { langchain } from '@rakshasar/xsignal/tools';
export function getXsignalTools(opts?: { wallet?: string }) {
  return langchain(opts).map(s => new DynamicStructuredTool({
    name: s.name, description: s.description, schema: s.schema,
    func: async (a) => JSON.stringify(await s.func(a)),
  }));
}
```

## 2. LlamaIndex TS — `packages/llamaindex/src/tools/`
```ts
// packages/llamaindex/src/tools/xsignal.ts
import { FunctionTool } from 'llamaindex';
import { specs, execute } from '@rakshasar/xsignal/tools';
export function getXsignalTools(opts?: { wallet?: string }) {
  return specs().map(s => FunctionTool.from(
    async (a) => JSON.stringify(await execute(s.name, a, opts)),
    { name: s.name, description: s.description, parameters: s.parameters },
  ));
}
```

## 3. Vercel AI SDK — `examples/`
PR adds `examples/xsignal-token-scout/` showing an agent that reads a Base token's abstaining momentum verdict before acting.
```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { vercelAiSdk } from '@rakshasar/xsignal/tools';
const { text } = await generateText({
  model: openai('gpt-4o-mini'),
  tools: vercelAiSdk({ wallet: process.env.XSIGNAL_WALLET }),
  prompt: 'Is 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed gaining momentum with confidence >= 0.7? If it abstains, skip it.',
});
```

## 4. awesome-x402 lists
**Repos:** `xpaysh/awesome-x402` + `Merit-Systems/awesome-x402` → "Production Implementations / live endpoints".
> **xsignal** — pay-per-call data ingredients for Base agents. Flagship `get_intent`: the only x402 signal that ABSTAINS
> below your confidence bar instead of guessing. MCP + npm (`@rakshasar/xsignal`), 3 free calls per wallet, from $0.01 USDC.
> https://xsignal-production.up.railway.app · https://github.com/philpof102-svg/xsignal

## 5. Bankr Skills
Package prepared in `bankr/` (catalog.json + submit instructions). Fork `BankrBot/skills`, drop in `xsignal/`, PR.

## 6. x402 Bazaar (auto)
No submission — the CDP Facilitator catalogs xsignal on its first SETTLED mainnet payment (needs `X402_NETWORK=base` +
`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` on Railway + one funded payment). The 402 `resource` is already the full callable URL.
