import { useMemo } from 'react'
import { useReadContract } from 'wagmi'
import { SPORTULA_ADDRESS, type SupportedChainId } from '@/config'
import { SPORTULA_ABI, tabExists, toTab, type TabData } from '@/lib/sportula'

export const TAB_REFRESH_MS = 5000

/** Reads tab(tabId) on the selected network and refreshes it every few seconds. */
export function useTab(chainId: SupportedChainId, tabId: bigint | undefined) {
  const address = SPORTULA_ADDRESS[chainId]
  const enabled = address !== undefined && tabId !== undefined

  const query = useReadContract({
    address,
    abi: SPORTULA_ABI,
    functionName: 'tab',
    args: tabId === undefined ? undefined : [tabId],
    chainId,
    query: { enabled, refetchInterval: TAB_REFRESH_MS },
  })

  const tab: TabData | undefined = useMemo(() => (query.data === undefined ? undefined : toTab(query.data)), [query.data])

  return {
    tab,
    found: tab !== undefined && tabExists(tab),
    loading: enabled && query.isLoading,
    refreshing: query.isFetching,
    error: query.isError,
    refetch: query.refetch,
  }
}
