/**
 * App configuration: supported Arc networks, the Sportula address per chain, and the wagmi config.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { defineChain, fallback, getAddress, isAddress, type Address } from 'viem'
import { injected } from 'wagmi/connectors'
import { getUsdc } from '@/onchain-facts'
import { registerChain } from './tracing'

export const ARC_TESTNET_ID = 5042002
export const ARC_MAINNET_ID = 5042
export type SupportedChainId = typeof ARC_TESTNET_ID | typeof ARC_MAINNET_ID

export const arcTestnet = defineChain({
  id: ARC_TESTNET_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://explorer.testnet.arc.io' } },
})

export const arcMainnet = defineChain({
  id: ARC_MAINNET_ID,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://explorer.arc.io' } },
})

/** Sportula on Arc Testnet (see AGENTS.md). */
export const SPORTULA_TESTNET_ADDRESS = '0x0042e23fc5fa216e9491fbc26addeab66bd209f2'

/**
 * Sportula on Arc Mainnet. If this is ever empty the app shows
 * "Contract not deployed on this network" on mainnet instead of sending any transaction.
 */
export const SPORTULA_MAINNET_ADDRESS = '0x551503Bb787ab02Fbade10CdBdAB18c6A8015B37'

function asAddress(raw: string): Address | undefined {
  return isAddress(raw, { strict: false }) ? getAddress(raw) : undefined
}

/** One Sportula address per chain; undefined means not deployed there. */
export const SPORTULA_ADDRESS: Record<SupportedChainId, Address | undefined> = {
  [ARC_TESTNET_ID]: asAddress(SPORTULA_TESTNET_ADDRESS),
  [ARC_MAINNET_ID]: asAddress(SPORTULA_MAINNET_ADDRESS),
}

export interface NetworkInfo {
  id: SupportedChainId
  name: string
  explorerUrl: string
  usdc: Address
}

function usdcFor(chainId: number): Address {
  const usdc = getUsdc(chainId)
  if (!usdc) throw new Error(`USDC is missing from the onchain facts for chain ${String(chainId)}`)
  return getAddress(usdc.address)
}

export const NETWORKS: readonly NetworkInfo[] = [
  { id: ARC_TESTNET_ID, name: 'Arc Testnet', explorerUrl: 'https://explorer.testnet.arc.io', usdc: usdcFor(ARC_TESTNET_ID) },
  { id: ARC_MAINNET_ID, name: 'Arc Mainnet', explorerUrl: 'https://explorer.arc.io', usdc: usdcFor(ARC_MAINNET_ID) },
]

export function getNetwork(chainId: number): NetworkInfo | undefined {
  return NETWORKS.find((n) => n.id === chainId)
}

export function txUrl(chainId: SupportedChainId, hash: string): string {
  const network = getNetwork(chainId)
  return `${network ? network.explorerUrl : ''}/tx/${hash}`
}

export function addressUrl(chainId: SupportedChainId, address: string): string {
  const network = getNetwork(chainId)
  return `${network ? network.explorerUrl : ''}/address/${address}`
}

/** Arc drops transactions whose maxFeePerGas is below this (20 gwei). */
export const MIN_MAX_FEE_PER_GAS = 20_000_000_000n

registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

// Reads go through the same-origin proxy first (functions/rpc/[net].js) because some browsers get 503
// from the public Arc RPC hosts on cross-origin requests; the public RPC is the fallback (also used in dev).
const SAME_ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
const readTransport = (net: 'mainnet' | 'testnet', direct: string) =>
  SAME_ORIGIN.startsWith('http') ? fallback([http(`${SAME_ORIGIN}/rpc/${net}`), http(direct)]) : http(direct)

export const config = createConfig({
  chains: [arcTestnet, arcMainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: readTransport('testnet', arcTestnet.rpcUrls.default.http[0]),
    [arcMainnet.id]: readTransport('mainnet', arcMainnet.rpcUrls.default.http[0]),
  },
})
