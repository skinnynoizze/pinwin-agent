/**
 * Example: Claim redeemable bet payouts via Pinwin /agent/claim and viem sendTransaction.
 * Get betIds from example-bets-redeemable.mjs, then run with one or more bet IDs.
 *
 * Usage:
 *   node example-claim.mjs <betId> [betId ...]
 *   node example-claim.mjs <betId>,<betId>,...
 *
 * Examples:
 *   node example-claim.mjs 215843
 *   node example-claim.mjs 215843 211524
 *   node example-claim.mjs 215843,211524
 *
 * Env (optional):
 *   POLYGON_RPC_URL     – Polygon RPC URL
 *   BETTOR_PRIVATE_KEY – Wallet private key (hex, with or without 0x)
 *
 * If bet IDs are not passed as args, the script will prompt for them.
 * Loads .env from the current working directory if present (via dotenv).
 */

import 'dotenv/config'
import { createInterface } from 'readline'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'

const PINWIN_CLAIM_URL = 'https://api.pinwin.xyz/agent/claim'
/** Azuro ClientCore on Polygon (redeem won/canceled bets). Must match payload.to. */
const CLAIM_CONTRACT = '0xF9548Be470A4e130c90ceA8b179FCD66D2972AC7'

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask (prompt, envKey, sensitive = false) {
  const env = envKey ? (process.env[envKey] || '').trim() : null
  if (env != null && env !== '') {
    if (sensitive) console.log(prompt + ' [from ' + envKey + ']')
    return Promise.resolve(env)
  }
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim()))
  })
}

function parseBetIds (input) {
  if (!input) return []
  return input.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
}

function betIdsFromArgs () {
  const args = process.argv.slice(2)
  if (args.length === 0) return null
  return parseBetIds(args.join(','))
}

async function main () {
  console.log('--- Claim redeemable bets (Pinwin /agent/claim + viem) ---\n')

  const rpcUrl = await ask('Polygon RPC URL (or set POLYGON_RPC_URL): ', 'POLYGON_RPC_URL')
  if (!rpcUrl) {
    console.error('RPC URL required.')
    rl.close()
    process.exit(1)
  }

  const privateKeyRaw = await ask('Wallet private key hex (or set BETTOR_PRIVATE_KEY): ', 'BETTOR_PRIVATE_KEY', true)
  const privateKey = privateKeyRaw.startsWith('0x') ? privateKeyRaw : '0x' + privateKeyRaw
  if (!privateKey || privateKey.length < 66) {
    console.error('Valid private key required.')
    rl.close()
    process.exit(1)
  }

  let betIds = betIdsFromArgs()
  if (!betIds || betIds.length === 0) {
    const betIdsInput = await ask('Bet IDs to claim, comma-separated: ', null)
    betIds = parseBetIds(betIdsInput)
  }
  if (betIds.length === 0) {
    console.error('At least one bet ID required. Get redeemable betIds from example-bets-redeemable.mjs.')
    rl.close()
    process.exit(1)
  }

  console.log('\nCalling Pinwin POST /agent/claim...', { betIds, chain: 'polygon' })

  const claimRes = await fetch(PINWIN_CLAIM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ betIds, chain: 'polygon' }),
  })
  const claimBody = await claimRes.json().catch(() => ({}))

  if (!claimRes.ok) {
    console.error('Pinwin claim error:', claimRes.status, claimBody)
    rl.close()
    process.exit(1)
  }
  if (!claimBody.encoded) {
    console.error('Pinwin response missing encoded:', claimBody)
    rl.close()
    process.exit(1)
  }

  const payload = JSON.parse(Buffer.from(claimBody.encoded, 'base64').toString('utf8'))
  console.log('Decoded claim payload (full):', JSON.stringify(payload, null, 2))

  const toLower = (payload.to || '').toLowerCase()
  if (toLower !== CLAIM_CONTRACT.toLowerCase()) {
    console.error('Claim contract mismatch: payload.to', payload.to, '!= expected ClientCore', CLAIM_CONTRACT)
    rl.close()
    process.exit(1)
  }

  const account = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({ chain: polygon, transport: http(rpcUrl) })
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(rpcUrl),
  })

  const value = payload.value != null ? BigInt(payload.value) : 0n
  const chainId = Number(payload.chainId)

  console.log('\nSending claim tx (viem sendTransaction)...')
  const hash = await walletClient.sendTransaction({
    to: payload.to,
    data: payload.data,
    value,
    chainId,
  })
  console.log('Tx hash:', hash)

  console.log('Waiting for receipt...')
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log('\n--- SUCCESS ---')
  console.log('Block:', receipt.blockNumber)
  console.log('Status:', receipt.status)
  rl.close()
}

main().catch((err) => {
  console.error(err)
  rl.close()
  process.exit(1)
})
