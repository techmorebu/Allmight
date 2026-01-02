from dataclasses import dataclass


@dataclass(frozen=True)
class MarketSnapshot:
    """Normalized internal market snapshot.

    Fields are intentionally minimal and stable:
    - pair: exchange-native or normalized symbol string
    - price: last/spot price as float
    - ts_unix: observation timestamp (seconds since epoch)
    - source: adapter-defined source identifier
    """
    pair: str
    price: float
    ts_unix: int
    source: str
