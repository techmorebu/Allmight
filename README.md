# Project AllMight

AllMight is a modular crypto arbitrage and yield engine designed to:

- Talk to multiple DEXes and chains
- Map and normalize their data schemas
- Run arbitrage and yield strategies across CEX/DEX/L2 environments
- Eventually power a fully automated, GPU-backed “ATM” for passive income

This repo currently focuses on **Phase 0** of the architecture: introspection, data mapping, and fetcher skeletons.

---

## Project Structure (Phase 0 Focus)

- `hardhat.config.js`  
  Hardhat configuration for Solidity `0.8.20` with networks:
  - Ethereum mainnet
  - Sepolia
  - Polygon
  - zkSync

- `scripts/`  
  Phase 0 scripts:
  - `universal-field-mapper.js` – Introspects DEX APIs and writes field mappings.
  - `cross-reference-fields.js` – Checks which required fields each API exposes.
  - `master-fetcher.js` – Central runner for data fetchers, storing results in Redis (or a mock).
  - `phase0_smoke_test.js` – Orchestrates mapper → xref → fetcher as a single health check.

- `utils/`
  - `redis-client.js` – Redis client with safe fallback to a mock client if Redis is unavailable.

- `data-collection/masterFetcher/`
  - `testFetcher.js` – Dummy fetcher used to validate Phase 0 wiring.

- `outputs/`
  - Generated JSON/CSV/HTML field mappings.
  - `field-matching-report.json` summarizing required-field coverage by API.

---

## Prerequisites

- Git
- Node.js (recommended via `nvm`)
  - `18.x` is the current baseline (see `.nvmrc`)
- npm
- (Optional for full runtime) Redis server

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/techmorebu/Allmight.git
cd Allmight
