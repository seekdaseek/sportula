// EIP-712 voucher helpers shared by the app and the fork test (scripts/voucher-fork-test.ts).
// Pure viem, no app imports, so a plain node process can load it.
import { hashTypedData, isAddressEqual, recoverTypedDataAddress, type Address, type Hex } from 'viem'

export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'tabId', type: 'uint256' },
    { name: 'cumulativeAmount', type: 'uint256' },
  ],
} as const

/** The typed data a wallet signs with eth_signTypedData_v4; the contract uses the same domain and struct. */
export function voucherTypedData(chainId: number, contract: Address, tabId: bigint, cumulativeAmount: bigint) {
  return {
    domain: { name: 'Sportula', version: '1', chainId, verifyingContract: contract },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher' as const,
    message: { tabId, cumulativeAmount },
  } as const
}

export function voucherDigestLocal(chainId: number, contract: Address, tabId: bigint, cumulativeAmount: bigint): Hex {
  return hashTypedData(voucherTypedData(chainId, contract, tabId, cumulativeAmount))
}

export async function recoverVoucherSigner(
  chainId: number,
  contract: Address,
  tabId: bigint,
  cumulativeAmount: bigint,
  signature: Hex,
): Promise<Address | undefined> {
  try {
    return await recoverTypedDataAddress({ ...voucherTypedData(chainId, contract, tabId, cumulativeAmount), signature })
  } catch {
    return undefined
  }
}

export type SignerCheck = { ok: true } | { ok: false; signer: Address | undefined }

/** True only if the signature was made by `expectedPayer` for exactly this tab and amount. */
export async function checkVoucherSigner(
  chainId: number,
  contract: Address,
  tabId: bigint,
  cumulativeAmount: bigint,
  signature: Hex,
  expectedPayer: Address,
): Promise<SignerCheck> {
  const signer = await recoverVoucherSigner(chainId, contract, tabId, cumulativeAmount, signature)
  return signer && isAddressEqual(signer, expectedPayer) ? { ok: true } : { ok: false, signer }
}

export type ClaimState = 'claimable' | 'already-claimed' | 'exceeds-deposit' | 'not-provider'

/** What the Claim box should do for a pasted voucher, given the tab as read from the chain. */
export function claimState(
  tab: { provider: Address; deposit: bigint; claimed: bigint },
  cumulativeAmount: bigint,
  connected: Address | undefined,
): ClaimState {
  if (cumulativeAmount <= tab.claimed) return 'already-claimed'
  if (cumulativeAmount > tab.deposit) return 'exceeds-deposit'
  if (connected && !isAddressEqual(tab.provider, connected)) return 'not-provider'
  return 'claimable'
}
