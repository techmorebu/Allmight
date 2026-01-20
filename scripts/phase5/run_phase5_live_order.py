from __future__ import annotations

import argparse
from typing import Optional

from scripts.phase5.adapters.coinbase_spot_live_v0 import CoinbaseSpotLiveV0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Phase 5: single capped live order (Coinbase spot, gated).")
    ap.add_argument("--symbol", required=True, help='Example: "BTC/USD"')
    ap.add_argument("--side", required=True, choices=["buy", "sell"])
    ap.add_argument("--usd-notional", required=True, type=float, help="USD notional sizing (cap enforced).")
    ap.add_argument("--max-usd-notional", default=5.0, type=float, help="Hard cap (default $5).")
    ap.add_argument("--dry-run", action="store_true", help="If set, no network I/O (still logs + validates caps).")
    ap.add_argument("--ack", default=None, help="Operator acknowledgement phrase (must match envelope when not dry-run).")
    ap.add_argument("--i-acknowledge-live-risk", action="store_true", help="Required operator flag.")
    args = ap.parse_args(argv)

    adapter = CoinbaseSpotLiveV0()
    action = adapter.build_action(
        action="PLACE_ORDER_MARKET",
        payload={"symbol": args.symbol, "side": args.side, "usd_notional": float(args.usd_notional)},
    )

    out = adapter.execute(
        action,
        ack=args.ack,
        i_acknowledge_flag=bool(args.i_acknowledge_live_risk),
        max_usd_notional=float(args.max_usd_notional),
        dry_run=bool(args.dry_run),
    )
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
