import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import type { Address } from 'viem'
import {
  ARC_TESTNET_ID,
  SPORTULA_ADDRESS,
  getNetwork,
  type NetworkInfo,
  type SupportedChainId,
} from '@/config'
import { describeError } from '@/lib/errors'

interface NetworkState {
  chainId: SupportedChainId
  network: NetworkInfo
  /** Sportula address on the selected network, or undefined when not deployed there. */
  sportula: Address | undefined
  account: Address | undefined
  connected: boolean
  walletChainId: number | undefined
  walletOnSelected: boolean
  select: (id: SupportedChainId) => Promise<void>
  switchWallet: () => Promise<void>
  switching: boolean
  switchError: string | undefined
}

const NetworkContext = createContext<NetworkState | null>(null)

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [chainId, setChainId] = useState<SupportedChainId>(ARC_TESTNET_ID)
  const [switchError, setSwitchError] = useState<string | undefined>()
  const { address, chainId: walletChainId, isConnected } = useAccount()
  const { switchChainAsync, isPending } = useSwitchChain()

  const switchTo = useCallback(
    async (id: SupportedChainId) => {
      setSwitchError(undefined)
      if (!isConnected || walletChainId === id) return
      try {
        await switchChainAsync({ chainId: id })
      } catch (error) {
        const described = describeError(error)
        if (!described.cancelled) setSwitchError(described.message)
      }
    },
    [isConnected, walletChainId, switchChainAsync],
  )

  const select = useCallback(
    async (id: SupportedChainId) => {
      setChainId(id)
      await switchTo(id)
    },
    [switchTo],
  )

  const switchWallet = useCallback(() => switchTo(chainId), [switchTo, chainId])

  const value = useMemo<NetworkState>(() => {
    const network = getNetwork(chainId)
    if (!network) throw new Error('Unsupported network')
    return {
      chainId,
      network,
      sportula: SPORTULA_ADDRESS[chainId],
      account: address,
      connected: isConnected,
      walletChainId,
      walletOnSelected: isConnected && walletChainId === chainId,
      select,
      switchWallet,
      switching: isPending,
      switchError,
    }
  }, [chainId, address, isConnected, walletChainId, select, switchWallet, isPending, switchError])

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}

export function useNetwork(): NetworkState {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used inside NetworkProvider')
  return ctx
}
