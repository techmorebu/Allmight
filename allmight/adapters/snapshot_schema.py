from __future__ import annotations

from dataclasses import fields
from typing import Any, Iterable

from allmight.adapters.market_snapshot import MarketSnapshot


def _canon_pair(x: object) -> str:
    return str(x).upper().replace("/", "-").replace("_", "-").strip()


# Canonical schema = MarketSnapshot dataclass fields (single source of truth)
_FIELD_NAMES = {f.name for f in fields(MarketSnapshot)}


# Alias candidates you might see from adapters. We only map aliases that
# exist in the current MarketSnapshot schema.
# NOTE: This is intentionally conservative. Add aliases when adapters prove they need them.
_ALIAS_MAP: list[tuple[str, str]] = [
    ("symbol", "pair"),
    ("market", "pair"),
    ("product_id", "pair"),
    ("instrument", "pair"),
    ("timestamp", "ts"),
    ("time", "ts"),
    ("t", "ts"),
    # price-ish aliases (only applied if canonical fields exist)
    ("best_bid", "bid"),
    ("best_ask", "ask"),
    ("bid_px", "bid"),
    ("ask_px", "ask"),
    ("last_px", "last"),
    ("price", "price"),
]


def _apply_aliases(d: dict[str, Any]) -> dict[str, Any]:
    out = dict(d)
    for src, dst in _ALIAS_MAP:
        if src in out and dst not in out and dst in _FIELD_NAMES:
            out[dst] = out[src]
    return out


def _dict_to_ms(d: dict[str, Any], *, pair: str, source: str | None) -> MarketSnapshot | None:
    dd = _apply_aliases(d)

    # ensure pair/source if those fields exist in schema
    if "pair" in _FIELD_NAMES and "pair" not in dd:
        dd["pair"] = pair
    if source is not None and "source" in _FIELD_NAMES and "source" not in dd:
        dd["source"] = source

    kwargs = {k: v for k, v in dd.items() if k in _FIELD_NAMES}
    try:
        return MarketSnapshot(**kwargs)
    except Exception:
        return None


def _extract_dictish(obj: Any) -> Iterable[dict[str, Any]]:
    if obj is None:
        return []
    if isinstance(obj, dict):
        return [obj]
    if isinstance(obj, (list, tuple)):
        out: list[dict[str, Any]] = []
        for item in obj:
            out.extend(list(_extract_dictish(item)))
        return out
    return []


def coerce_market_snapshot(raw: Any, *, pair: str, source: str | None = None) -> list[MarketSnapshot]:
    """Best-effort coercion of common adapter return shapes into MarketSnapshot objects."""
    if raw is None:
        return []

    if isinstance(raw, MarketSnapshot):
        return [raw]

    # common wrappers
    if isinstance(raw, dict):
        for k in ("snapshot", "snap", "market_snapshot", "result", "data"):
            if k in raw:
                return coerce_market_snapshot(raw[k], pair=pair, source=source)
        if "snapshots" in raw:
            return coerce_market_snapshot(raw["snapshots"], pair=pair, source=source)

    out: list[MarketSnapshot] = []
    for d in _extract_dictish(raw):
        ms = _dict_to_ms(d, pair=pair, source=source)
        if ms is not None:
            out.append(ms)
    return out


def validate_market_snapshot(ms: MarketSnapshot, *, pair: str) -> bool:
    """Schema-driven validation. Only enforces invariants that match the current schema."""
    want = _canon_pair(pair)

    # pair check if schema has it (or if object has it)
    got = None
    for attr in ("pair", "symbol"):
        if hasattr(ms, attr):
            v = getattr(ms, attr)
            if v:
                got = _canon_pair(v)
                break
    if got is not None and got != want:
        return False

    # Numeric invariants ONLY if these fields exist
    def _get(name: str):
        return getattr(ms, name, None)

    bid = _get("bid")
    ask = _get("ask")
    last = _get("last")

    # If schema includes these, enforce them. If schema does not include them, don't invent rules.
    if "bid" in _FIELD_NAMES or "ask" in _FIELD_NAMES or "last" in _FIELD_NAMES:
        if bid is None or ask is None or last is None:
            return False
        try:
            if bid <= 0 or ask <= 0 or last <= 0:
                return False
            if bid > ask:
                return False
        except Exception:
            return False

    return True
