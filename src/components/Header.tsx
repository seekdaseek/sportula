import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { NETWORKS } from '@/config'
import { shortAddress } from '@/lib/sportula'
import { useNetwork } from '@/network'
import { AddressLink, GhostButton, Notice } from './ui'

export function Header() {
  const { chainId, network, sportula, connected, walletOnSelected, walletChainId, select, switchWallet, switching, switchError } = useNetwork()

  return (
    <header className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="display text-2xl font-semibold text-ink">Sportula</h1>
          <p className="text-sm text-mute">Prepaid USDC tabs for agent-to-agent payments on Arc.</p>
        </div>
        <ConnectKitButton.Custom>
          {({ show, isConnected, address }) => (
            <button
              type="button"
              onClick={show}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:border-accent"
            >
              <Wallet className="size-4 text-accent" aria-hidden />
              {isConnected && address ? <span className="mono text-xs">{shortAddress(address)}</span> : 'Connect'}
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-3">
        <div role="radiogroup" aria-label="Network" className="grid grid-cols-2 gap-1 rounded-xl bg-bg p-1">
          {NETWORKS.map((n) => {
            const active = n.id === chainId
            return (
              <button
                key={n.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={switching}
                onClick={() => void select(n.id)}
                className={`h-9 rounded-lg text-sm font-medium transition disabled:opacity-60 ${
                  active ? 'bg-accent text-bg' : 'text-mute hover:text-ink'
                }`}
              >
                {n.name}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 px-1 text-xs text-mute">
          <span>Contract</span>
          {sportula ? <AddressLink chainId={chainId} address={sportula} /> : <span className="text-warn">Not deployed on {network.name}</span>}
        </div>
      </div>

      {connected && !walletOnSelected ? (
        <Notice tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Your wallet is on {walletChainId === undefined ? 'another network' : (NETWORKS.find((n) => n.id === walletChainId)?.name ?? `chain ${String(walletChainId)}`)}. Transactions need {network.name}.
            </span>
            <GhostButton type="button" onClick={() => void switchWallet()} disabled={switching}>
              Switch wallet
            </GhostButton>
          </div>
        </Notice>
      ) : null}
      {switchError ? <Notice tone="error">{switchError}</Notice> : null}
    </header>
  )
}
