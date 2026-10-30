import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { addressUrl, txUrl, type SupportedChainId } from '@/config'
import { shortAddress } from '@/lib/sportula'
import type { TxState } from '@/hooks/useTx'

export function Section({ index, title, subtitle, children }: { index: number; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="mono mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-xs font-medium text-accent">
          {index}
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-sm text-mute text-pretty">{subtitle}</p>
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mute">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-mute">{hint}</span> : null}
    </label>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      autoComplete="off"
      spellCheck={false}
      {...props}
      className={`h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm text-ink outline-none transition placeholder:text-mute/60 focus:border-accent disabled:opacity-50 ${props.className ?? ''}`}
    />
  )
}

export function PrimaryButton({ busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function GhostButton({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function ExternalA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  )
}

export function AddressLink({ chainId, address, full }: { chainId: SupportedChainId; address: string; full?: boolean }) {
  return (
    <ExternalA href={addressUrl(chainId, address)}>
      <span className="mono text-xs break-all">{full ? address : shortAddress(address)}</span>
    </ExternalA>
  )
}

export function TxLink({ chainId, hash }: { chainId: SupportedChainId; hash: string }) {
  return (
    <ExternalA href={txUrl(chainId, hash)}>
      <span className="mono text-xs">{shortAddress(hash)}</span>
    </ExternalA>
  )
}

export function Notice({ tone, children }: { tone: 'error' | 'warn' | 'info' | 'success'; children: ReactNode }) {
  const styles = {
    error: 'border-bad/40 bg-bad/10 text-bad',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    info: 'border-line bg-bg text-mute',
    success: 'border-good/40 bg-good/10 text-good',
  }[tone]
  const Icon = tone === 'error' ? XCircle : tone === 'success' ? CheckCircle2 : AlertTriangle
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2 rounded-xl border px-3 py-2.5 text-sm ${styles}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  )
}

/** Honest transaction status for a single transaction. */
export function TxStatus({ chainId, state, labels }: { chainId: SupportedChainId; state: TxState; labels?: { success?: ReactNode } }) {
  if (state.phase === 'idle') {
    return state.cancelled && state.error ? <Notice tone="info">{state.error}</Notice> : null
  }
  if (state.phase === 'error') {
    return (
      <div className="space-y-2">
        <Notice tone="error">{state.error}</Notice>
        {state.hash ? (
          <div className="text-xs text-mute">
            Transaction: <TxLink chainId={chainId} hash={state.hash} />
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className="space-y-1.5 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
      {state.phase === 'signing' && (
        <div className="flex items-center gap-2 text-ink">
          <Loader2 className="size-4 animate-spin text-accent" aria-hidden /> Confirm in your wallet…
        </div>
      )}
      {state.phase === 'confirming' && (
        <div className="flex items-center gap-2 text-ink">
          <Loader2 className="size-4 animate-spin text-accent" aria-hidden /> Waiting for confirmation…
        </div>
      )}
      {state.phase === 'success' && (
        <div className="flex items-center gap-2 text-good">
          <Check className="size-4" aria-hidden /> {labels?.success ?? 'Confirmed'}
        </div>
      )}
      {state.hash ? (
        <div className="text-xs text-mute">
          Transaction: <TxLink chainId={chainId} hash={state.hash} />
        </div>
      ) : null}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setFailed(true)
    }
  }
  return (
    <GhostButton type="button" onClick={() => void onClick()}>
      {copied ? <Check className="size-3.5 text-good" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : failed ? 'Copy failed, select the text' : label}
    </GhostButton>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-mute">{label}</dt>
      <dd className="min-w-0 text-right text-ink tabular-nums">{children}</dd>
    </div>
  )
}

export function NotDeployed() {
  return <Notice tone="warn">Contract not deployed on this network.</Notice>
}
