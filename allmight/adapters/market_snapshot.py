from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Optional


@dataclass(frozen=True)
class MarketSnapshot:
    """Normalized internal market snapshot.

    Canonical fields (stable):
    - pair: exchange-native or normalized symbol string
    - price: last/spot price as float (canonical merge field)
    - ts_unix: observation timestamp (seconds since epoch)
    - source: adapter-defined source identifier

    Compatibility fields (Phase 12+):
    - bid/ask/last: quote-style inputs sometimes returned by adapters/tests.
      If price is not provided, we derive it from last, else mid(bid, ask).
    """

    pair: str

    # Canonical merge field
    price: Optional[float] = None

    # Quote-style compatibility (optional)
    bid: Optional[float] = None
    ask: Optional[float] = None
    last: Optional[float] = None

    ts_unix: int = 1
    source: str = "unknown"

    def __post_init__(self) -> None:
        def _to_f(x):
            if x is None:
                return None
            try:
                x = float(x)
            except Exception:
                return None
            if not isfinite(x):
                return None
            return x

        bid = _to_f(self.bid)
        ask = _to_f(self.ask)
        last = _to_f(self.last)
        price = _to_f(self.price)

        # Derive canonical price if missing
        if price is None:
            if last is not None and last > 0:
                price = last
            elif bid is not None and ask is not None and bid > 0 and ask > 0 and bid <= ask:
                price = (bid + ask) / 2.0

        # Persist derived values
        if self.price is None and price is not None:
            object.__setattr__(self, "price", price)

        if self.last is None and price is not None:
            object.__setattr__(self, "last", price)

        # ts_unix: force int >= 1 (tests should not depend on current time)
        try:
            ts = int(self.ts_unix)
        except Exception:
            ts = 1
        if ts <= 0:
            ts = 1
        if ts != self.ts_unix:
            object.__setattr__(self, "ts_unix", ts)

        # source: non-empty
        src = self.source if self.source is not None else ""
        if str(src).strip() == "":
            object.__setattr__(self, "source", "unknown")
