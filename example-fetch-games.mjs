/**
 * Fetch prematch games from Azuro data-feed. Outputs JSON (stdout) for AI/scripts.
 * Uses @azuro-org/dictionaries for market/selection names.
 *
 * Usage: node example-fetch-games.mjs [first] [sportSlug] [countrySlug] [orderBy]
 *   first       = number of games (default 5, max 50)
 *   sportSlug   = optional, e.g. "football"
 *   countrySlug = optional, e.g. "germany"
 *   orderBy     = optional: "turnover" (default) or "startsAt"
 * Loads .env from the current working directory if present (via dotenv).
 */

import 'dotenv/config'
import { getMarketName, getSelectionName } from '@azuro-org/dictionaries'

const ENDPOINT = 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-polygon'

const QUERY = `
  query PrematchGames($first: Int!, $where: Game_filter!, $orderBy: Game_orderBy!, $orderDirection: OrderDirection!) {
    games(first: $first, where: $where, orderBy: $orderBy, orderDirection: $orderDirection) {
      gameId
      title
      startsAt
      league { name }
      country { name }
      sport { name }
      participants { name }
      conditions {
        state
        outcomes { outcomeId currentOdds }
      }
    }
  }
`

function enrichOutcome(outcome) {
  try {
    return {
      marketName: getMarketName({ outcomeId: outcome.outcomeId }),
      selectionName: getSelectionName({ outcomeId: outcome.outcomeId }),
      currentOdds: outcome.currentOdds,
    }
  } catch {
    return { marketName: '?', selectionName: '?', currentOdds: outcome.currentOdds }
  }
}

function gameToJson(game) {
  const markets = []
  for (const cond of game.conditions || []) {
    if (cond.state !== 'Active') continue
    const outcomes = (cond.outcomes || []).map(enrichOutcome)
    if (outcomes.length === 0) continue
    markets.push({
      market: outcomes[0].marketName,
      outcomes: outcomes.map((o) => ({ selection: o.selectionName, odds: o.currentOdds })),
    })
  }
  return {
    gameId: game.gameId,
    title: game.title,
    participants: (game.participants || []).map((p) => p.name),
    league: game.league?.name ?? null,
    country: game.country?.name ?? null,
    sport: game.sport?.name ?? null,
    startsAt: new Date(Number(game.startsAt) * 1000).toISOString(),
    markets,
  }
}

async function main() {
  const [,, firstArg, sportSlug, countrySlug, orderByArg] = process.argv
  const first = Math.min(Number(firstArg) || 5, 50)
  const orderBy = (orderByArg === 'startsAt') ? 'startsAt' : 'turnover'
  const orderDirection = orderBy === 'startsAt' ? 'asc' : 'desc'

  const where = { state: 'Prematch' }
  if (sportSlug) where.sport_ = { slug: sportSlug }
  if (countrySlug) where.country_ = { slug: countrySlug }

  const variables = { first, where, orderBy, orderDirection }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables }),
  })
  if (!res.ok) {
    console.error('Fetch failed:', res.status, await res.text())
    process.exit(1)
  }
  const json = await res.json()
  if (json.errors) {
    console.error('GraphQL errors:', json.errors)
    process.exit(1)
  }
  const games = json.data?.games ?? []
  console.log(JSON.stringify({ games: games.map(gameToJson) }, null, 0))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
