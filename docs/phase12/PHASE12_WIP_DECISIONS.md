# PHASE 12 — WIP Decisions (Authoritative)

## WIP Item 1
- Path: docs/_quarantine/phase12_tests/tests_phase12/test_market_snapshot_multi.py
- What: Early draft tests for Phase 12 multi-source snapshot orchestration
- Why quarantined:
  - Missing fixture: broker
  - Phase 12 execution surface not yet finalized
  - pytest.ini discovery locked to /tests (quarantine prevents accidental execution)
- Phase 11 contract alignment: ✅ Intent aligns (reconciliation must reuse Phase 11 primitives)
- Standards alignment: 🔧 Needs refactor (must not assume missing fixtures; must be deterministic and broker-boundary compliant)
- Decision: 🔧 Refactor and adopt (rewrite tests using a broker test-double that stubs AdapterBroker.call)
- Follow-up:
  - Rewrite tests into tests/phase12/ using a deterministic `AdapterBroker.__new__` + stubbed `.call`
  - Implement AdapterBroker.market_snapshot_multi(...) in allmight/adapters/broker.py
  - Delete or archive quarantine directory after tests pass and Phase 12 is active

