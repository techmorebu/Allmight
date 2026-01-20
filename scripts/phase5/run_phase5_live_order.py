from __future__ import annotations

import argparse
from scripts.phase7.audit_event import emit_phase5_audit
from typing import Optional

from scripts.phase5.adapters.coinbase_spot_live_v0 import CoinbaseSpotLiveV0
from scripts.phase5.live_envelope import LiveDeny
from scripts.phase6.arming_guard import require_recent_arming, ArmingDeny


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Phase 5: capped live order CLI (gated).")
    ap.add_argument("--symbol", required=True, help='Example: "BTC/USD"')
    ap.add_argument("--side", required=True, choices=["buy", "sell"])
    ap.add_argument("--usd-notional", required=True, type=float)
    ap.add_argument("--max-usd-notional", default=5.0, type=float)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ack", default=None)
    ap.add_argument("--i-acknowledge-live-risk", action="store_true")
    return ap.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    adapter = CoinbaseSpotLiveV0()

    action = adapter.build_action(
        action="PLACE_ORDER_MARKET",
        payload={"symbol": args.symbol, "side": args.side, "usd_notional": float(args.usd_notional)},
    )

    # Phase 6 safety latch: require recent arming ceremony record (fail-closed)
    try:
        _ = require_recent_arming()
    except ArmingDeny as e:
        print(f"DENY: {e.code} :: {e.message}")
        return 2

    try:
        out = adapter.execute(
            action,
            ack=args.ack,
            i_acknowledge_flag=bool(args.i_acknowledge_live_risk),
            max_usd_notional=float(args.max_usd_notional),
            dry_run=bool(args.dry_run),
        )
        emit_phase5_audit(
    event="PHASE5_ORDER_RESULT",
    adapter_id=adapter.adapter_id,
    action="PLACE_ORDER_MARKET",
    result=str(out.get("status", "OK")) if isinstance(out, dict) else "OK",
    payload={"order": out.get("order")} if isinstance(out, dict) and "order" in out else None,
)
print(out)
        return 0
    except LiveDeny as e:
        print(f"DENY: {e.code} :: {e.message}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
