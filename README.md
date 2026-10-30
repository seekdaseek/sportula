# Sportula

A prepaid tab for agent-to-agent payments in USDC on Arc. One AI agent (the payer) prepays a service (the provider) with a USDC deposit and an expiry. The provider draws per call by presenting a payer-signed EIP-712 voucher for a cumulative amount, so one claim settles many calls and a voucher can never pay out more than it states in total. After expiry the payer withdraws whatever is left. There are no admin keys, no owner, no fees and no upgradeability.

## Contract addresses

| Network | Address | Explorer |
| --- | --- | --- |
| Arc Mainnet (chain id 5042) | `0x551503Bb787ab02Fbade10CdBdAB18c6A8015B37` | https://explorer.arc.io/address/0x551503Bb787ab02Fbade10CdBdAB18c6A8015B37 |
| Arc Testnet (chain id 5042002) | `0x0042e23fc5fa216e9491fbc26addeab66bd209f2` | https://explorer.testnet.arc.io/address/0x0042e23fc5fa216e9491fbc26addeab66bd209f2 |

Mainnet deploy transaction: https://explorer.arc.io/tx/0x24d2fab63fb88820b2cf38f154d0b7cd149a1799723e80216bdb5ab310d8d475

USDC is the ERC-20 interface of Arc's native USDC at `0x3600000000000000000000000000000000000000` (6 decimals), passed to the constructor.

## Mainnet proof

Real USDC on Arc Mainnet through the contract and the live app at https://sportula.pages.dev/.

- Contract (source verified, exact match): https://explorer.arc.io/address/0x551503Bb787ab02Fbade10CdBdAB18c6A8015B37
- Deploy: https://explorer.arc.io/tx/0x24d2fab63fb88820b2cf38f154d0b7cd149a1799723e80216bdb5ab310d8d475

Tab #1, opened with 0.50 USDC and recovered by the payer after expiry (the first claim attempt was refused before any transaction because the voucher had been signed by the wrong wallet account; the app now checks the signer):

- Open: https://explorer.arc.io/tx/0x42dc2538f88507a3bb7a7d1b99c32902a7ea23e7d2631bdbc0d63cf79ace6b28
- Withdraw 0.50: https://explorer.arc.io/tx/0x3b6c1f455f5b31afe0214047647c6c6caa0d6ae36ace845bc41bcb99d58847a0

Tab #2, the full cycle, 0.50 USDC deposited, 0.10 claimed with a payer-signed voucher, 0.40 withdrawn after expiry:

- Approve: https://explorer.arc.io/tx/0x7af854cfe603a6ae11d0d2669e072907153a617ba6fe61941537820ffdfaf62c
- Open: https://explorer.arc.io/tx/0x8ee57eb4a5fb830ab9f833dd209b2995517a184b261aad2c15caa17435206d52
- Claim 0.10: https://explorer.arc.io/tx/0x31b13deafc24e49ee4405526a9ae6f50c4175d49752c9a96dd447ed76c7faab6
- Withdraw 0.40: https://explorer.arc.io/tx/0x1e92a7a1f50a040726851da1f8c7f112aa1316d233d8586d729ffdee070006dd

The claim transaction's "to" is MetaMask's delegation manager, not Sportula, because MetaMask upgraded the provider account to its EIP-7702 smart account for that call; the Sportula `claim` and its `Claimed` event are inside the transaction.

## How it works

1. `open(provider, amount, expiry)`: the payer deposits USDC for one provider until a unix timestamp.
2. `claim(tabId, cumulativeAmount, signature)`: only the provider, only before expiry. The signature is the payer's EIP-712 `Voucher(uint256 tabId, uint256 cumulativeAmount)`. The provider receives the increase over what was already claimed.
3. `withdraw(tabId)`: only the payer, at or after expiry. Returns deposit minus claimed and closes the tab.

Limits worth knowing: payers must be plain wallets (EOAs), not contract wallets. Providers must claim before expiry or the payer can take the rest. If the USDC issuer ever blocklisted the contract address, claims and withdrawals would fail for every tab and a keyless contract cannot work around that.

## The app

A single page, `src/`, that works on Arc Mainnet and Arc Testnet: open a tab, look up a tab with a live countdown, sign a voucher as the payer, claim as the provider, withdraw after expiry. Every transaction links to the Arc explorer. The app defaults to Arc Mainnet.

## How Arc Studio was used

Sportula was built in [Arc Studio](https://studio.arc.io) through its CLI, in two turns of one project.

- Turn 1: Arc Studio wrote `contracts/Sportula.sol`, reviewed it in two rounds, ran Slither, wrote the Foundry tests in `contracts/test/Sportula.t.sol` (unit, fuzz and invariant tests, including reentrancy and fee-on-transfer token cases), ran them, and deployed the contract to Arc Testnet.
- Turn 2: Arc Studio built the React app in `src/` around that contract and ran its checks and production build.

What was done outside Arc Studio, because Arc Studio only deploys to testnets: the files were pulled with `arc-studio pull`; two Arc Studio template deploy scripts that import a package unavailable outside its sandbox were removed; the mainnet address and the default network were set in `src/config.ts` and `src/network.tsx`; and the contract was deployed to Arc Mainnet with Arc Foundry (`arc-forge create`) from a dedicated deploy key. The compiled runtime code of the mainnet deployment is identical to the Arc Studio testnet deployment outside the constructor's immutable values.

## Run it

Prerequisites: Node 22 or Bun, and Foundry.

```bash
bun install            # or: npm install --legacy-peer-deps
bun run dev            # start the app
bunx vite build        # static build in dist/, works from any path
forge test             # contract tests
```

## License

MIT
