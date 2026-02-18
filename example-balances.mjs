/**
 * Example: Check balance for Polygon native gas token (POL) and USDT bet token.
 *
 * Usage:
 *   node example-balances.mjs
 *
 * Env (optional):
 *   POLYGON_RPC_URL  – Polygon RPC (default: https://poly.api.pocket.network)
 *   BETTOR_ADDRESS  – Wallet address to check (0x...)
 *
 * If BETTOR_ADDRESS is not set, the script will prompt for an address.
 * Loads .env from the current working directory if present (via dotenv).
 */

import 'dotenv/config'
import { createInterface } from 'readline'
import { createPublicClient, http, parseAbi } from 'viem'
import { polygon } from 'viem/chains'

const BET_TOKEN = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f' // USDT on Polygon, 6 decimals
const USDT_DECIMALS = 6

const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
])

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask (prompt, envKey) {
  const env = envKey ? process.env[envKey] : null
  if (env != null && env !== '') return Promise.resolve(env)
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim()))
  })
}

function formatPol (wei) {
  return Number(wei) / 1e18
}

function formatUsdt (raw) {
  return Number(raw) / 10 ** USDT_DECIMALS
}

async function main () {
  console.log('--- Test 1: POL and USDT balances (Polygon) ---\n')

  const rpcUrl = await ask('Polygon RPC URL (or set POLYGON_RPC_URL): ', 'POLYGON_RPC_URL')
  const effectiveRpc = rpcUrl || 'https://poly.api.pocket.network'

  const addressRaw = await ask('Wallet address 0x... (or set BETTOR_ADDRESS): ', 'BETTOR_ADDRESS')
  const address = addressRaw.startsWith('0x') ? addressRaw : '0x' + addressRaw
  if (!address || address.length < 42) {
    console.error('A valid 0x address is required.')
    rl.close()
    process.exit(1)
  }

  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(effectiveRpc),
  })

  console.log('\nChecking balances for', address, '...\n')

  const [polBalance, usdtBalance] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: BET_TOKEN,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
  ])

  console.log('POL (native gas token):')
  console.log('  raw:', polBalance.toString())
  console.log('  formatted:', formatPol(polBalance), 'POL')
  console.log('')
  console.log('USDT (bet token):')
  console.log('  raw:', usdtBalance.toString())
  console.log('  formatted:', formatUsdt(usdtBalance), 'USDT')
  console.log('')

  const polZero = polBalance === 0n
  const usdtZero = usdtBalance === 0n
  if (polZero && usdtZero) {
    console.log('Done: both balances are zero (fresh wallet).')
  } else {
    console.log('Result: POL zero =', polZero, ', USDT zero =', usdtZero)
  }

  rl.close()
}

main().catch((err) => {
  console.error(err)
  rl.close()
  process.exit(1)
})
