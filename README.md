# Sportula

A prepaid tab for agent-to-agent payments in USDC on Arc. A payer prepays a provider, the provider draws per call using payer-signed vouchers, and whatever is unused can be recovered by the payer after the tab expires.

The web app is a single page that works on Arc Testnet and Arc Mainnet. From a connected wallet you can open a tab, look up any tab, sign a voucher as the payer, and claim or withdraw. Mainnet shows "Contract not deployed on this network" until its address is set in `src/config.ts`.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- Solidity 0.8.28, OpenZeppelin, Foundry (contract and tests)
- Vite, React, TypeScript, Tailwind, wagmi, viem, ConnectKit (app)

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
bun run dev          # start the app
bun run check        # lint and typecheck
bunx vite build      # static production build in dist/ (works from any path)
forge test           # contract tests
```

### Mainnet

After deploying Sportula to Arc Mainnet, set `SPORTULA_MAINNET_ADDRESS` in `src/config.ts`.

### Environment variables

None.
