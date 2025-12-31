import pytest

from allmight.adapters.broker import AdapterBroker
from allmight.security.secrets import SecretsBoundary
from allmight.security.redaction import redact_sensitive
from tests.phase9._net_spy import NetworkGateSpy


def _make_broker(declarations, *, gate):
    return AdapterBroker(
        network_gate=gate,
        secrets=SecretsBoundary(allow_resolution=False),
        declarations=declarations,
    )


def test_live_capability_not_yet_accepted_by_broker_contract():
    """
    Phase 9 contract:
    - Introduce MARKET_DATA_HTTP_READ_LIVE (new capability).
    Current state (pre-implementation):
    - Broker enforces MARKET_DATA_HTTP_READ for market reads.
    This test intentionally defines the expected Phase 9 behavior shift.

    For now, we assert that requesting LIVE capability is refused (fail-closed).
    Later, after implementing Phase 9 allowlist scaffolding, this test will be UPDATED
    (or replaced) to require LIVE capability for live reads.
    """
    broker = _make_broker(declarations=[], gate=NetworkGateSpy())
    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="__no_such_adapter__",
            operation="market_snapshot_live",
            required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
            params={"pair": "BTC-USD"},
        )

    msg = str(e.value)
    # deny/refuse signal required (wording not strict, but must be fail-closed)
    assert msg
    assert "authorization" not in msg.lower()


def test_phase9_allowlist_contract_placeholder_expected_to_fail_until_implemented():
    """
    This is the Phase 9 allowlist contract (tests-first).

    Once implemented, the system must:
    - refuse domains not explicitly allowlisted for (adapter, capability, domain)
    - default deny
    - no network calls on deny paths
    - explicit denial reason in the exception message (redacted)

    This test is expected to FAIL until Phase 9 allowlist scaffolding exists.
    """
    # We use a spy gate to prove "no network attempt" on deny.
    spy = NetworkGateSpy()

    # No declarations means broker will refuse early; to truly test allowlist later,
    # this will be updated to use the Phase 9 snapshot adapter declaration.
    broker = _make_broker(declarations=[], gate=spy)

    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="phase9_http_snapshot",
            operation="market_snapshot_live",
            required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
            params={"pair": "BTC-USD", "domain": "api.not-allowlisted.example"},
        )

    msg = str(e.value)

    # Future requirement: explicit allowlist denial code must exist.
    # We choose the exact token now so implementation is deterministic.
    assert "DENY_NOT_ALLOWLISTED_DOMAIN" in msg

    # No network attempt on deny
    assert spy.call_count == 0

    # Redaction invariant remains true
    raw = "Authorization: Bearer SUPERSECRET"
    safe = redact_sensitive(raw)
    assert "authorization" not in safe.lower()
    assert "authorization" not in msg.lower()
