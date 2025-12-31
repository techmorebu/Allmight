import pytest

from allmight.adapters.broker import AdapterBroker, AdapterDeclaration
from allmight.adapters.capabilities import Capability
from allmight.security.secrets import SecretsBoundary
from allmight.security.redaction import redact_sensitive
from allmight.security.network_gate import NetworkGate
from tests.phase9._net_spy import NetworkGateSpy


def _make_broker(declarations, *, gate):
    return AdapterBroker(
        network_gate=gate,
        secrets=SecretsBoundary(allow_resolution=False),
        declarations=declarations,  # MUST be dict[str, AdapterDeclaration]
    )


class CombinedGate:
    def __init__(self, *, allowlist_gate: NetworkGate, spy: NetworkGateSpy):
        self._allow = allowlist_gate
        self.spy = spy

    def assert_domain_allowed(self, *, adapter_id: str, capability: str, domain: str) -> None:
        return self._allow.assert_domain_allowed(adapter_id=adapter_id, capability=capability, domain=domain)

    def request(self, method: str, url: str, **kwargs):
        return self.spy.request(method, url, **kwargs)

    def get(self, url: str, **kwargs):
        return self.spy.get(url, **kwargs)


def test_phase9_allowlist_denies_non_allowlisted_domain_and_no_network():
    spy = NetworkGateSpy()
    gate = CombinedGate(allowlist_gate=NetworkGate(enabled=False), spy=spy)

    decl = AdapterDeclaration(
        adapter_id="phase9_http_snapshot",
        version="phase9_v0",
        capabilities=[Capability("MARKET_DATA_HTTP_READ_LIVE")],
    )

    broker = _make_broker(declarations={"phase9_http_snapshot": decl}, gate=gate)

    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="phase9_http_snapshot",
            operation="market_snapshot_live",
            required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
            params={"pair": "BTC-USD", "domain": "api.not-allowlisted.example"},
        )

    msg = str(e.value)
    assert "DENY_NOT_ALLOWLISTED_DOMAIN" in msg
    assert spy.call_count == 0

    raw = "Authorization: Bearer SUPERSECRET"
    safe = redact_sensitive(raw)
    assert "authorization" not in safe.lower()
    assert "authorization" not in msg.lower()
