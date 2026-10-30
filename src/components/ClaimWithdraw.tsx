import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useQueryClient } from '@tanstack/react-query'
import { isAddress, isAddressEqual, parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem'
import { getNetwork } from '@/config'
import { useNow } from '@/hooks/useNow'
import { useTab } from '@/hooks/useTab'
import { useTx } from '@/hooks/useTx'
import { SPORTULA_ABI, fmtUsdc, formatDuration, parseTabId } from '@/lib/sportula'
import { useNetwork } from '@/network'
import { Field, NotDeployed, Notice, PrimaryButton, Section, TextInput, TxStatus } from './ui'

interface Voucher {
  tabId: bigint
  cumulativeAmount: bigint
  signature: Hex
}

type ParseResult = { voucher: Voucher; error?: undefined } | { voucher?: undefined; error: string }

function parseVoucher(text: string, chainId: number, sportula: Address): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'That is not valid JSON. Paste the voucher exactly as the payer copied it.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'A voucher is a JSON object.' }
  const v = data as Record<string, unknown>

  const voucherChain = Number(v.chainId)
  if (!Number.isInteger(voucherChain)) return { error: 'The voucher has no valid chainId.' }
  if (voucherChain !== chainId) {
    const other = getNetwork(voucherChain)?.name ?? `chain ${String(voucherChain)}`
    const current = getNetwork(chainId)?.name ?? `chain ${String(chainId)}`
    return { error: `This voucher is for ${other}, but ${current} is selected. Switch the network above.` }
  }

  if (typeof v.contract !== 'string' || !isAddress(v.contract, { strict: false })) {
    return { error: 'The voucher has no valid contract address.' }
  }
  if (!isAddressEqual(v.contract, sportula)) {
    return { error: 'This voucher is for a different Sportula contract than the one on this network.' }
  }

  const rawTab = typeof v.tabId === 'number' ? String(v.tabId) : v.tabId
  const tabId = typeof rawTab === 'string' ? parseTabId(rawTab) : undefined
  if (tabId === undefined) return { error: 'The voucher has no valid tabId.' }

  const rawAmount = typeof v.cumulativeAmount === 'number' ? String(v.cumulativeAmount) : v.cumulativeAmount
  if (typeof rawAmount !== 'string' || !/^\d{1,78}$/.test(rawAmount)) {
    return { error: 'cumulativeAmount must be a whole number of base units (6 decimals) written as a string.' }
  }
  const cumulativeAmount = BigInt(rawAmount)
  if (cumulativeAmount === 0n) return { error: 'cumulativeAmount must be greater than zero.' }

  if (typeof v.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(v.signature)) {
    return { error: 'The signature must be a 65-byte hex string starting with 0x.' }
  }
  return { voucher: { tabId, cumulativeAmount, signature: v.signature as Hex } }
}

function amountFromReceipt(receipt: TransactionReceipt | undefined, sportula: Address, eventName: 'Claimed' | 'Withdrawn'): bigint | undefined {
  if (!receipt) return undefined
  const log = parseEventLogs({ abi: SPORTULA_ABI, logs: receipt.logs, eventName }).find((l) => isAddressEqual(l.address, sportula))
  if (!log) return undefined
  const args = log.args as unknown as { paid?: bigint; amount?: bigint }
  return eventName === 'Claimed' ? args.paid : args.amount
}

function ConnectButton() {
  return (
    <ConnectKitButton.Custom>
      {({ show }) => (
        <PrimaryButton type="button" onClick={show}>
          Connect wallet
        </PrimaryButton>
      )}
    </ConnectKitButton.Custom>
  )
}

function Claim() {
  const { chainId, sportula, connected } = useNetwork()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const tx = useTx()
  const parsed = sportula && text.trim() !== '' ? parseVoucher(text, chainId, sportula) : undefined
  const voucher = parsed?.voucher
  const { tab, found } = useTab(chainId, voucher?.tabId)

  const claim = async () => {
    if (!sportula || !voucher) return
    const receipt = await tx.run({
      chainId,
      address: sportula,
      abi: SPORTULA_ABI,
      functionName: 'claim',
      args: [voucher.tabId, voucher.cumulativeAmount, voucher.signature],
    })
    if (receipt) void queryClient.invalidateQueries({ queryKey: ['readContract'] })
  }

  const paid = amountFromReceipt(tx.state.receipt, sportula ?? '0x', 'Claimed')
  const pending = voucher && tab && found ? voucher.cumulativeAmount - tab.claimed : undefined

  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg p-4">
      <h3 className="text-sm font-semibold text-ink">Claim (provider)</h3>
      <Field label="Voucher JSON" hint="Paste the voucher the payer sent you. You must be connected as the tab's provider.">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder='{"chainId": 5042002, "contract": "0x…", "tabId": 1, "cumulativeAmount": "1000000", "signature": "0x…"}'
          className="mono w-full rounded-xl border border-line bg-surface p-3 text-xs text-ink outline-none transition placeholder:text-mute/60 focus:border-accent"
        />
      </Field>
      {parsed?.error ? <Notice tone="error">{parsed.error}</Notice> : null}
      {voucher ? (
        <p className="text-sm text-mute">
          Tab #{String(voucher.tabId)}, cumulative {fmtUsdc(voucher.cumulativeAmount)} USDC
          {pending !== undefined && pending > 0n ? <> (you would receive {fmtUsdc(pending)} USDC)</> : null}.
        </p>
      ) : null}
      {connected ? (
        <PrimaryButton type="button" busy={tx.busy} disabled={!voucher} onClick={() => void claim()}>
          Claim from tab
        </PrimaryButton>
      ) : (
        <ConnectButton />
      )}
      <TxStatus
        chainId={chainId}
        state={tx.state}
        labels={{ success: paid !== undefined ? `Claimed. You received ${fmtUsdc(paid)} USDC.` : 'Claimed' }}
      />
    </div>
  )
}

function Withdraw({ defaultTabId }: { defaultTabId?: bigint }) {
  const { chainId, sportula, account, connected } = useNetwork()
  const queryClient = useQueryClient()
  const now = useNow()
  const [input, setInput] = useState(defaultTabId === undefined ? '' : String(defaultTabId))
  const tx = useTx()
  const tabId = parseTabId(input)
  const { tab, found, loading } = useTab(chainId, tabId)

  let reason: string | undefined
  if (tabId === undefined) reason = 'Enter a tab id.'
  else if (loading || !tab) reason = 'Loading tab…'
  else if (!found) reason = `Tab #${String(tabId)} does not exist on this network.`
  else if (tab.withdrawn) reason = 'This tab was already withdrawn.'
  else if (now < Number(tab.expiry)) reason = `Not expired yet. Withdraw opens in ${formatDuration(Number(tab.expiry) - now)}.`
  else if (account && !isAddressEqual(tab.payer, account)) reason = 'Only the payer of this tab can withdraw. Connect the payer wallet.'

  const withdraw = async () => {
    if (!sportula || tabId === undefined) return
    const receipt = await tx.run({ chainId, address: sportula, abi: SPORTULA_ABI, functionName: 'withdraw', args: [tabId] })
    if (receipt) void queryClient.invalidateQueries({ queryKey: ['readContract'] })
  }

  const refunded = amountFromReceipt(tx.state.receipt, sportula ?? '0x', 'Withdrawn')

  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg p-4">
      <h3 className="text-sm font-semibold text-ink">Withdraw (payer)</h3>
      <Field label="Tab id" hint="After expiry, the unclaimed balance returns to the payer and the tab closes.">
        <TextInput inputMode="numeric" value={input} onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1" />
      </Field>
      {connected ? (
        <PrimaryButton type="button" busy={tx.busy} disabled={reason !== undefined} onClick={() => void withdraw()}>
          Withdraw remaining USDC
        </PrimaryButton>
      ) : (
        <ConnectButton />
      )}
      {connected && reason ? <p className="text-xs text-mute">{reason}</p> : null}
      <TxStatus
        chainId={chainId}
        state={tx.state}
        labels={{ success: refunded !== undefined ? `Withdrawn. ${fmtUsdc(refunded)} USDC returned to you.` : 'Withdrawn' }}
      />
    </div>
  )
}

export function ClaimWithdraw({ defaultTabId }: { defaultTabId?: bigint }) {
  const { sportula } = useNetwork()
  return (
    <Section index={4} title="Claim and withdraw" subtitle="The provider draws with a voucher before expiry. The payer recovers what is left after expiry.">
      {!sportula ? (
        <NotDeployed />
      ) : (
        <>
          <Claim />
          <Withdraw defaultTabId={defaultTabId} />
        </>
      )}
    </Section>
  )
}
