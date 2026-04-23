from __future__ import annotations

import os
import time
from dataclasses import asdict
from typing import Any, Dict, Optional

import ccxt  # type: ignore

from scripts.phase5.adapters.live_base import LiveAdapter, LiveAction
from scripts.phase5.live_envelope import LiveDeny, assert_live_allowed, deny_if_kill_switch, emit_live_audit_event, load_envelope


def _now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class CoinbaseSpotLiveV0(LiveAdapter):
    """Coinbase spot live adapter (Phase 5 minimal scope).

    - ONE adapter ID.
    - No retries.
    - Capped notional.
    - Kill-switch checked before + after submission.
    - ccxt is used for private order placement.
    """

    adapter_id = "COINBASE_SPOT_LIVE_V0"

    # Environment variables required by ccxt.coinbase private endpoints
    ENV_API_KEY = "COINBASE_API_KEY"
    ENV_API_SECRET = "COINBASE_API_SECRET"
    ENV_API_PASSPHRASE = "COINBASE_API_PASSPHRASE"

    def describe(self) -> Dict[str, Any]:
        return {
            "adapter_id": self.adapter_id,
            "venue": "coinbase",
            "market": "spot",
            "version": "v0",
            "io": "CCXT_PRIVATE (GATED)",
            "env": [self.ENV_API_KEY, self.ENV_API_SECRET, self.ENV_API_PASSPHRASE],
        }

    def _make_exchange(self) -> ccxt.Exchange:
        api_key = os.environ.get(self.ENV_API_KEY)
        api_secret = os.environ.get(self.ENV_API_SECRET)
        passphrase = os.environ.get(self.ENV_API_PASSPHRASE)

        missing = [k for k, v in [
            (self.ENV_API_KEY, api_key),
            (self.ENV_API_SECRET, api_secret),
            (self.ENV_API_PASSPHRASE, passphrase),
        ] if not v]

        if missing:
            raise LiveDeny("E_CREDENTIALS_MISSING", "Missing Coinbase API credentials in env.", {"missing": missing})

        ex = ccxt.coinbase({
            "apiKey": api_key,
            "secret": api_secret,
            "password": passphrase,
            "enableRateLimit": True,
        })
        return ex

    def execute(
        self,
        live_action: LiveAction,
        *,
        ack: Optional[str],
        i_acknowledge_flag: bool,
        max_usd_notional: float,
        dry_run: bool,
    ) -> Dict[str, Any]:
        """Execute a single live action.

        Supported actions:
        - PING (no network)
        - PLACE_ORDER_MARKET (network if dry_run=False)

        Gating:
        - operator flag required
        - envelope allowlist+env+ack required for PLACE_ORDER_MARKET when dry_run=False
        """
        env = load_envelope()

        # Always emit attempt (best-effort)
        emit_live_audit_event(env, {
            "event": "PHASE5_LIVE_ACTION_ATTEMPT",
            "adapter_id": self.adapter_id,
            "action": live_action.action,
            "dry_run": bool(dry_run),
            "ts": _now_utc(),
        })

        if not i_acknowledge_flag:
            raise LiveDeny("E_FLAG_REQUIRED", "Missing required operator flag.", {"flag": "--i-acknowledge-live-risk"})

        # Kill switch check even for dry-run (operator safety feedback)
        deny_if_kill_switch(env)

        if live_action.action == "PING":
            out = {"status": "OK", "adapter_id": self.adapter_id, "action": "PING", "ts": _now_utc()}
            emit_live_audit_event(env, {"event": "PHASE5_LIVE_ACTION_OK", "adapter_id": self.adapter_id, "action": "PING"})
            return out

        if live_action.action != "PLACE_ORDER_MARKET":
            raise LiveDeny("E_UNSUPPORTED_ACTION", "Unsupported live action.", {"action": live_action.action})

        payload = dict(live_action.payload or {})
        symbol = str(payload.get("symbol") or "")
        side = str(payload.get("side") or "")
        usd_notional = float(payload.get("usd_notional") or 0.0)

        if not symbol or not side:
            raise LiveDeny("E_BAD_ORDER", "Order requires symbol and side.", {"symbol": symbol, "side": side})
        if side not in ("buy", "sell"):
            raise LiveDeny("E_BAD_ORDER_SIDE", "side must be buy or sell.", {"side": side})

        if usd_notional <= 0.0:
            raise LiveDeny("E_BAD_NOTIONAL", "usd_notional must be > 0.", {"usd_notional": usd_notional})

        if usd_notional > float(max_usd_notional):
            raise LiveDeny("E_NOTIONAL_CAP", "Order exceeds Phase 5 notional cap.", {
                "usd_notional": usd_notional,
                "max_usd_notional": float(max_usd_notional),
            })

        # Only require envelope ALLOW when we are actually going live (dry_run=False)
        if not dry_run:
            assert_live_allowed(self.adapter_id, ack=ack)

        # Prepare order object for audit
        order_req = {
            "symbol": symbol,
            "side": side,
            "type": "market",
            "usd_notional": usd_notional,
            "dry_run": bool(dry_run),
        }

        if dry_run:
            emit_live_audit_event(env, {"event": "PHASE5_ORDER_DRY_RUN", "adapter_id": self.adapter_id, "order": order_req})
            return {"status": "DRY_RUN", "adapter_id": self.adapter_id, "order": order_req}

        # Real submission (single call, no retries)
        ex = self._make_exchange()

        # For market buy, ccxt typically uses amount in base currency; for USD-notional we approximate using ticker last.
        # Phase 5: minimal; operator must choose a highly liquid pair; no optimization.
        t = ex.fetch_ticker(symbol)
        last = float(t.get("last") or 0.0)
        if last <= 0.0:
            raise LiveDeny("E_BAD_TICKER", "Ticker last price unavailable; cannot size market order.", {"symbol": symbol, "last": last})

        amount_base = usd_notional / last

        deny_if_kill_switch(env)  # pre-submit re-check
        resp = ex.create_order(symbol=symbol, type="market", side=side, amount=amount_base, price=None)
        deny_if_kill_switch(env)  # post-submit immediate check (proves kill responsiveness)

        emit_live_audit_event(env, {
            "event": "PHASE5_ORDER_SUBMITTED",
            "adapter_id": self.adapter_id,
            "order": order_req,
            "ccxt_order_id": resp.get("id"),
            "status": resp.get("status"),
        })

        return {
            "status": "SUBMITTED",
            "adapter_id": self.adapter_id,
            "order": order_req,
            "ccxt": {
                "id": resp.get("id"),
                "status": resp.get("status"),
            }
        }
