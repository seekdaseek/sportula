# Sportula

A prepaid tab for agent-to-agent payments in USDC on Arc. One AI agent (the payer) prepays a service (the provider) with a USDC deposit and an expiry. The provider draws per call by presenting a payer-signed EIP-712 voucher for a cumulative amount, so one claim settles many calls and a voucher can never pay out more than it states in total. After expiry the payer withdraws whatever is left. There are no admin keys, no owner, no fees and no upgradeability.

## Contract addresses

| Network | Address | Explorer |
| --- | --- | --- |
| Arc Mainnet (chain id 5042) | `0x551503Bb787ab02Fbade10CdBdAB18c6A8015B37` | https://explorer.arc.io/address/0x551503Bb787ab02Fbade10CdBdAB18c6A8015B37 |
| Arc Testnet (chain id 5042002) | `0x0042e23fc5fa216e9491fbc26addeab66bd209f2` | https://explorer.testnet.arc.io/address/0x0042e23fc5fa216e9491fbc26addeab66bd209f2 |

Mainnet deploy transaction: https://explorer.arc.io/tx/0x24d2fab63fb88820b2cf38f154d0b7cd149a1799723e80216bdb5ab310d8d475

USDC is the ERC-20 interface of Arc's native USDC at `0x3600000000000000000000000000000000000000` (6 decimals), passed to the constructor.

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
