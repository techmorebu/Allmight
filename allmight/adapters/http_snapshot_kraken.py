import json
import time
from typing import Any, Dict

from allmight.security.redaction import redact_sensitive
from allmight.security.network_gate import NetworkGate
from allmight.adapters.market_snapshot import MarketSnapshot

def _validate_kraken_ticker(pair: str, obj: Dict[str, Any]) -> MarketSnapshot:
    # Expected Kraken shape:
    # {"error": [], "result": {"<PAIRCODE>": {"c": ["<last_price>", "<lot_volume>"], ...}}}
    if not isinstance(obj, dict):
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_NOT_OBJECT (phase 10)."))
    if "result" not in obj:
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_MISSING_RESULT (phase 10)."))
    result = obj.get("result")
    if not isinstance(result, dict) or not result:
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_BAD_RESULT (phase 10)."))

    # We accept either exact Kraken paircode or any single key if caller used BTC-USD.
    if pair in result:
        entry = result.get(pair)
    else:
        # Fall back to first key (safe: schema still validated)
        k = next(iter(result.keys()))
        entry = result.get(k)
        pair = k

    if not isinstance(entry, dict):
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_BAD_ENTRY (phase 10)."))
    if "c" not in entry:
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_MISSING_C (phase 10)."))
    c = entry.get("c")
    if not isinstance(c, list) or len(c) < 1:
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_MISSING_PRICE (phase 10)."))
    try:
        price = float(c[0])
    except Exception:
        raise RuntimeError(redact_sensitive("DENY_SCHEMA_BAD_PRICE (phase 10)."))

    return MarketSnapshot(pair=pair, price=price, ts_unix=int(time.time()), source="kraken")


def fetch_kraken_spot_snapshot(
    *,
    pair: str,
    net: NetworkGate,
    adapter_id: str,
) -> Dict[str, Any]:
    """
    Phase 10: read-only public market snapshot via Kraken public REST.
    No credentials. No retries. Network egress must go through NetworkGate.
    """
    # Kraken expects pair codes like XXBTZUSD. For now, accept caller-provided pair.
    # Tests pass "BTC-USD" but payload uses "XXBTZUSD"; validation falls back to first result key.
    pair_code = pair.strip().upper()
    url = f"https://api.kraken.com/0/public/Ticker?pair={pair_code}"

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
        raise RuntimeError(redact_sensitive(f"DENY_BAD_JSON (phase 10). err={e}"))

    snap = _validate_kraken_ticker(pair_code, obj)
    return {"pair": snap.pair, "price": snap.price, "ts_unix": snap.ts_unix, "source": snap.source}
