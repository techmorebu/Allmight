# APPX_RPC_MESH_POLICY_V1

**ID:** APPX-RPC-MESH-POLICY-V1
**Status:** Active
**Derived From:** rpc_benchmark.js results — March 2026
**Approved By:** Boss ruling, March 2026
**Applies To:** provider_factory.js endpoint ordering, fetcher RPC routing
**Supersedes:** Prior informal endpoint lists in provider_factory.js

---

## 1. Purpose

This document records the provider mesh policy for AllMight fetchers,
derived from measured benchmark evidence rather than provider marketing.

The benchmark ran against all currently configured endpoints across five chains
using: eth_blockNumber latency (p50/p95/p99), representative eth_call latency,
burst/concurrency test (5 rounds × 4 concurrency), and block lag detection.

---

## 2. Policy Summary

### Provider rankings by chain

| Chain     | Primary  | Backup   | Tertiary | Reject                              |
|-----------|----------|----------|----------|-------------------------------------|
| Ethereum  | Alchemy  | Infura   | Ankr     | LlamaRPC                            |
| Arbitrum  | Infura   | —        | —        | Alchemy (lag), Ankr, arb1, LlamaRPC |
| Optimism  | Alchemy  | Infura   | —        | public mainnet.optimism.io, LlamaRPC, Ankr |
| Base      | Infura   | Alchemy  | —        | public mainnet.base.org, LlamaRPC, Ankr |
| Unichain  | Infura   | —        | —        | Alchemy (lag)                       |

---

## 3. Per-chain reasoning

### Ethereum
Alchemy performs cleanest under serial and burst load. Infura is reliable backup.
Ankr is acceptable tertiary. LlamaRPC is rejected — unreliable in tested config.

### Arbitrum (most critical chain — primary execution)
Infura is the only provider in the tested set with acceptable reliability.
Alchemy has a confirmed lag problem on Arbitrum — unsafe for primary arbitrage reads.
Ankr, arb1 public, and LlamaRPC all performed poorly.

**CRITICAL INFRASTRUCTURE GAP:** Arbitrum currently has no healthy backup provider
in the tested set. This is the highest-priority procurement target before scaling.

Recommended next procurement candidates (untested, evaluate in order):
  1. Chainstack Arbitrum
  2. dRPC Arbitrum (PAYG)
  3. QuickNode Arbitrum (if cost justifies)

Do not promote Alchemy to backup on Arbitrum until lag issue is investigated.

### Optimism
Alchemy is primary. Infura is backup. Public endpoint and LlamaRPC rejected.
Ankr borderline — exclude from critical routing for now.

### Base
Infura primary. Alchemy backup. Public endpoint and LlamaRPC rejected.
Ankr borderline — exclude from critical routing for now.

### Unichain
Infura only. Alchemy shows lag, treat as reject for now.
Low-priority chain — acceptable to have single authenticated endpoint for this phase.

---

## 4. Hardcoded public fallbacks — policy

Public fallbacks in provider_factory.js (arb1.arbitrum.io, mainnet.optimism.io,
mainnet.base.org, eth.llamarpc.com, arbitrum.llamarpc.com, optimism.llamarpc.com)
should be removed from the production config.

Rationale: the factory's EndpointHealth system will eventually demote bad endpoints,
but having them in the list at all adds unnecessary noise to every cycle before
demotion. Removing them from the ordered list is cleaner than waiting for strikes.

LlamaRPC family rejected across all chains.
Public chain RPCs (arb1, mainnet.optimism.io, mainnet.base.org) rejected.

---

## 5. 0ms latency readings — interpretation note

Some benchmark results showed 0ms p50 block readings. These are a measurement-
resolution artifact (Date.now() millisecond precision combined with very fast
responses landing in the same tick). They do not indicate literal zero-latency
transport. p95, failure counts, timeout counts, and lag remain the reliable
truth-tellers for provider evaluation.

---

## 6. env var alignment needed (deferred)

provider_factory.js currently reads _MAINNET_RPC_URL_N pattern.
The live .env stores authenticated endpoints under *_RPC_URLS comma-separated vars.
This mismatch means only public fallbacks are active in the factory for Arbitrum,
Optimism, Base, and Unichain.

The rpc_benchmark.js patch compensates for this during benchmarking.
The production fix (aligning .env and provider_factory) is a deferred cleanup task.

Priority:
  1. Add authenticated endpoint vars for Arbitrum (_MAINNET_RPC_URL_1 = Infura key)
  2. Add for Optimism (_MAINNET_RPC_URL_1 = Alchemy key)
  3. Add for Base (_MAINNET_RPC_URL_1 = Infura key)
  4. Unichain (_MAINNET_RPC_URL_1 = Infura key)

Do this before procuring additional Arbitrum provider — confirm Infura is wired
correctly into the factory first, then benchmark the expanded set.

---

## 7. Next actions

1. Wire Infura into ARBITRUM_MAINNET_RPC_URL_1 in .env (no new cost — key exists)
2. Procure one additional Arbitrum provider (Chainstack or dRPC recommended)
3. Re-run benchmark on Arbitrum with expanded set
4. Update this document with new results
5. Deferred: full .env normalization + provider_factory alignment

---

## 8. What the benchmark proved

The benchmark prevented blind provider spending and confirmed:
- Arbitrum needs procurement, not just config fixes
- Infura is the most reliable across chains in the tested set
- Alchemy's Arbitrum lag disqualifies it from primary on that chain
- Public endpoints are not acceptable for production arbitrage reads
- LlamaRPC is not viable in any role in the current tested config

Evidence over assumptions. Spend second.
