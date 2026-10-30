import { useCallback, useState } from 'react'
import type { Hex, TransactionReceipt } from 'viem'
import { describeError } from '@/lib/errors'
import { sendContractTx, type TxJob } from '@/lib/tx'

export type TxPhase = 'idle' | 'signing' | 'confirming' | 'success' | 'error'

export interface TxState {
  phase: TxPhase
  hash?: Hex
  error?: string
  /** Set when the user dismissed the wallet prompt. */
  cancelled?: boolean
  receipt?: TransactionReceipt
}

const IDLE: TxState = { phase: 'idle' }

/** Tracks one transaction through wallet prompt, confirmation and result using real states only. */
export function useTx() {
  const [state, setState] = useState<TxState>(IDLE)

  const run = useCallback(async (job: TxJob): Promise<TransactionReceipt | undefined> => {
    setState({ phase: 'signing' })
    try {
      const receipt = await sendContractTx(job, {
        onSigning: () => setState({ phase: 'signing' }),
        onSubmitted: (hash) => setState({ phase: 'confirming', hash }),
      })
      setState({ phase: 'success', hash: receipt.transactionHash, receipt })
      return receipt
    } catch (error) {
      const described = describeError(error)
      setState((prev) => ({
        phase: described.cancelled ? 'idle' : 'error',
        hash: prev.hash,
        error: described.message,
        cancelled: described.cancelled,
      }))
      return undefined
    }
  }, [])

  const reset = useCallback(() => setState(IDLE), [])

  return { state, run, reset, busy: state.phase === 'signing' || state.phase === 'confirming' }
}
