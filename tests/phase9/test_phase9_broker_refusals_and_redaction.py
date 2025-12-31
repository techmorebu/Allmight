import inspect
import pytest

from allmight.adapters.broker import AdapterBroker
from allmight.security.network_gate import NetworkGate
from allmight.security.redaction import redact_sensitive
from allmight.security.secrets import SecretsBoundary
from tests.phase9._net_spy import NetworkGateSpy


def _make_broker(*, declarations, network_gate):
    secrets = SecretsBoundary(allow_resolution=False)
    return AdapterBroker(network_gate=network_gate, secrets=secrets, declarations=declarations)


def _find_entrypoint(broker: AdapterBroker):
    # In this repo, AdapterBroker exposes .call(); prefer it if present.
    if hasattr(broker, "call") and callable(getattr(broker, "call")):
        return getattr(broker, "call"), "call"

    # Fallback deterministic
    candidates = []
    for name in dir(broker):
        if name.startswith("_"):
            continue
        obj = getattr(broker, name)
        if callable(obj):
            candidates.append((name, obj))
    if not candidates:
        raise AssertionError("AdapterBroker has no public callable entrypoint; update tests to match interface.")
    name, fn = sorted(candidates, key=lambda x: x[0])[0]
    return fn, name


def _call_entrypoint(fn, *, adapter_id: str, operation: str, params: dict, required_capabilities=None):
    """
    AdapterBroker.call signature (per failure output):
      (*, adapter_id: str, operation: str, required_capabilities: List[str], params: Dict[str, Any]) -> Any
    So we call keyword-only and always provide required_capabilities.
    """
    if required_capabilities is None:
        required_capabilities = []
    try:
        return fn(
            adapter_id=adapter_id,
            operation=operation,
            required_capabilities=required_capabilities,
            params=params,
        )
    except TypeError as te:
        try:
            sig = inspect.signature(fn)
        except Exception:
            sig = "<unavailable>"
        raise AssertionError(f"Failed to call broker entrypoint with required kwargs. signature={sig} err={te}") from te


def test_unknown_adapter_refused_and_redacted():
    broker = _make_broker(declarations=[], network_gate=NetworkGate(enabled=False))
    fn, fn_name = _find_entrypoint(broker)

    with pytest.raises(Exception) as e:
        _call_entrypoint(fn, adapter_id="__no_such_adapter__", operation="ANY", required_capabilities=[], params={})

    msg = str(e.value)
    assert "REFUSE" in msg.upper() or "UNKNOWN" in msg.upper()

    # Redaction invariant
    raw = "Authorization: Bearer SUPERSECRET"
    safe = redact_sensitive(raw)
    assert "authorization" not in safe.lower()
    assert "authorization" not in msg.lower()


def test_unknown_adapter_refusal_makes_no_network_attempt():
    spy = NetworkGateSpy()
    broker = _make_broker(declarations=[], network_gate=spy)
    fn, fn_name = _find_entrypoint(broker)

    with pytest.raises(Exception):
        _call_entrypoint(fn, adapter_id="__no_such_adapter__", operation="ANY", required_capabilities=[], params={})

    assert spy.call_count == 0
