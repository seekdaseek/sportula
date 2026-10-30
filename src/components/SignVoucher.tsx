import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { hashTypedData, isAddressEqual, type Hex } from 'viem'
import { readContract, signTypedData } from 'wagmi/actions'
import { config } from '@/config'
import { useTab } from '@/hooks/useTab'
import { describeError } from '@/lib/errors'
import { SPORTULA_ABI, VOUCHER_TYPES, fmtUsdc, parseTabId } from '@/lib/sportula'
import { ensureWalletChain } from '@/lib/tx'
import { parseUsdc } from '@/onchain-money'
import { useNetwork } from '@/network'
import { CopyButton, Field, NotDeployed, Notice, PrimaryButton, Section, TextInput } from './ui'

interface Result {
  json: string
  digestOk: boolean | undefined
}

export function SignVoucher({ defaultTabId }: { defaultTabId?: bigint }) {
  const { chainId, sportula, account, connected } = useNetwork()
  const [tabInput, setTabInput] = useState(defaultTabId === undefined ? '' : String(defaultTabId))
  const [amountInput, setAmountInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<Result | undefined>()

  const tabId = parseTabId(tabInput)
  const { tab, found } = useTab(chainId, tabId)

  let amount: bigint | undefined
  try {
    amount = amountInput === '' ? undefined : parseUsdc(amountInput)
  } catch {
    amount = undefined
  }

  const warnings: string[] = []
  if (tab && found && amount !== undefined) {
    if (account && !isAddressEqual(tab.payer, account)) {
      warnings.push('Your connected wallet is not the payer of this tab, so the contract will reject this voucher.')
    }
    if (amount > tab.deposit) warnings.push(`This amount is more than the ${fmtUsdc(tab.deposit)} USDC deposited, so it cannot be claimed.`)
    if (amount <= tab.claimed) warnings.push(`${fmtUsdc(tab.claimed)} USDC was already claimed. A new voucher must be higher than that.`)
  }
  if (tabId !== undefined && tab && !found) warnings.push('This tab does not exist on the selected network.')

  const sign = async () => {
    if (!sportula || tabId === undefined || amount === undefined) return
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      const signer = await ensureWalletChain(chainId)
      const message = { tabId, cumulativeAmount: amount }
      const domain = { name: 'Sportula', version: '1', chainId, verifyingContract: sportula } as const
      const signature: Hex = await signTypedData(config, {
        account: signer,
        domain,
        types: VOUCHER_TYPES,
        primaryType: 'Voucher',
        message,
      })

      // Cross-check what we signed against the contract's own digest before showing it.
      const local = hashTypedData({ domain, types: VOUCHER_TYPES, primaryType: 'Voucher', message })
      let digestOk: boolean | undefined
      try {
        const onchain = await readContract(config, {
          address: sportula,
          abi: SPORTULA_ABI,
          functionName: 'voucherDigest',
          args: [tabId, amount],
          chainId,
        })
        digestOk = typeof onchain === 'string' && onchain.toLowerCase() === local.toLowerCase()
      } catch {
        digestOk = undefined
      }

      const voucher = {
        chainId,
        contract: sportula,
        tabId: Number.isSafeInteger(Number(tabId)) ? Number(tabId) : String(tabId),
        cumulativeAmount: String(amount),
        signature,
      }
      setResult({ json: JSON.stringify(voucher, null, 2), digestOk })
    } catch (e) {
      setError(describeError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const ready = tabId !== undefined && amount !== undefined && amount > 0n

  return (
    <Section
      index={3}
      title="Sign a voucher"
      subtitle="Payer only. Signs a cumulative amount for the provider to claim. No transaction is sent and it costs no gas."
    >
      {!sportula ? (
        <NotDeployed />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tab id">
              <TextInput inputMode="numeric" value={tabInput} onChange={(e) => setTabInput(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1" />
            </Field>
            <Field label="Cumulative amount (USDC)" hint="Total owed so far, not just this call.">
              <TextInput inputMode="decimal" value={amountInput} onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
            </Field>
          </div>

          {amountInput !== '' && amount === undefined ? <Notice tone="error">Enter a USDC amount with up to 6 decimals.</Notice> : null}
          {warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
          {error ? <Notice tone="error">{error}</Notice> : null}

          {connected ? (
            <PrimaryButton type="button" busy={busy} disabled={!ready} onClick={() => void sign()}>
              {busy ? 'Confirm in your wallet…' : 'Sign voucher'}
            </PrimaryButton>
          ) : (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <PrimaryButton type="button" onClick={show}>
                  Connect wallet
                </PrimaryButton>
              )}
            </ConnectKitButton.Custom>
          )}

          {result ? (
            <div className="space-y-3">
              {result.digestOk === false ? (
                <Notice tone="warn">
                  The digest computed here does not match the contract&apos;s voucherDigest for this tab and amount. Do not use this voucher; check the network and contract address.
                </Notice>
              ) : result.digestOk === undefined ? (
                <Notice tone="warn">Could not reach the contract to double-check the digest. Verify the voucher before sending it.</Notice>
              ) : (
                <Notice tone="success">Digest matches the contract&apos;s voucherDigest.</Notice>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-mute">Voucher</span>
                <CopyButton text={result.json} label="Copy JSON" />
              </div>
              <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-bg p-3 text-xs text-ink">
                {result.json}
              </pre>
              <p className="text-xs text-mute">Send this JSON to the provider. It stays valid until the tab expires, and only the highest amount matters.</p>
            </div>
          ) : null}
        </>
      )}
    </Section>
  )
}
