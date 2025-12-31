from __future__ import annotations

import re
from typing import Any


# Phase 8 redaction rules:
# - Secrets must never appear in logs/traces/receipts/exceptions/returned objects.
# - The substring 'authorization' must not survive redaction in any casing.
_PATTERNS = [
    # sk_live_... style tokens
    (re.compile(r"sk_live_[A-Za-z0-9_\-]+"), "REDACTED_SECRET"),
    # Bearer tokens
    (re.compile(r"Bearer\s+[A-Za-z0-9_\-\.]+", re.IGNORECASE), "REDACTED_BEARER_TOKEN"),
    # Authorization header lines (remove entire line content)
    (re.compile(r"authorization\s*:\s*[^\n\r]+", re.IGNORECASE), "REDACTED_AUTH_HEADER"),
]


def redact_sensitive(text: str) -> str:
    out = text
    for rx, repl in _PATTERNS:
        out = rx.sub(repl, out)

    # Belt-and-suspenders: eliminate any remaining 'authorization' token entirely.
    out = re.sub(r"authorization", "REDACTED_AUTH_TOKEN", out, flags=re.IGNORECASE)
    return out


def redact_any(obj: Any) -> Any:
    """Recursively redact secrets from common python containers."""
    if obj is None:
        return None
    if isinstance(obj, str):
        return redact_sensitive(obj)
    if isinstance(obj, bytes):
        try:
            return redact_sensitive(obj.decode("utf-8", errors="replace")).encode("utf-8")
        except Exception:
            return b"REDACTED_BYTES"
    if isinstance(obj, dict):
        return {redact_any(k): redact_any(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        red = [redact_any(v) for v in obj]
        return type(obj)(red) if not isinstance(obj, set) else set(red)
    return obj
