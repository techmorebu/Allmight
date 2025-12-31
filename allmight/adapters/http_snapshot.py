import json
import time
from dataclasses import dataclass
from typing import Any, Dict

from allmight.security.redaction import redact_sensitive
from allmight.security.network_gate import NetworkGate


@dataclass(frozen=True)
class MarketSnapshot:
    pair: str
    price: float
    ts_unix: int
    source: str


def _validate_coinbase_ticker(pair: str, obj: Dict[str, Any]) -> MarketSnapshot:
    # Expected keys include: price, time (ISO), etc. We only require price.
    if not isinstance(obj, dict):
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_NOT_OBJECT (phase 9)."))
    if "price" not in obj:
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_MISSING_PRICE (phase 9)."))
    try:
        price = float(obj["price"])
    except Exception:
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_BAD_PRICE (phase 9)."))
    return MarketSnapshot(pair=pair, price=price, ts_unix=int(time.time()), source="coinbase_exchange")


def fetch_coinbase_spot_snapshot(
    *,
    pair: str,
    net: NetworkGate,
    adapter_id: str,
) -> Dict[str, Any]:
    """
    Phase 9: read-only public market snapshot via Coinbase Exchange public REST.
    No credentials. No retries. Network egress must go through NetworkGate.
    """
    # Coinbase uses PRODUCT-ID form like BTC-USD
    product_id = pair.upper()
    url = f"https://api.exchange.coinbase.com/products/{product_id}/ticker"

    raw = net.http_get_bytes(
        url=url,
        adapter_id=adapter_id,
        capability="MARKET_DATA_HTTP_READ_LIVE",
        timeout_s=5.0,
        max_bytes=262144,
    )

    try:
        obj = json.loads(raw.decode("utf-8", errors="strict"))
    except Exception as e:
        raise RuntimeError(redact_sensitive(f"DENY_BAD_JSON (phase 9). err={e}"))

    snap = _validate_coinbase_ticker(product_id, obj)
    return {"pair": snap.pair, "price": snap.price, "ts_unix": snap.ts_unix, "source": snap.source}
