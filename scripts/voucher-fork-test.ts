// Fork test: a wallet-style eth_signTypedData_v4 voucher, built with the same module the app uses
// (src/lib/voucher.ts), is claimed on a local fork of Arc mainnet against the deployed Sportula.
// Run: arc-anvil --fork-url https://rpc.mainnet.arc.io --chain-id 5042 --port 8546 &
//      npx tsx scripts/voucher-fork-test.ts
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEventLogs, isAddressEqual, type Address, type Hex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { checkVoucherSigner, voucherDigestLocal, voucherTypedData } from '../src/lib/voucher'

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8546'
const SPORTULA: Address = (process.env.SPORTULA as Address) ?? '0x551503Bb787ab02Fbade10CdBdAB18c6A8015B37'
const USDC: Address = '0x3600000000000000000000000000000000000000'
const chain = defineChain({ id: 5042, name: 'Arc fork', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const abi = parseAbi([
  'function open(address provider, uint256 amount, uint64 expiry) returns (uint256)',
  'function claim(uint256 tabId, uint256 cumulativeAmount, bytes signature)',
  'function withdraw(uint256 tabId)',
  'function tab(uint256) view returns (address payer, address provider, uint256 deposit, uint256 claimed, uint64 expiry, bool withdrawn)',
  'function voucherDigest(uint256 tabId, uint256 cumulativeAmount) view returns (bytes32)',
  'error InvalidSignature(uint256 tabId)',
  'error NotIncreasing(uint256 tabId, uint256 cumulativeAmount, uint256 claimed)',
  'event Claimed(uint256 indexed tabId, address indexed provider, uint256 paid, uint256 cumulativeClaimed)',
  'event Withdrawn(uint256 indexed tabId, address indexed payer, uint256 amount)',
  'event TabOpened(uint256 indexed tabId, address indexed payer, address indexed provider, uint256 amount, uint64 expiry)',
])
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'])

// The public anvil test mnemonic, local fork only.
const MNEMONIC = 'test test test test test test test test test test test junk'
const payer = mnemonicToAccount(MNEMONIC, { addressIndex: 0 })
const provider = mnemonicToAccount(MNEMONIC, { addressIndex: 1 })
const pub = createPublicClient({ chain, transport: http(RPC) })
const walletFor = (account: typeof payer) => createWalletClient({ account, chain, transport: http(RPC) })
const GAS = { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failures++
}
const rpc = (method: string, params: unknown[]) => pub.request({ method, params } as never)
const send = async (hash: Hex) => {
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error('tx reverted ' + hash)
  return r
}

const chainId = await pub.getChainId()
check('fork reports chain id 5042', chainId === 5042, String(chainId))
const code = await pub.getCode({ address: SPORTULA })
check('Sportula bytecode present on the fork', !!code && code.length > 2000)

for (const a of [payer.address, provider.address]) await rpc('anvil_setBalance', [a, '0x' + (5n * 10n ** 18n).toString(16)])

const AMOUNT = 500_000n // 0.50 USDC
const CLAIM = 100_000n // 0.10 USDC
const now = (await pub.getBlock()).timestamp
const expiry = now + 900n

await send(await walletFor(payer).writeContract({ address: USDC, abi: erc20, functionName: 'approve', args: [SPORTULA, AMOUNT], ...GAS }))
const openReceipt = await send(await walletFor(payer).writeContract({ address: SPORTULA, abi, functionName: 'open', args: [provider.address, AMOUNT, expiry], ...GAS }))
const tabId = parseEventLogs({ abi, logs: openReceipt.logs, eventName: 'TabOpened' })[0].args.tabId
const t0 = await pub.readContract({ address: SPORTULA, abi, functionName: 'tab', args: [tabId] })
check('tab opened for payer and provider with 0.50 USDC', isAddressEqual(t0[0], payer.address) && isAddressEqual(t0[1], provider.address) && t0[2] === AMOUNT, `tab #${tabId}`)

// Wallet-style: eth_signTypedData_v4 payload, signed by the payer's key (what MetaMask does for the payer account).
const typed = voucherTypedData(chainId, SPORTULA, tabId, CLAIM)
const signature = await payer.signTypedData(typed)
const v = parseInt(signature.slice(-2), 16)
check('signature is 65 bytes with v 27 or 28 (wallet style)', signature.length === 132 && (v === 27 || v === 28), `v=${v}`)
const onchainDigest = await pub.readContract({ address: SPORTULA, abi, functionName: 'voucherDigest', args: [tabId, CLAIM] })
check("app digest equals the contract's voucherDigest", onchainDigest === voucherDigestLocal(chainId, SPORTULA, tabId, CLAIM))
check('app signer check accepts the payer signature', (await checkVoucherSigner(chainId, SPORTULA, tabId, CLAIM, signature, payer.address)).ok)

// The mistake seen live: the same voucher signed by the provider account.
const wrongSig = await provider.signTypedData(typed)
const wrong = await checkVoucherSigner(chainId, SPORTULA, tabId, CLAIM, wrongSig, payer.address)
check('app signer check rejects a voucher signed by the provider account', !wrong.ok && !!wrong.signer && isAddressEqual(wrong.signer, provider.address))
let rejected = false
try {
  await pub.simulateContract({ address: SPORTULA, abi, functionName: 'claim', args: [tabId, CLAIM, wrongSig], account: provider.address })
} catch (e) {
  rejected = String(e).includes('InvalidSignature')
}
check('contract rejects the provider-signed voucher with InvalidSignature', rejected)

// USDC is also the gas token on Arc, so compare 18-decimal native balances and add the gas back.
const nativeBefore = await pub.getBalance({ address: provider.address })
const claimReceipt = await send(await walletFor(provider).writeContract({ address: SPORTULA, abi, functionName: 'claim', args: [tabId, CLAIM, signature], ...GAS }))
const nativeAfter = await pub.getBalance({ address: provider.address })
const claimGas = claimReceipt.gasUsed * claimReceipt.effectiveGasPrice
const claimed = parseEventLogs({ abi, logs: claimReceipt.logs, eventName: 'Claimed' })[0].args
check('provider receives exactly 0.10 USDC (balance change plus gas)', nativeAfter - nativeBefore + claimGas === CLAIM * 10n ** 12n)
check('Claimed event shows paid 0.10 and cumulative 0.10', claimed.paid === CLAIM && claimed.cumulativeClaimed === CLAIM)

let replay = false
try {
  await pub.simulateContract({ address: SPORTULA, abi, functionName: 'claim', args: [tabId, CLAIM, signature], account: provider.address })
} catch (e) {
  replay = String(e).includes('NotIncreasing')
}
check('replaying the same voucher is refused (NotIncreasing)', replay)

await rpc('evm_increaseTime', [1000])
await rpc('evm_mine', [])
const pBefore = await pub.getBalance({ address: payer.address })
const wReceipt = await send(await walletFor(payer).writeContract({ address: SPORTULA, abi, functionName: 'withdraw', args: [tabId], ...GAS }))
const pAfter = await pub.getBalance({ address: payer.address })
const wGas = wReceipt.gasUsed * wReceipt.effectiveGasPrice
const withdrawn = parseEventLogs({ abi, logs: wReceipt.logs, eventName: 'Withdrawn' })[0].args
check('payer receives exactly 0.40 USDC after expiry (balance change plus gas)', pAfter - pBefore + wGas === (AMOUNT - CLAIM) * 10n ** 12n)
check('Withdrawn event shows 0.40', withdrawn.amount === AMOUNT - CLAIM)

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
