import pytest


def test_phase8_contract_imports_exist():
    # Contract-only: these imports define the Phase 8 public boundary surfaces.
    # They MUST exist before Phase 8 is considered complete.
    from allmight.adapters.broker import AdapterBroker  # noqa: F401
    from allmight.adapters.capabilities import Capability  # noqa: F401
    from allmight.security.network_gate import NetworkGate  # noqa: F401
    from allmight.security.secrets import SecretsBoundary  # noqa: F401
    from allmight.security.redaction import redact_sensitive  # noqa: F401


def test_broker_refuses_execute_operations_by_default():
    # Contract: any execute-like verb must be refused in Phase 8.
    from allmight.adapters.broker import AdapterBroker

    broker = AdapterBroker.for_phase8_tests()

    with pytest.raises(Exception) as e:
        broker.execute_order(adapter_id="dummy", order_intent={"side": "buy", "qty": 1})

    msg = str(e.value).lower()
    assert "refuse" in msg or "forbidden" in msg
    assert "phase 8" in msg or "prepare-only" in msg


def test_network_is_default_denied_and_visible_in_error_classification():
    # Contract: network must be default-deny; denial must be explicit (no silent fallback).
    from allmight.adapters.broker import AdapterBroker

    broker = AdapterBroker.for_phase8_tests(network_enabled=False)

    with pytest.raises(Exception) as e:
        broker.get_market_snapshot(adapter_id="dummy", symbols=["BTC-USD"])

    msg = str(e.value).lower()
    assert "network" in msg
    assert "denied" in msg or "disabled" in msg


def test_capability_mismatch_fails_closed_before_adapter_invocation():
    # Contract: broker must reject unsupported capabilities BEFORE invoking adapter code.
    from allmight.adapters.broker import AdapterBroker

    broker = AdapterBroker.for_phase8_tests()

    # ask for a capability the dummy adapter does not declare
    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="dummy",
            operation="account_read",
            required_capabilities=["ACCOUNT_READ"],
            params={},
        )

    msg = str(e.value).lower()
    assert "capability" in msg
    assert "mismatch" in msg or "not declared" in msg or "refuse" in msg


def test_secret_redaction_never_leaks_in_exception_messages():
    # Contract: secrets must not appear in exceptions. Redaction must be enforced at boundary.
    from allmight.security.redaction import redact_sensitive

    secret = "sk_live_SUPERSECRET"
    raw = f"request failed: Authorization: Bearer {secret}"
    safe = redact_sensitive(raw)

    assert secret not in safe
    assert "sk_live_" not in safe
    assert "REDACT" in safe or "***" in safe


def test_traces_and_receipts_never_contain_secret_material():
    # Contract: broker trace/receipt emission must scrub secrets even if downstream returns them.
    from allmight.adapters.broker import AdapterBroker

    broker = AdapterBroker.for_phase8_tests()

    # dummy adapter returns intentionally "toxic" content for the test
    result = broker.get_market_snapshot(adapter_id="dummy_toxic", symbols=["BTC-USD"])

    # result must be sanitized
    s = repr(result)
    assert "sk_live_" not in s
    assert "authorization" not in s.lower()
