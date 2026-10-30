import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { isAddressEqual } from 'viem'
import { useNow } from '@/hooks/useNow'
import { useTab } from '@/hooks/useTab'
import { fmtUsdc, formatDateTime, formatDuration, parseTabId } from '@/lib/sportula'
import { useNetwork } from '@/network'
import { AddressLink, Field, GhostButton, NotDeployed, Notice, Row, Section, TextInput } from './ui'

export function TabView({ defaultTabId }: { defaultTabId?: bigint }) {
  const { chainId, sportula, account } = useNetwork()
  const [input, setInput] = useState(defaultTabId === undefined ? '' : String(defaultTabId))
  const tabId = parseTabId(input)
  const { tab, found, loading, refreshing, error, refetch } = useTab(chainId, tabId)
  const now = useNow()

  const expiry = tab ? Number(tab.expiry) : 0
  const expired = found && now >= expiry
  const remaining = tab ? tab.deposit - tab.claimed : 0n
  const role =
    tab && found && account
      ? isAddressEqual(tab.payer, account)
        ? 'You are the payer'
        : isAddressEqual(tab.provider, account)
          ? 'You are the provider'
          : undefined
      : undefined

  const status = !tab ? '' : tab.withdrawn ? 'Closed (withdrawn)' : expired ? 'Expired, payer can withdraw' : 'Active'
  const statusTone = !tab ? '' : tab.withdrawn ? 'text-mute' : expired ? 'text-warn' : 'text-good'

  return (
    <Section index={2} title="My tab" subtitle="Look up any tab by id. It refreshes every few seconds.">
      {!sportula ? (
        <NotDeployed />
      ) : (
        <>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Tab id">
                <TextInput inputMode="numeric" value={input} onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1" />
              </Field>
            </div>
            <GhostButton type="button" onClick={() => void refetch()} disabled={tabId === undefined} aria-label="Refresh tab">
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden /> Refresh
            </GhostButton>
          </div>

          {input !== '' && tabId === undefined ? <Notice tone="error">Tab id must be a whole number.</Notice> : null}
          {error ? <Notice tone="error">Could not read the tab from the network. It will retry shortly.</Notice> : null}
          {tabId !== undefined && loading && !tab ? <p className="text-sm text-mute">Loading tab…</p> : null}
          {tabId !== undefined && tab && !found ? <Notice tone="warn">Tab #{String(tabId)} does not exist on this network.</Notice> : null}

          {tab && found ? (
            <dl className="divide-y divide-line rounded-xl border border-line bg-bg px-4">
              <Row label="Status">
                <span className={statusTone}>{status}</span>
              </Row>
              {role ? <Row label="Your role">{role}</Row> : null}
              <Row label="Payer">
                <AddressLink chainId={chainId} address={tab.payer} />
              </Row>
              <Row label="Provider">
                <AddressLink chainId={chainId} address={tab.provider} />
              </Row>
              <Row label="Deposit">{fmtUsdc(tab.deposit)} USDC</Row>
              <Row label="Claimed">{fmtUsdc(tab.claimed)} USDC</Row>
              <Row label="Remaining">
                <span className="font-semibold text-accent">{fmtUsdc(remaining)} USDC</span>
              </Row>
              <Row label="Expiry">
                <div>{formatDateTime(tab.expiry)}</div>
                <div className={`text-xs ${expired ? 'text-warn' : 'text-mute'}`}>
                  {tab.withdrawn ? 'Closed' : expired ? `Expired ${formatDuration(now - expiry)} ago` : `Expires in ${formatDuration(expiry - now)}`}
                </div>
              </Row>
              <Row label="Withdrawn">{tab.withdrawn ? 'Yes' : 'No'}</Row>
            </dl>
          ) : null}
        </>
      )}
    </Section>
  )
}
