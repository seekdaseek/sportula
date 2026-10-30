import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, decodeErrorResult, type Hex } from 'viem'
import { SPORTULA_ABI, fmtUsdc, formatDateTime } from './sportula'

export interface DescribedError {
  message: string
  /** True when the user dismissed the wallet prompt; not an error worth shouting about. */
  cancelled: boolean
}

/** Thrown when a transaction was mined but reverted. */
export class TxRevertedError extends Error {
  constructor() {
    super('The transaction was mined but reverted.')
    this.name = 'TxRevertedError'
  }
}

const big = (args: readonly unknown[] | undefined, i: number): bigint => {
  const v = args?.[i]
  return typeof v === 'bigint' ? v : 0n
}

const tab = (args: readonly unknown[] | undefined) => `tab #${String(big(args, 0))}`

type Formatter = (args: readonly unknown[] | undefined) => string

/** Plain-language text for every custom error in Sportula.sol. */
const CONTRACT_ERRORS: Record<string, Formatter> = {
  ZeroUSDC: () => 'The contract was configured without a USDC address.',
  ZeroProvider: () => 'Provider cannot be the zero address.',
  ZeroAmount: () => 'Amount must be greater than zero.',
  ProviderIsPayer: () => 'Provider must be a different address than the payer.',
  InvalidExpiry: () => 'Expiry must be in the future.',
  UnexpectedReceivedAmount: (a) =>
    `The contract received ${fmtUsdc(big(a, 1))} USDC instead of ${fmtUsdc(big(a, 0))} USDC, so the deposit was refused.`,
  TabNotFound: (a) => `${capitalize(tab(a))} does not exist on this network.`,
  NotProvider: (a) => `Only the provider of ${tab(a)} can claim from it. Connect the provider wallet.`,
  TabExpired: (a) => `${capitalize(tab(a))} expired on ${formatDateTime(big(a, 1))}. Claims are closed and the payer can withdraw.`,
  TabClosed: (a) => `${capitalize(tab(a))} is closed.`,
  NotIncreasing: (a) =>
    `This voucher authorizes ${fmtUsdc(big(a, 1))} USDC in total, but ${fmtUsdc(big(a, 2))} USDC was already claimed on ${tab(a)}. A voucher must be higher than what was claimed.`,
  ExceedsDeposit: (a) =>
    `This voucher authorizes ${fmtUsdc(big(a, 1))} USDC, which is more than the ${fmtUsdc(big(a, 2))} USDC deposited in ${tab(a)}.`,
  InvalidSignature: (a) => `The signature is not valid for ${tab(a)}. It must be signed by the payer of that tab for the same amount.`,
  NotPayer: (a) => `Only the payer of ${tab(a)} can withdraw. Connect the payer wallet.`,
  NotYetExpired: (a) => `${capitalize(tab(a))} has not expired yet. The payer can withdraw after ${formatDateTime(big(a, 1))}.`,
  AlreadyWithdrawn: (a) => `${capitalize(tab(a))} was already withdrawn and is closed.`,
  ReentrancyGuardReentrantCall: () => 'The contract rejected a re-entrant call.',
  SafeERC20FailedOperation: () => 'The USDC transfer failed. Check your USDC balance and the approval, then try again.',
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function decodeRevertData(data: Hex): string | undefined {
  try {
    const decoded = decodeErrorResult({ abi: SPORTULA_ABI, data })
    const format = CONTRACT_ERRORS[decoded.errorName]
    return format ? format(decoded.args) : undefined
  } catch {
    return undefined
  }
}

/** Walks the error cause chain looking for ABI-encoded revert data. */
function findRevertData(error: unknown): Hex | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 12 && current && typeof current === 'object'; depth++) {
    const data = (current as { data?: unknown }).data
    if (typeof data === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(data)) return data as Hex
    if (data && typeof data === 'object') {
      const inner = (data as { data?: unknown }).data
      if (typeof inner === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(inner)) return inner as Hex
    }
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/** Never let raw hex reach the screen. */
function scrub(text: string): string {
  return text.replace(/0x[0-9a-fA-F]{12,}/g, '…')
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof TxRevertedError) {
    return { message: 'The transaction was mined but reverted onchain. Nothing was changed.', cancelled: false }
  }

  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return { message: 'Request cancelled in your wallet.', cancelled: true }
    }

    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      const format = name ? CONTRACT_ERRORS[name] : undefined
      if (name && format) return { message: format(reverted.data?.args), cancelled: false }
      if (reverted.reason) return { message: `The contract rejected the call: ${scrub(reverted.reason)}`, cancelled: false }
    }

    const data = findRevertData(error)
    const decoded = data ? decodeRevertData(data) : undefined
    if (decoded) return { message: decoded, cancelled: false }

    const text = `${error.shortMessage} ${error.message}`.toLowerCase()
    if (text.includes('insufficient funds') || text.includes('exceeds the balance')) {
      return { message: 'Your wallet does not have enough USDC to pay for gas on this network.', cancelled: false }
    }
    if (text.includes('user rejected') || text.includes('user denied')) {
      return { message: 'Request cancelled in your wallet.', cancelled: true }
    }
    if (text.includes('chain mismatch') || text.includes('does not match the target chain')) {
      return { message: 'Your wallet is on a different network. Switch network and try again.', cancelled: false }
    }
    if (text.includes('http request failed') || text.includes('network') || text.includes('timeout')) {
      return { message: 'Network problem reaching the RPC. Check your connection and try again.', cancelled: false }
    }
    return { message: scrub(error.shortMessage || 'Something went wrong. Please try again.'), cancelled: false }
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase()
    if (lower.includes('user rejected') || lower.includes('user denied')) {
      return { message: 'Request cancelled in your wallet.', cancelled: true }
    }
    return { message: scrub(error.message), cancelled: false }
  }

  return { message: 'Something went wrong. Please try again.', cancelled: false }
}
