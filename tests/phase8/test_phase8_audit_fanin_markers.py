from __future__ import annotations

from pathlib import Path

def test_phase5_live_order_is_wired_to_sink() -> None:
    p = Path("scripts/phase5/run_phase5_live_order.py").read_text(encoding="utf-8")
    assert "from scripts.phase8.audit_sink import write_audit_event" in p, "Phase 5 live order CLI missing sink import"
    assert "PHASE5_LIVE_ORDER_DENY" in p, "Phase 5 live order CLI missing deny event token (fan-in not wired)"

def test_phase6_arming_ceremony_is_wired_to_sink() -> None:
    p = Path("scripts/phase6/arming_ceremony.py").read_text(encoding="utf-8")
    assert "from scripts.phase8.audit_sink import write_audit_event" in p, "Phase 6 arming ceremony missing sink import"
    # marker line added by Step D
    assert "PHASE6_ARMING_CEREMONY_SINK" in p, "Phase 6 arming ceremony missing sink marker (fan-in not wired)"
