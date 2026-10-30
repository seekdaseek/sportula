import type { Abi, Address } from 'viem'
import metadata from '../../contracts/contract-metadata/Sportula.json'
import { formatUsdc } from '@/onchain-money'

/** ABI of the deployed contract, straight from contracts/contract-metadata/Sportula.json. */
export const SPORTULA_ABI = metadata.abi as Abi

export const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'tabId', type: 'uint256' },
    { name: 'cumulativeAmount', type: 'uint256' },
  ],
} as const

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'
const UINT256_MAX = (1n << 256n) - 1n

export interface TabData {
  payer: Address
  provider: Address
  deposit: bigint
  claimed: bigint
  expiry: bigint
  withdrawn: boolean
}

/** Converts the tab(tabId) result into a typed object. Unknown tabs come back as all zeros. */
export function toTab(raw: unknown): TabData | undefined {
  if (!Array.isArray(raw) || raw.length < 6) return undefined
  const [payer, provider, deposit, claimed, expiry, withdrawn] = raw as unknown[]
  if (
    typeof payer !== 'string' ||
    typeof provider !== 'string' ||
    typeof deposit !== 'bigint' ||
    typeof claimed !== 'bigint' ||
    typeof expiry !== 'bigint' ||
    typeof withdrawn !== 'boolean'
  ) {
    return undefined
  }
  return { payer: payer as Address, provider: provider as Address, deposit, claimed, expiry, withdrawn }
}

export function tabExists(tab: TabData): boolean {
  return tab.payer !== ZERO_ADDRESS
}

/** Parses a tab id typed by the user: digits only, within uint256. */
export function parseTabId(input: string): bigint | undefined {
  const value = input.trim()
  if (!/^\d{1,78}$/.test(value)) return undefined
  const id = BigInt(value)
  return id <= UINT256_MAX ? id : undefined
}

/** USDC (6 decimals) with at least two fraction digits, for display. */
export function fmtUsdc(raw: bigint): string {
  const text = formatUsdc(raw)
  const [whole, fraction = ''] = text.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function formatDateTime(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString()
}

/** "1h 02m 03s" style countdown for a positive number of seconds. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  if (d > 0) return `${String(d)}d ${two(h)}h ${two(m)}m`
  if (h > 0) return `${String(h)}h ${two(m)}m ${two(sec)}s`
  if (m > 0) return `${String(m)}m ${two(sec)}s`
  return `${String(sec)}s`
}
