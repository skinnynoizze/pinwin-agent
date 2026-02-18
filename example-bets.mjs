/**
 * Example: Bettor bets history from the Azuro bets subgraph (Polygon).
 * Displays the raw subgraph response (status, result, isRedeemable, isRedeemed, etc.).
 *
 * Usage:
 *   node example-bets.mjs
 *
 * Env (optional):
 *   BETTOR_ADDRESS  – Bettor address (0x...), lowercase used for query
 *
 * If BETTOR_ADDRESS is not set, the script will prompt for an address.
 * Loads .env from the current working directory if present (via dotenv).
 */

import 'dotenv/config'
import { createInterface } from 'readline'

const BETS_SUBGRAPH_URL = 'https://thegraph.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3'

const BETTOR_BETS_QUERY = `
query BettorBets($where: V3_Bet_filter!, $first: Int, $orderBy: V3_Bet_orderBy, $orderDirection: OrderDirection) {
  v3Bets(where: $where, first: $first, orderBy: $orderBy, orderDirection: $orderDirection) {
    betId
    status
    result
    isRedeemable
    isRedeemed
    amount
    payout
    createdBlockTimestamp
    resolvedBlockTimestamp
  }
}
`

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask (prompt, envKey) {
  const env = envKey ? process.env[envKey] : null
  if (env != null && env !== '') return Promise.resolve(env)
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim()))
  })
}

async function main () {
  console.log('--- Bettor bets (Polygon bets subgraph) ---\n')

  const addressRaw = await ask('Bettor address 0x... (or set BETTOR_ADDRESS): ', 'BETTOR_ADDRESS')
  const bettor = addressRaw.startsWith('0x') ? addressRaw.toLowerCase() : ('0x' + addressRaw).toLowerCase()
  if (!bettor || bettor.length < 42) {
    console.error('A valid 0x address is required.')
    rl.close()
    process.exit(1)
  }

  const variables = {
    where: { bettor },
    first: 50,
    orderBy: 'createdBlockTimestamp',
    orderDirection: 'desc',
  }

  console.log('\nQuerying bets subgraph...\n')

  const res = await fetch(BETS_SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: BETTOR_BETS_QUERY, variables }),
  })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    console.error('HTTP', res.status, data)
    rl.close()
    process.exit(1)
  }
  if (data.errors) {
    console.error('GraphQL errors:', JSON.stringify(data.errors, null, 2))
    rl.close()
    process.exit(1)
  }

  console.log(JSON.stringify(data, null, 2))
  rl.close()
}

main().catch((err) => {
  console.error(err)
  rl.close()
  process.exit(1)
})
