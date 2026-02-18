/**
 * Example: Check USDT allowance for betting (bettor → relayer on Polygon).
 * First time: allowance is 0; user must approve before placing a bet.
 *
 * Usage:
 *   node example-allowance.mjs
 *
 * Env (optional):
 *   POLYGON_RPC_URL  – Polygon RPC (default: https://poly.api.pocket.network)
 *   BETTOR_ADDRESS  – Wallet address (bettor) to check (0x...)
 *
 * If BETTOR_ADDRESS is not set, the script will prompt for an address.
 * Loads .env from the current working directory if present (via dotenv).
 */

import 'dotenv/config'
import { createInterface } from 'readline'
import { createPublicClient, http, parseAbi } from 'viem'
import { polygon } from 'viem/chains'

const RELAYER = '0x8dA05c0021e6b35865FDC959c54dCeF3A4AbBa9d'
const BET_TOKEN = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f' // USDT on Polygon, 6 decimals
const USDT_DECIMALS = 6

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
])

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask (prompt, envKey) {
  const env = envKey ? process.env[envKey] : null
  if (env != null && env !== '') return Promise.resolve(env)
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim()))
  })
}

function formatUsdt (raw) {
  return Number(raw) / 10 ** USDT_DECIMALS
}

async function main () {
  console.log('--- Test 2: USDT allowance for betting (bettor → relayer) ---\n')

  const rpcUrl = await ask('Polygon RPC URL (or set POLYGON_RPC_URL): ', 'POLYGON_RPC_URL')
  const effectiveRpc = rpcUrl || 'https://poly.api.pocket.network'

  const addressRaw = await ask('Wallet address 0x... (or set BETTOR_ADDRESS): ', 'BETTOR_ADDRESS')
  const bettor = addressRaw.startsWith('0x') ? addressRaw : '0x' + addressRaw
  if (!bettor || bettor.length < 42) {
    console.error('A valid 0x address is required.')
    rl.close()
    process.exit(1)
  }

  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(effectiveRpc),
  })

  console.log('\nChecking allowance(bettor, relayer) for USDT ...')
  console.log('  bettor:', bettor)
  console.log('  relayer:', RELAYER)
  console.log('  bet token:', BET_TOKEN)
  console.log('')

  const allowance = await publicClient.readContract({
    address: BET_TOKEN,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [bettor, RELAYER],
  })

  console.log('Allowance (how much relayer may spend on your behalf):')
  console.log('  raw:', allowance.toString())
  console.log('  formatted:', formatUsdt(allowance), 'USDT')
  console.log('')

  if (allowance === 0n) {
    console.log('Result: No allowance — first time / not approved. User must sign approve(relayer, amount) before placing a bet.')
  } else {
    console.log('Result: Already approved. Relayer may spend up to the amount above (no approve needed for bets within this limit).')
  }

  rl.close()
}

main().catch((err) => {
  console.error(err)
  rl.close()
  process.exit(1)
})
