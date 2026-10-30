import { useState } from 'react'
import { ClaimWithdraw } from '@/components/ClaimWithdraw'
import { Header } from '@/components/Header'
import { OpenTab } from '@/components/OpenTab'
import { SignVoucher } from '@/components/SignVoucher'
import { TabView } from '@/components/TabView'
import { NetworkProvider } from '@/network'

export default function App() {
  // When a tab is opened, the other sections remount pre-filled with its id.
  const [opened, setOpened] = useState<{ tabId: bigint; n: number } | undefined>()

  return (
    <NetworkProvider>
      <div className="min-h-dvh">
        <main className="mx-auto max-w-xl space-y-5 px-4 pb-28 pt-8">
          <Header />
          <OpenTab onOpened={(tabId) => setOpened((prev) => ({ tabId, n: (prev?.n ?? 0) + 1 }))} />
          <TabView key={`view-${String(opened?.n ?? 0)}`} defaultTabId={opened?.tabId} />
          <SignVoucher key={`sign-${String(opened?.n ?? 0)}`} defaultTabId={opened?.tabId} />
          <ClaimWithdraw key={`claim-${String(opened?.n ?? 0)}`} defaultTabId={opened?.tabId} />
        </main>
      </div>
    </NetworkProvider>
  )
}
