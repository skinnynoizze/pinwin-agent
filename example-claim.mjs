/**
 * Example: Claim redeemable bet payouts via Pinwin /agent/claim and viem sendTransaction.
 * Get betIds from example-bets-redeemable.mjs, then run this with BET_IDS (or prompt).
 *
 * Usage:
 *   node example-claim.mjs
 *
 * Env (optional):
 *   POLYGON_RPC_URL     – Polygon RPC URL
 *   BETTOR_PRIVATE_KEY – Wallet private key (hex, with or without 0x)
 *   BET_IDS     – Comma-separated bet ids to claim (e.g. "215843" or "215843,211524")
 *
 * If env is not set, the script will prompt for RPC URL, private key, and betIds.
 * Loads .env from the current working directory if present (via dotenv).
 */

import 'dotenv/config'
import { createInterface } from 'readline'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'

const PINWIN_CLAIM_URL = 'https://api.pinwin.xyz/agent/claim'

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

function parseBetIds (input) {
  if (!input) return []
  return input.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
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

  const betIdsInput = await ask('Bet IDs to claim, comma-separated (or set BET_IDS): ', 'BET_IDS')
  const betIds = parseBetIds(betIdsInput)
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
  console.log('Decoded payload:', { to: payload.to, chainId: payload.chainId, value: payload.value, dataLength: payload.data?.length })

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
