from __future__ import annotations

import pytest

from scripts.phase5.adapters.coinbase_spot_live_v0 import CoinbaseSpotLiveV0
from scripts.phase5.live_envelope import LiveDeny


def test_requires_operator_flag() -> None:
    a = CoinbaseSpotLiveV0()
    act = a.build_action(action="PING", payload={"note": "x"})
    with pytest.raises(LiveDeny) as ei:
        a.execute(act, ack=None, i_acknowledge_flag=False, max_usd_notional=5.0, dry_run=True)
    assert ei.value.code == "E_FLAG_REQUIRED"


def test_notional_cap_enforced() -> None:
    a = CoinbaseSpotLiveV0()
    act = a.build_action(action="PLACE_ORDER_MARKET", payload={"symbol": "BTC/USD", "side": "buy", "usd_notional": 999})
    with pytest.raises(LiveDeny) as ei:
        a.execute(act, ack=None, i_acknowledge_flag=True, max_usd_notional=5.0, dry_run=True)
    assert ei.value.code == "E_NOTIONAL_CAP"


def test_bad_order_fields() -> None:
    a = CoinbaseSpotLiveV0()
    act = a.build_action(action="PLACE_ORDER_MARKET", payload={"symbol": "", "side": "buy", "usd_notional": 1})
    with pytest.raises(LiveDeny) as ei:
        a.execute(act, ack=None, i_acknowledge_flag=True, max_usd_notional=5.0, dry_run=True)
    assert ei.value.code == "E_BAD_ORDER"
