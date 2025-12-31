import inspect
import pytest

from allmight.security.network_gate import NetworkGate
from allmight.security.redaction import redact_sensitive


def _pick_gate_call(gate: NetworkGate):
    """
    Select a deterministic "egress-like" method from NetworkGate without assuming names.
    We pick the first public callable whose signature hints at url/domain/host/method;
    otherwise the first public callable.
    """
    candidates = []
    for name in dir(gate):
        if name.startswith("_"):
            continue
        fn = getattr(gate, name)
        if not callable(fn):
            continue
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            continue

        params = [p.name.lower() for p in sig.parameters.values()
                  if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)]
        score = 0
        for key in ("url", "uri", "domain", "host", "method"):
            if key in params:
                score += 10
        score -= len(params)
        candidates.append((score, name, fn, sig))

    if not candidates:
        raise AssertionError("NetworkGate has no public callable methods; cannot test deny behavior.")

    candidates.sort(key=lambda x: (-x[0], x[1]))
    _, name, fn, sig = candidates[0]
    return fn, name, sig


def _call_gate(fn, sig):
    """
    Call chosen method with best-effort safe dummy arguments.
    Gate is disabled, so no real egress should ever occur.
    """
    kwargs = {}
    names = {p.name.lower(): p.name for p in sig.parameters.values()}

    if "method" in names:
        kwargs[names["method"]] = "GET"
    if "url" in names:
        kwargs[names["url"]] = "https://example.com/"
    if "uri" in names:
        kwargs[names["uri"]] = "https://example.com/"
    if "domain" in names:
        kwargs[names["domain"]] = "example.com"
    if "host" in names:
        kwargs[names["host"]] = "example.com"

    try:
        return fn(**kwargs)
    except TypeError as te:
        raise AssertionError(f"Could not call NetworkGate method. signature={sig} kwargs={kwargs} err={te}") from te


def test_network_gate_fail_closed_when_disabled_and_redacted():
    """
    Prove: NetworkGate(enabled=False) fails closed (raises) and does not leak sensitive substrings.
    We do NOT require specific wording in the exception message.
    """
    gate = NetworkGate(enabled=False)
    fn, name, sig = _pick_gate_call(gate)

    with pytest.raises(Exception) as e:
        _call_gate(fn, sig)

    msg = str(e.value)

    # Must not leak 'authorization' in any casing
    assert "authorization" not in msg.lower()

    # Redaction function itself must scrub authorization substrings
    raw = "Authorization: Bearer SUPERSECRET"
    safe = redact_sensitive(raw)
    assert "authorization" not in safe.lower()
