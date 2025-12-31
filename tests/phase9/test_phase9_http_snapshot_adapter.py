import io
import json
import urllib.request
import pytest

from allmight.adapters.broker import AdapterBroker, AdapterDeclaration
from allmight.adapters.capabilities import Capability
from allmight.security.secrets import SecretsBoundary
from allmight.security.network_gate import NetworkGate


class _FakeHTTPResponse(io.BytesIO):
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False


def _make_broker(*, net: NetworkGate):
    decl = AdapterDeclaration(
        adapter_id="phase9_http_snapshot",
        version="phase9_v0",
        capabilities=[Capability("MARKET_DATA_HTTP_READ_LIVE")],
    )
    return AdapterBroker(network_gate=net, secrets=SecretsBoundary(allow_resolution=False), declarations={"phase9_http_snapshot": decl})


def test_http_snapshot_denies_when_network_disabled(monkeypatch):
    # If network is disabled, urlopen must never be called.
    called = {"n": 0}
    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("urlopen must not be called when network disabled")

    monkeypatch.setattr(urllib.request, "urlopen", boom)

    broker = _make_broker(net=NetworkGate(enabled=False))
    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="phase9_http_snapshot",
            operation="market_snapshot_live",
            required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
            params={"pair": "BTC-USD", "domain": "api.exchange.coinbase.com"},
        )

    assert "DENY_NETWORK_DISABLED" in str(e.value)
    assert called["n"] == 0


def test_http_snapshot_allows_allowlisted_domain_and_calls_urlopen_once(monkeypatch):
    payload = json.dumps({"price": "123.45"}).encode("utf-8")

    called = {"n": 0}
    def fake_urlopen(req, timeout):
        called["n"] += 1
        return _FakeHTTPResponse(payload)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    broker = _make_broker(net=NetworkGate(enabled=True))
    out = broker.call(
        adapter_id="phase9_http_snapshot",
        operation="market_snapshot_live",
        required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
        params={"pair": "BTC-USD", "domain": "api.exchange.coinbase.com"},
    )
    assert out["pair"] == "BTC-USD"
    assert float(out["price"]) == 123.45
    assert out["source"]
    assert called["n"] == 1


def test_http_snapshot_denies_too_large_response(monkeypatch):
    big = b"x" * (262144 + 2)

    def fake_urlopen(req, timeout):
        return _FakeHTTPResponse(big)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    broker = _make_broker(net=NetworkGate(enabled=True))
    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="phase9_http_snapshot",
            operation="market_snapshot_live",
            required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
            params={"pair": "BTC-USD", "domain": "api.exchange.coinbase.com"},
        )
    assert "DENY_RESPONSE_TOO_LARGE" in str(e.value)


def test_http_snapshot_denies_bad_json(monkeypatch):
    def fake_urlopen(req, timeout):
        return _FakeHTTPResponse(b"not json")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    broker = _make_broker(net=NetworkGate(enabled=True))
    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="phase9_http_snapshot",
            operation="market_snapshot_live",
            required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
            params={"pair": "BTC-USD", "domain": "api.exchange.coinbase.com"},
        )
    assert "DENY_BAD_JSON" in str(e.value) or "DENY_HTTP_ERROR" in str(e.value)


def test_http_snapshot_denies_missing_price(monkeypatch):
    payload = json.dumps({"foo": "bar"}).encode("utf-8")

    def fake_urlopen(req, timeout):
        return _FakeHTTPResponse(payload)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    broker = _make_broker(net=NetworkGate(enabled=True))
    with pytest.raises(Exception) as e:
        broker.call(
            adapter_id="phase9_http_snapshot",
            operation="market_snapshot_live",
            required_capabilities=["MARKET_DATA_HTTP_READ_LIVE"],
            params={"pair": "BTC-USD", "domain": "api.exchange.coinbase.com"},
        )
    assert "DENY_SCHEMA_MISSING_PRICE" in str(e.value)
