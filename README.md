# Pinwin agent

Skill and example scripts for Pinwin (Polygon). Does not affect the main project.

```bash
npm install
```

Scripts read env vars from the environment; if you put a `.env` file in this directory they will load it automatically (via `dotenv`). Copy `.env.example` to `.env` and fill in your values.

Example scripts (simple runnable examples that mirror the skill tasks; use env vars or prompts as needed):

| Script | Purpose |
|--------|--------|
| `example-fetch-games.mjs` | Fetch prematch games from data-feed, print list with market/selection names. Args: `[first] [sportSlug] [countrySlug] [orderBy]` (default first=5, orderBy=turnover). |
| `example-balances.mjs` | Check POL and USDT balance for an address. Env: `POLYGON_RPC_URL`, `BETTOR_ADDRESS`. |
| `example-allowance.mjs` | Check USDT allowance (bettor → relayer). Env: `POLYGON_RPC_URL`, `BETTOR_ADDRESS`. |
| `example-bets.mjs` | List all bets for a bettor (bets subgraph). Env: `BETTOR_ADDRESS`. |
| `example-bets-redeemable.mjs` | List only redeemable bets (isRedeemable: true); use to get betIds for claim. Env: `BETTOR_ADDRESS`. |
| `example-place-bet.mjs` | Full flow: fetch games → choose selection → place bet (Pinwin + viem). Either pass nothing/amount only (then picker; minOdds from subgraph) or all four: `amount conditionId outcomeId minOdds`. Env: `POLYGON_RPC_URL`, `BETTOR_PRIVATE_KEY`. |
| `example-claim.mjs` | Claim redeemable bets (Pinwin /agent/claim + viem). Run `example-bets-redeemable.mjs` first to get betIds. Pass bet IDs as args: `node example-claim.mjs 215843,211524`. Env: `POLYGON_RPC_URL`, `BETTOR_PRIVATE_KEY`. |

**Sports betting skill** (Agent Skills / OpenClaw / ClawHub): see folder `sports-betting/`. Entry point `SKILL.md`; reference details in `sports-betting/references/`. ZIP the `sports-betting` folder to package the skill.
