import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { Check, Circle, Loader2, X } from 'lucide-react'
import { isAddress, isAddressEqual, parseEventLogs, type Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { getBlock, readContract } from 'wagmi/actions'
import { config } from '@/config'
import { useTx, type TxState } from '@/hooks/useTx'
import { describeError } from '@/lib/errors'
import { ERC20_APPROVE_ABI, SPORTULA_ABI, ZERO_ADDRESS, fmtUsdc, formatDateTime } from '@/lib/sportula'
import { parseUsdc } from '@/onchain-money'
import { useNetwork } from '@/network'
import { Field, Notice, NotDeployed, PrimaryButton, Section, TextInput, TxLink } from './ui'

const MAX_MINUTES = 525_600

function StepRow({ n, label, state, chainId, skipped }: { n: number; label: string; state: TxState; chainId: 5042 | 5042002; skipped?: boolean }) {
  const text = skipped
    ? 'Already approved, skipped'
    : state.phase === 'signing'
      ? 'Confirm in your wallet'
      : state.phase === 'confirming'
        ? 'Waiting for confirmation'
        : state.phase === 'success'
          ? 'Confirmed'
          : state.phase === 'error'
            ? 'Failed'
            : 'Waiting'
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="flex size-5 items-center justify-center">
        {state.phase === 'success' || skipped ? (
          <Check className="size-4 text-good" aria-hidden />
        ) : state.phase === 'error' ? (
          <X className="size-4 text-bad" aria-hidden />
        ) : state.phase === 'signing' || state.phase === 'confirming' ? (
          <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
        ) : (
          <Circle className="size-3.5 text-mute" aria-hidden />
        )}
      </span>
      <span className="text-ink">
        {n}. {label}
      </span>
      <span className="ml-auto flex items-center gap-2 text-xs text-mute">
        {text}
        {state.hash ? <TxLink chainId={chainId} hash={state.hash} /> : null}
      </span>
    </li>
  )
}

export function OpenTab({ onOpened }: { onOpened: (tabId: bigint) => void }) {
  const { chainId, network, sportula, connected } = useNetwork()
  const { address: account } = useAccount()
  const [provider, setProvider] = useState('')
  const [amount, setAmount] = useState('')
  const [minutes, setMinutes] = useState('10')
  const [formError, setFormError] = useState<string | undefined>()
  const [started, setStarted] = useState(false)
  const [approveSkipped, setApproveSkipped] = useState(false)
  const [opened, setOpened] = useState<{ tabId: bigint; expiry: bigint } | undefined>()
  const approve = useTx()
  const open = useTx()
  const busy = approve.busy || open.busy

  const balance = useReadContract({
    address: network.usdc,
    abi: ERC20_APPROVE_ABI,
    functionName: 'balanceOf',
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: account !== undefined, refetchInterval: 8000 },
  })

  const submit = async () => {
    setFormError(undefined)
    setOpened(undefined)
    if (!sportula || !account) return

    const providerText = provider.trim()
    if (!isAddress(providerText, { strict: false })) return setFormError('Enter a valid provider address.')
    const providerAddress: Address = providerText
    if (providerAddress.toLowerCase() === ZERO_ADDRESS) return setFormError('Provider cannot be the zero address.')
    if (isAddressEqual(providerAddress, account)) return setFormError('Provider must be a different address than your wallet.')

    let raw: bigint
    try {
      raw = parseUsdc(amount)
    } catch {
      return setFormError('Enter a USDC amount with up to 6 decimals, for example 5 or 0.25.')
    }
    if (raw <= 0n) return setFormError('Amount must be greater than zero.')
    if (typeof balance.data === 'bigint' && raw > balance.data) {
      return setFormError(`Your USDC balance is ${fmtUsdc(balance.data)}, which is less than ${fmtUsdc(raw)}.`)
    }
    if (!/^\d{1,6}$/.test(minutes.trim()) || Number(minutes) < 1 || Number(minutes) > MAX_MINUTES) {
      return setFormError('Expiry must be a whole number of minutes between 1 and 525,600.')
    }
    const duration = BigInt(minutes.trim()) * 60n

    setStarted(true)
    setApproveSkipped(false)
    approve.reset()
    open.reset()

    // Skip the approve transaction when the existing allowance already covers the amount.
    let allowance = 0n
    try {
      allowance = await readContract(config, {
        chainId,
        address: network.usdc,
        abi: ERC20_APPROVE_ABI,
        functionName: 'allowance',
        args: [account, sportula],
      })
    } catch {
      allowance = 0n
    }
    const skipApprove = allowance >= raw
    setApproveSkipped(skipApprove)
    if (!skipApprove) {
      const approved = await approve.run({
        chainId,
        address: network.usdc,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [sportula, raw],
      })
      if (!approved) return
    }

    // The countdown starts now, from chain time, so slow wallet prompts do not eat into it.
    let expiry: bigint
    try {
      const block = await getBlock(config, { chainId })
      expiry = block.timestamp + duration
    } catch (error) {
      return setFormError(describeError(error).message)
    }

    const receipt = await open.run({
      chainId,
      address: sportula,
      abi: SPORTULA_ABI,
      functionName: 'open',
      args: [providerAddress, raw, expiry],
    })
    if (!receipt) return

    const events = parseEventLogs({ abi: SPORTULA_ABI, logs: receipt.logs, eventName: 'TabOpened' })
    const mine = events.find((log) => isAddressEqual(log.address, sportula))
    if (!mine) return setFormError('The tab was opened, but its id could not be read from the receipt.')
    const args = mine.args as unknown as { tabId: bigint; expiry: bigint }
    setOpened({ tabId: args.tabId, expiry: args.expiry })
    onOpened(args.tabId)
  }

  return (
    <Section index={1} title="Open a tab" subtitle="Prepay a provider in USDC. Anything they do not draw before expiry comes back to you.">
      {!sportula ? (
        <NotDeployed />
      ) : (
        <>
          <Field label="Provider address">
            <TextInput value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="0x…" disabled={busy} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Amount (USDC)"
              hint={typeof balance.data === 'bigint' ? `Balance ${fmtUsdc(balance.data)} USDC` : undefined}
            >
              <TextInput
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                disabled={busy}
              />
            </Field>
            <Field label="Expires in (minutes)">
              <TextInput
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                disabled={busy}
              />
            </Field>
          </div>

          {formError ? <Notice tone="error">{formError}</Notice> : null}

          {connected ? (
            <PrimaryButton type="button" busy={busy} onClick={() => void submit()}>
              {busy ? 'Working…' : 'Approve and open tab'}
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

          {started ? (
            <>
              <ol className="divide-y divide-line rounded-xl border border-line bg-bg px-3">
                <StepRow n={1} label="Approve USDC" state={approve.state} chainId={chainId} skipped={approveSkipped} />
                <StepRow n={2} label="Open tab" state={open.state} chainId={chainId} />
              </ol>
              {approve.state.phase === 'error' ? <Notice tone="error">{approve.state.error}</Notice> : null}
              {open.state.phase === 'error' ? <Notice tone="error">{open.state.error}</Notice> : null}
              {approve.state.cancelled || open.state.cancelled ? (
                <Notice tone="info">Request cancelled in your wallet.</Notice>
              ) : null}
            </>
          ) : null}

          {opened ? (
            <Notice tone="success">
              Tab #{String(opened.tabId)} is open. It expires {formatDateTime(opened.expiry)}. The sections below are filled with this tab id.
              {open.state.hash ? (
                <>
                  {' '}
                  Transaction <TxLink chainId={chainId} hash={open.state.hash} />
                </>
              ) : null}
            </Notice>
          ) : null}
        </>
      )}
    </Section>
  )
}
