from __future__ import annotations

import argparse
import sys
from typing import Optional

from scripts.phase5.adapters.coinbase_spot_live_v0 import CoinbaseSpotLiveV0
from scripts.phase5.live_envelope import LiveDeny, assert_live_allowed, emit_live_audit_event


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Phase 5 live smoke (gated, default-deny).")
    ap.add_argument("--adapter-id", default=CoinbaseSpotLiveV0.adapter_id)
    ap.add_argument("--ack", default=None, help="Operator acknowledgement phrase (must match envelope).")
    ap.add_argument("--i-acknowledge-live-risk", action="store_true",
                    help="Required flag to proceed (must be paired with --ack phrase).")
    args = ap.parse_args(argv)

    adapter = CoinbaseSpotLiveV0()
    event = {"event": "PHASE5_LIVE_SMOKE_ATTEMPT", "adapter_id": args.adapter_id}

    # Always try to load envelope and emit an audit attempt (even if deny).
    try:
        # Enforce a second operator intent gate: flag must be present.
        if not args.i_acknowledge_live_risk:
            raise LiveDeny("E_FLAG_REQUIRED", "Missing required operator flag.", {"flag": "--i-acknowledge-live-risk"})

        env = assert_live_allowed(args.adapter_id, ack=args.ack)
        emit_live_audit_event(env, {**event, "result": "ALLOW"})

    except LiveDeny as e:
        # Best-effort audit emit if envelope can be loaded; otherwise print deny.
        try:
            from scripts.phase5.live_envelope import load_envelope
            env = load_envelope()
            emit_live_audit_event(env, {**event, "result": "DENY", "deny_code": e.code})
        except Exception:
            pass

        print(f"DENY: {e.code} :: {e.message}")
        return 2

    # Phase 5 scaffold: no exchange I/O; execute is NOOP.
    action = adapter.build_action(action="PING", payload={"note": "phase5 smoke"})
    out = adapter.execute(action)
    print("OK:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
