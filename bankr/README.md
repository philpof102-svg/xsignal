# Bankr Skills listing (ready to submit)

[Bankr Skills](https://skills.bankr.bot/) ([github.com/BankrBot/skills](https://github.com/BankrBot/skills)) is a live,
x402-native tool catalog consumed by Base/Farcaster trader-agents. It already hosts momentum/signal + watchlist-monitor
skills (`aeon-token-movers`, `aeon-monitor-runners`), so xsignal's abstaining momentum verdict is a direct thematic fit.
Listing is permissionless-ish: open a PR adding a skill folder.

## To submit (Phil — this is a PR to a third-party public repo, so it's your call)
1. Fork `BankrBot/skills` and create a branch.
2. Copy this folder's `xsignal/` into the fork's root (so the repo has `xsignal/catalog.json` + `xsignal/SKILL.md`).
3. Copy the repo-root `SKILL.md` into `xsignal/SKILL.md` (it already leads with the get_intent flagship). Keep the
   `catalog.json` provided here (validated against Bankr's schema: `schemaVersion`, `slug`, `provider`, `providerUrl`,
   `demo`, `setup`, `install.type: external`).
4. Open the PR describing xsignal: "a pay-per-call Base-token momentum verdict that ABSTAINS below the caller's confidence
   bar (the one thing no other x402 signal does); 3 free calls per wallet, then $0.01 USDC on Base; MCP + agent-card."

`install.type` is **external** because xsignal is a hosted x402 endpoint, not code that installs into Bankr — nothing of
ours runs in their repo; agents just call our URL.
