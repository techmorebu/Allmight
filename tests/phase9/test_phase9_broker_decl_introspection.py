from allmight.adapters.broker import AdapterBroker, AdapterDeclaration
from allmight.adapters.capabilities import Capability
from allmight.security.secrets import SecretsBoundary
from tests.phase9._net_spy import NetworkGateSpy


def test_broker_declarations_are_dict_keyed_by_adapter_id():
    decl = AdapterDeclaration(
        adapter_id="phase9_http_snapshot",
        version="phase9_v0",
        capabilities=[Capability("MARKET_DATA_HTTP_READ_LIVE")],
    )

    broker = AdapterBroker(
        network_gate=NetworkGateSpy(),
        secrets=SecretsBoundary(allow_resolution=False),
        declarations={"phase9_http_snapshot": decl},
    )

    # Broker stores declarations internally; it must be a mapping.
    assert isinstance(broker.__dict__.get("_decl"), dict)
    assert "phase9_http_snapshot" in broker.__dict__["_decl"]
