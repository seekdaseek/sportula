import { ContractFunctionRevertedError, type Abi, type Address, type Hex, type TransactionReceipt } from 'viem'
import {
  getAccount,
  getPublicClient,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'
import { MIN_MAX_FEE_PER_GAS, config, type SupportedChainId } from '@/config'
import { TxRevertedError } from './errors'

export interface FeeOverrides {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

/** Reads the current fee from the chain and floors maxFeePerGas at 20 gwei (Arc drops anything lower). */
export async function getFeeOverrides(chainId: SupportedChainId): Promise<FeeOverrides> {
  const client = getPublicClient(config, { chainId })
  let maxFee = 0n
  let priority = 0n
  try {
    const estimate = await client.estimateFeesPerGas()
    maxFee = estimate.maxFeePerGas
    priority = estimate.maxPriorityFeePerGas
  } catch {
    try {
      maxFee = await client.getGasPrice()
    } catch {
      maxFee = 0n
    }
  }
  const maxFeePerGas = maxFee > MIN_MAX_FEE_PER_GAS ? maxFee : MIN_MAX_FEE_PER_GAS
  const maxPriorityFeePerGas = priority > maxFeePerGas ? maxFeePerGas : priority
  return { maxFeePerGas, maxPriorityFeePerGas }
}

/** Asks the wallet to switch to `chainId` when it is on another network. */
export async function ensureWalletChain(chainId: SupportedChainId): Promise<Address> {
  const account = getAccount(config)
  if (!account.address) throw new Error('Connect your wallet first.')
  if (account.chainId !== chainId) await switchChain(config, { chainId })
  return account.address
}

export interface TxJob {
  chainId: SupportedChainId
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
}

export interface TxHooks {
  /** The wallet prompt is about to open. */
  onSigning?: () => void
  /** The wallet returned a hash; the transaction is now waiting to be mined. */
  onSubmitted?: (hash: Hex) => void
}

/**
 * Switches chain if needed, dry-runs the call so reverts decode with the contract ABI,
 * sends it with maxFeePerGas floored at 20 gwei, and waits for a successful receipt.
 */
export async function sendContractTx(job: TxJob, hooks: TxHooks = {}): Promise<TransactionReceipt> {
  const account = await ensureWalletChain(job.chainId)

  try {
    await simulateContract(config, {
      address: job.address,
      abi: job.abi,
      functionName: job.functionName,
      args: job.args,
      account,
      chainId: job.chainId,
    })
  } catch (error) {
    // A decoded contract revert is final. Anything else (RPC hiccup) falls through to the wallet.
    if (hasRevert(error)) throw error
  }

  const fees = await getFeeOverrides(job.chainId)
  hooks.onSigning?.()
  const hash = await writeContract(config, {
    address: job.address,
    abi: job.abi,
    functionName: job.functionName,
    args: job.args,
    chainId: job.chainId,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  hooks.onSubmitted?.(hash)

  const receipt = await waitForTransactionReceipt(config, { hash, chainId: job.chainId })
  if (receipt.status !== 'success') throw new TxRevertedError()
  return receipt
}

function hasRevert(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const walkable = error as Error & { walk?: (fn: (e: unknown) => boolean) => unknown }
  return typeof walkable.walk === 'function' && walkable.walk((e) => e instanceof ContractFunctionRevertedError) !== null
}
