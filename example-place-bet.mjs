/**
 * Example: Fetch games → choose selection → place bet (Pinwin + Azuro order API).
 * Full flow for the sports-betting skill.
 *
 * Usage:
 *   node example-place-bet.mjs
 *
 * You can set env vars to skip prompts:
 *   POLYGON_RPC_URL, BETTOR_PRIVATE_KEY, BET_AMOUNT
 * Or pass selection via CONDITION_ID and OUTCOME_ID (and optional MIN_ODDS).
 *
 * Otherwise the script will prompt for RPC URL, private key, amount, then list games
 * and ask you to pick a game index and selection index.
 * Loads .env from the current working directory if present (via dotenv).
 */

import 'dotenv/config'
import { createInterface } from 'readline'
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, maxUint256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { getMarketName, getSelectionName } from '@azuro-org/dictionaries'

// --- Constants from skill references (polygon.md, subgraph.md, api.md) ---
const DATA_FEED_URL = 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-polygon'
const PINWIN_BET_URL = 'https://api.pinwin.xyz/agent/bet'
const RELAYER = '0x8dA05c0021e6b35865FDC959c54dCeF3A4AbBa9d'
const BET_TOKEN = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f'

const GAMES_QUERY = `
query Games($first: Int!, $where: Game_filter!, $orderBy: Game_orderBy!, $orderDirection: OrderDirection!) {
  games(first: $first, where: $where, orderBy: $orderBy, orderDirection: $orderDirection) {
    gameId
    title
    state
    startsAt
    league { name }
    country { name }
    sport { name }
    participants { name }
    conditions {
      conditionId
      state
      outcomes { outcomeId currentOdds }
    }
  }
}
`

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask (prompt, envKey, sensitive = false) {
  const env = envKey ? process.env[envKey] : null
  if (env != null && env !== '') {
    if (sensitive) console.log(prompt + ' [from ' + envKey + ']')
    return Promise.resolve(env)
  }
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim()))
  })
}

async function fetchGames (state = 'Prematch', first = 20) {
  const variables = {
    first,
    where: { state },
    orderBy: 'turnover',
    orderDirection: 'desc',
  }
  const res = await fetch(DATA_FEED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: GAMES_QUERY, variables }),
  })
  if (!res.ok) throw new Error(`Data-feed HTTP ${res.status}: ${res.statusText}`)
  const data = await res.json()
  if (data.errors) throw new Error('Data-feed errors: ' + JSON.stringify(data.errors))
  return data.data?.games ?? []
}

function getOutcomeLabels (outcomeId) {
  try {
    return {
      marketName: getMarketName({ outcomeId }),
      selectionName: getSelectionName({ outcomeId, withPoint: true }),
    }
  } catch {
    return { marketName: '?', selectionName: '?' }
  }
}

function listGamesAndSelections (games) {
  const selections = []
  games.forEach((g, gi) => {
    const activeConditions = (g.conditions || []).filter((c) => c.state === 'Active')
    activeConditions.forEach((c) => {
      (c.outcomes || []).forEach((o) => {
        const outcomeId = Number(o.outcomeId)
        const { marketName, selectionName } = getOutcomeLabels(outcomeId)
        selections.push({
          gameIndex: gi,
          gameId: g.gameId,
          title: g.title,
          conditionId: c.conditionId,
          outcomeId,
          currentOdds: o.currentOdds,
          league: g.league?.name,
          sport: g.sport?.name,
          marketName,
          selectionName,
        })
      })
    })
  })
  return selections
}

function getPrimaryType (payload) {
  if (payload.types?.ClientComboBetData) return 'ClientComboBetData'
  return 'ClientBetData'
}

function getRelayerFeeAmount (payload) {
  const cd = payload.apiClientBetData?.clientData || payload.signableClientBetData?.clientData
  const fee = cd?.relayerFeeAmount
  if (fee === undefined || fee === null) return 0n
  return BigInt(String(fee))
}

function apiBaseFromApiUrl (apiUrl) {
  const u = apiUrl.replace(/\/bet\/orders\/ordinar\/?$/, '').replace(/\/bet\/orders\/combo\/?$/, '')
  return u || apiUrl
}

async function pollOrder (apiBase, orderId, pollIntervalMs = 2000, maxAttempts = 60) {
  const url = `${apiBase}/bet/orders/${orderId}`
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Poll GET ${url} → ${res.status}`)
    const data = await res.json()
    const state = data.state
    if (state === 'Rejected' || state === 'Canceled') {
      return { success: false, ...data }
    }
    if (data.txHash) {
      return { success: true, ...data }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  throw new Error('Poll timeout: no txHash and no terminal state')
}

async function main () {
  console.log('--- Pinwin real bet test (skill flow) ---\n')

  const rpcUrl = await ask('Polygon RPC URL (or set POLYGON_RPC_URL): ', 'POLYGON_RPC_URL')
  if (!rpcUrl) {
    console.error('RPC URL required.')
    rl.close()
    process.exit(1)
  }

  const privateKeyRaw = await ask('Wallet private key (hex, or set BETTOR_PRIVATE_KEY): ', 'BETTOR_PRIVATE_KEY', true)
  const privateKey = privateKeyRaw?.startsWith('0x') ? privateKeyRaw : ('0x' + (privateKeyRaw || ''))
  if (!privateKey || privateKey.length < 66) {
    console.error('Valid private key required (64 hex chars, with or without 0x prefix).')
    rl.close()
    process.exit(1)
  }

  const amountStr = await ask('Bet amount (USDT smallest units, 6 decimals; e.g. 1000000 = 1 USDT, or set BET_AMOUNT): ', 'BET_AMOUNT')
  const amount = amountStr ? BigInt(amountStr) : 0n
  if (amount <= 0n) {
    console.error('Amount must be positive.')
    rl.close()
    process.exit(1)
  }

  console.log('\nFetching Prematch games from Azuro data-feed...')
  const games = await fetchGames('Prematch', 15)
  if (!games.length) {
    console.error('No games returned.')
    rl.close()
    process.exit(1)
  }

  const selections = listGamesAndSelections(games)
  if (!selections.length) {
    console.error('No Active conditions/outcomes in fetched games.')
    rl.close()
    process.exit(1)
  }

  let selection
  const conditionIdEnv = process.env.CONDITION_ID
  const outcomeIdEnv = process.env.OUTCOME_ID
  if (conditionIdEnv && outcomeIdEnv) {
    const outcomeId = parseInt(outcomeIdEnv, 10)
    selection = selections.find((s) => s.conditionId === conditionIdEnv && s.outcomeId === outcomeId)
    if (!selection) {
      const minOddsEnv = process.env.MIN_ODDS || '1.5'
      selection = { conditionId: conditionIdEnv, outcomeId, currentOdds: minOddsEnv }
    }
  }

  if (!selection) {
    console.log('\nFirst 20 selectable outcomes (game | market | selection | odds):')
    selections.slice(0, 20).forEach((s, i) => {
      console.log(`  [${i}] ${s.title?.slice(0, 40)} | ${s.marketName} | ${s.selectionName} | ${s.currentOdds}`)
    })
    const idxStr = await ask('\nEnter selection index (0–19) or conditionId,outcomeId: ')
    if (idxStr.includes(',')) {
      const [cid, oid] = idxStr.split(',').map((x) => x.trim())
      selection = { conditionId: cid, outcomeId: parseInt(oid, 10), currentOdds: '1.5' }
    } else {
      const idx = parseInt(idxStr, 10)
      if (Number.isNaN(idx) || idx < 0 || idx >= selections.length) {
        console.error('Invalid selection.')
        rl.close()
        process.exit(1)
      }
      selection = selections[idx]
    }
  }

  const oddsRaw = selection.currentOdds || '1'
  const oddsNum = parseFloat(oddsRaw)
  const minOdds = oddsNum >= 1e10 ? Math.round(oddsNum) : Math.round(oddsNum * 1e12)
  const betBody = {
    amount: Number(amount),
    minOdds,
    chain: 'polygon',
    selections: [{ conditionId: selection.conditionId, outcomeId: selection.outcomeId }],
  }

  console.log('\nCalling Pinwin POST /agent/bet...', JSON.stringify(betBody, null, 2))
  const pinwinRes = await fetch(PINWIN_BET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(betBody),
  })
  const pinwinBody = await pinwinRes.json().catch(() => ({}))
  if (!pinwinRes.ok) {
    console.error('Pinwin error:', pinwinRes.status, pinwinBody)
    rl.close()
    process.exit(1)
  }
  if (!pinwinBody.encoded) {
    console.error('Pinwin response missing encoded:', pinwinBody)
    rl.close()
    process.exit(1)
  }

  const payload = JSON.parse(Buffer.from(pinwinBody.encoded, 'base64').toString('utf8'))
  const account = privateKeyToAccount(privateKey)

  const publicClient = createPublicClient({ chain: polygon, transport: http(rpcUrl) })
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(rpcUrl),
  })

  const relayerFeeAmount = getRelayerFeeAmount(payload)
  const requiredAllowance = amount + relayerFeeAmount
  const currentAllowance = await publicClient.readContract({
    address: BET_TOKEN,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, RELAYER],
  })

  if (currentAllowance < requiredAllowance) {
    console.log('\nAllowance insufficient; sending approve(relayer, maxUint256)...')
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [RELAYER, maxUint256],
    })
    const hash = await walletClient.sendTransaction({
      to: BET_TOKEN,
      data: approveData,
      chain: polygon,
    })
    console.log('Approve tx:', hash)
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('Approve confirmed.')
  }

  const primaryType = getPrimaryType(payload)
  console.log('\nSigning EIP-712 (' + primaryType + ')...')
  const signature = await walletClient.signTypedData({
    account,
    domain: payload.domain,
    types: payload.types,
    primaryType,
    message: payload.signableClientBetData,
  })

  const orderBody = {
    environment: payload.environment,
    bettor: account.address.toLowerCase(),
    betOwner: account.address.toLowerCase(),
    clientBetData: payload.apiClientBetData,
    bettorSignature: signature,
  }

  console.log('POST to order API:', payload.apiUrl)
  const orderRes = await fetch(payload.apiUrl, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(orderBody),
  })
  const orderData = await orderRes.json().catch(() => ({}))

  console.log('\nOrder API response status:', orderRes.status)
  console.log('Order API response body:', JSON.stringify(orderData, null, 2))

  if (!orderRes.ok) {
    console.error('Order submission failed.')
    rl.close()
    process.exit(1)
  }

  const orderId = orderData.id
  const state = orderData.state
  if (state === 'Rejected' || state === 'Canceled') {
    console.log('\nOrder terminated immediately:', state, orderData.errorMessage || orderData.error || '')
    rl.close()
    process.exit(1)
  }

  if (!orderId) {
    console.log('\nNo order id in response; cannot poll. Response above.')
    rl.close()
    process.exit(0)
  }

  const apiBase = apiBaseFromApiUrl(payload.apiUrl)
  console.log('\nPolling GET', apiBase + '/bet/orders/' + orderId, '...')
  const pollResult = await pollOrder(apiBase, orderId)

  if (pollResult.success) {
    console.log('\n--- SUCCESS ---')
    console.log('txHash:', pollResult.txHash)
  } else {
    console.log('\n--- FAILED ---')
    console.log('state:', pollResult.state)
    console.log('errorMessage:', pollResult.errorMessage || pollResult.error)
  }

  rl.close()
}

main().catch((err) => {
  console.error(err)
  rl.close()
  process.exit(1)
})
