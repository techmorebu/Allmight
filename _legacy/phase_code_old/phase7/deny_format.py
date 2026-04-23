
from __future__ import annotations

def format_deny(code: str, message: str) -> str:
    return f"DENY: {code} :: {message}"

def print_deny(code: str, message: str) -> None:
    print(format_deny(code, message))

def deny_from_exc(e):
    if isinstance(e, tuple) and len(e) >= 2:
        return str(e[0]), str(e[1])
    code = getattr(e, "code", None)
    msg = getattr(e, "message", None)
    if code and msg:
        return str(code), str(msg)
    return "E_UNKNOWN", str(e)
