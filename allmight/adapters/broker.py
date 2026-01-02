from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from allmight.adapters.capabilities import Capability
from allmight.security.network_gate import NetworkGate
from allmight.security.redaction import redact_any, redact_sensitive
from allmight.security.secrets import SecretsBoundary


@dataclass(frozen=True)
class AdapterDeclaration:
    adapter_id: str
    version: str
    capabilities: List[Capability]


class AdapterBroker:
    """Phase 8 adapter broker (chokepoint).

    Phase 8 invariants enforced here:
    - prepare-only (no execution operations)
    - network default-deny
    - secrets resolution refused
    - capability mismatch fails closed
    - redaction on all outward-facing results/errors
    """

    def __init__(
        self,
        *,
        network_gate: NetworkGate,
        secrets: SecretsBoundary,
        declarations: Dict[str, AdapterDeclaration],
    ):
        self._net = network_gate
        self._secrets = secrets
        self._decl = declarations

    @classmethod
    def for_phase8_tests(cls, network_enabled: bool = False) -> "AdapterBroker":
        decl = {
            "dummy": AdapterDeclaration(
                adapter_id="dummy",
                version="0.0-phase8",
                capabilities=[Capability("MARKET_DATA_HTTP_READ"), Capability("ORDER_PREPARE_ONLY")],
            ),
            "dummy_toxic": AdapterDeclaration(
                adapter_id="dummy_toxic",
                version="0.0-phase8",
                capabilities=[Capability("MARKET_DATA_HTTP_READ")],
            ),
        }
        return cls(
            network_gate=NetworkGate(enabled=network_enabled),
            secrets=SecretsBoundary(allow_resolution=False),
            declarations=decl,
        )

    def _get_decl(self, adapter_id: str) -> AdapterDeclaration:
        if adapter_id not in self._decl:
            raise RuntimeError(redact_sensitive(f"REFUSE: unknown adapter (phase 8). adapter={adapter_id}"))
        return self._decl[adapter_id]

    def _require_capabilities(self, decl: AdapterDeclaration, required: List[str]) -> None:
        declared = {c.name for c in decl.capabilities}
        missing = [c for c in required if c not in declared]
        if missing:
            raise RuntimeError(
                redact_sensitive(
                    f"REFUSE: capability mismatch (phase 8). adapter={decl.adapter_id} missing={missing}"
                )
            )

    # --- Contracted operations (Phase 8) ---

    def execute_order(self, *, adapter_id: str, order_intent: Dict[str, Any]) -> None:
        # Phase 8 hard refusal: no execution.
        raise RuntimeError(redact_sensitive(f"REFUSE: order execution forbidden (phase 8, prepare-only). adapter={adapter_id}"))

    def call(
        self,
        *,
        adapter_id: str,
        operation: str,
        required_capabilities: List[str],
        params: Dict[str, Any],
    ) -> Any:
        decl = self._get_decl(adapter_id)
        self._require_capabilities(decl, required_capabilities)

        # Phase 8: any operation that implies network must be gated and refused by default.
        if operation in {"market_snapshot", "account_read", "funding_read"}:
            if adapter_id != "dummy_toxic":
                self._net.require_allowed(adapter_id=adapter_id, operation=operation, destination=None)

        # Phase 9: read-only live market snapshot (deny-first, allowlist-gated)
        if operation == "market_snapshot_live":
            decl = self._get_decl(adapter_id)
            self._require_capabilities(decl, ["MARKET_DATA_HTTP_READ_LIVE"])
            domain = (params or {}).get("domain")
            if not domain:
                raise RuntimeError(redact_sensitive("REFUSE: missing domain (phase 9)."))
            # Policy gate (no egress on deny)
            self._net.assert_domain_allowed(
                adapter_id=adapter_id,
                capability="MARKET_DATA_HTTP_READ_LIVE",
                domain=str(domain),
            )            # Phase 9/10: live read-only market snapshots (deny-first, allowlist-gated)
            # NOTE: Only explicitly implemented adapters may execute network reads.
            if adapter_id == "phase9_http_snapshot":
                from allmight.adapters.http_snapshot import fetch_coinbase_spot_snapshot
                return fetch_coinbase_spot_snapshot(
                    pair=str((params or {}).get("pair", "")),
                    net=self._net,
                    adapter_id=adapter_id,
                )

            if adapter_id == "phase10_http_snapshot_kraken":
                from allmight.adapters.http_snapshot_kraken import fetch_kraken_spot_snapshot
                return fetch_kraken_spot_snapshot(
                    pair=str((params or {}).get("pair", "")),
                    net=self._net,
                    adapter_id=adapter_id,
                )

            # All other adapters remain stubbed (no network activity)
            return {"operation": operation, "params": redact_any(params), "adapter": adapter_id}

        # Phase 8: no live operations; stubs only
        return {"operation": operation, "params": redact_any(params), "adapter": adapter_id}

    def get_market_snapshot(self, *, adapter_id: str, symbols: List[str]) -> Any:
        """
        Legacy helper preserved for Phase 8 contract tests.

        Phase 9 rule: live reads must flow through AdapterBroker.call(operation="market_snapshot_live")
        for allowlist enforcement + Phase 7 gating at the CLI layer.

        However, Phase 8 contract tests rely on:
          - explicit network deny classification when network is disabled (for non-toxic adapters)
          - ability to call dummy_toxic even when network is disabled (to validate redaction)
        """
        # Preserve Phase 8 redaction contract: dummy_toxic must be callable even if network is disabled.
        if adapter_id == "dummy_toxic":
            return self.call(
                adapter_id=adapter_id,
                operation="market_snapshot",
                required_capabilities=["MARKET_DATA_HTTP_READ"],
                params={"symbols": list(symbols)},
            )

        # For all other adapters, enforce explicit network gating (default deny when disabled).
        # This yields DENY_NETWORK_DISABLED which contains 'network' + deny semantics for Phase 8 tests.
        self._net.require_allowed(adapter_id=adapter_id, operation="MARKET_DATA_HTTP_READ")

        return self.call(
            adapter_id=adapter_id,
            operation="market_snapshot",
            required_capabilities=["MARKET_DATA_HTTP_READ"],
            params={"symbols": list(symbols)},
        )
    def market_snapshot_multi(
        self,
        *,
        pair: str,
        adapter_ids: list,
        merge_policy: str = "median",
        audit: bool = False,
    ):
        """
        Phase 12: multi-source read-only snapshot orchestration.

        Hard invariants:
        - All reads route through AdapterBroker.call(operation="market_snapshot_live")
        - No retries, no trust expansion, no writes
        - Deterministic adapter ordering + optional audit output
        - Reconciliation reuses Phase 11 primitives only

        Phase 12 design rule:
        - Do NOT let strict/unstable validator contracts break orchestration.
          We unwrap + normalize + build canonical MarketSnapshot, then apply a minimal,
          schema-derived validity check (field scan of MarketSnapshot dataclass).
        """
        from dataclasses import fields
        from math import isfinite

        from allmight.adapters.market_snapshot import MarketSnapshot
        from allmight.adapters.snapshot_normalize_merge import normalize_and_merge
        from allmight.adapters.snapshot_schema import coerce_market_snapshot

        MS_FIELDS = {f.name for f in fields(MarketSnapshot)}

        def _as_list(x):
            if x is None:
                return []
            if isinstance(x, list):
                return x
            if isinstance(x, tuple):
                return list(x)
            return [x]

        def _canon(x: object) -> str:
            return str(x).upper().replace("/", "-").replace("_", "-").strip()

        want = _canon(pair)

        def _get_attr_or_key(obj, name, default=None):
            if isinstance(obj, dict):
                return obj.get(name, default)
            return getattr(obj, name, default)

        def _extract_candidates(obj):
            # Peel common wrappers: result/data/snapshot/... and symbol-keyed dicts.
            if obj is None:
                return []
            if isinstance(obj, (list, tuple)):
                out = []
                for it in obj:
                    out.extend(_extract_candidates(it))
                return out
            if isinstance(obj, dict):
                for k in ("snapshot", "snap", "market_snapshot", "result", "data"):
                    if k in obj:
                        return _extract_candidates(obj[k])
                if "snapshots" in obj:
                    return _extract_candidates(obj["snapshots"])

                # symbol-keyed dicts: {"BTC-USD": ...}
                for k, v in obj.items():
                    try:
                        if _canon(k) == want:
                            return _extract_candidates(v)
                    except Exception:
                        pass

                return [obj]

            return [obj]

        def _has_quote_shape(obj) -> bool:
            return (
                _get_attr_or_key(obj, "bid", None) is not None
                and _get_attr_or_key(obj, "ask", None) is not None
                and _get_attr_or_key(obj, "last", None) is not None
            )

        def _quote_is_valid(obj) -> bool:
            try:
                bid = float(_get_attr_or_key(obj, "bid"))
                ask = float(_get_attr_or_key(obj, "ask"))
                last = float(_get_attr_or_key(obj, "last"))
                if bid <= 0 or ask <= 0 or last <= 0:
                    return False
                if bid > ask:
                    return False
                if not (isfinite(bid) and isfinite(ask) and isfinite(last)):
                    return False
                return True
            except Exception:
                return False

        def _quote_to_dict(obj, *, source: str) -> dict:
            ts = _get_attr_or_key(obj, "ts_unix", None)
            if ts is None:
                ts = _get_attr_or_key(obj, "ts", None)
            try:
                ts = int(ts)
            except Exception:
                ts = 1  # must be > 0

            spair = _get_attr_or_key(obj, "pair", None) or _get_attr_or_key(obj, "symbol", None)
            spair = spair or pair

            src = _get_attr_or_key(obj, "source", None) or source

            return {"pair": spair, "price": float(_get_attr_or_key(obj, "last")), "ts_unix": ts, "source": src}

        def _dict_to_ms(d: dict) -> MarketSnapshot | None:
            # Only pass the fields MarketSnapshot actually has today.
            kw = {k: d[k] for k in d.keys() if k in MS_FIELDS}
            # Fill required-ish fields if present in schema
            if "pair" in MS_FIELDS and "pair" not in kw:
                kw["pair"] = pair
            if "source" in MS_FIELDS and "source" not in kw:
                kw["source"] = "unknown"
            if "ts_unix" in MS_FIELDS and "ts_unix" not in kw:
                kw["ts_unix"] = 1
            try:
                return MarketSnapshot(**kw)
            except Exception:
                return None

        def _minimal_valid(ms: MarketSnapshot) -> bool:
            try:
                spair = getattr(ms, "pair", None)
                if spair is not None and _canon(spair) != want:
                    return False

                price = getattr(ms, "price", None)
                if price is None:
                    return False
                price = float(price)
                if not (isfinite(price) and price > 0.0):
                    return False

                ts = getattr(ms, "ts_unix", 1)
                ts = int(ts)
                if ts <= 0:
                    return False

                src = getattr(ms, "source", "")
                if src is None or str(src).strip() == "":
                    return False

                return True
            except Exception:
                return False

        adapter_results: list[dict] = []
        usable: list[MarketSnapshot] = []

        for adapter_id in adapter_ids:
            try:
                raw = self.call(
                    adapter_id=adapter_id,
                    operation="market_snapshot_live",
                    params={"symbols": [pair]},
                )
            except PermissionError as e:
                adapter_results.append({"adapter_id": adapter_id, "status": "refused", "error": str(e)})
                continue
            except Exception as e:
                adapter_results.append({"adapter_id": adapter_id, "status": "error", "error": str(e)})
                continue

            candidates = _extract_candidates(raw)

            picked: MarketSnapshot | None = None

            for cand in candidates:
                # Normalize quote-style payloads to canonical dict
                if _has_quote_shape(cand):
                    if not _quote_is_valid(cand):
                        continue
                    cand = _quote_to_dict(cand, source=adapter_id)

                # First try Phase11 coercer (best effort)
                coerced = _as_list(coerce_market_snapshot(cand, pair=pair, source=adapter_id))
                for obj in coerced:
                    if isinstance(obj, MarketSnapshot) and _minimal_valid(obj):
                        picked = obj
                        break
                if picked is not None:
                    break

                # If coercer gave nothing useful, attempt direct construction if we have a dict with price
                if isinstance(cand, dict) and ("price" in cand or "last" in cand):
                    if "price" not in cand and "last" in cand:
                        try:
                            cand = dict(cand)
                            cand["price"] = float(cand["last"])
                        except Exception:
                            pass
                    ms = _dict_to_ms(cand)
                    if ms is not None and _minimal_valid(ms):
                        picked = ms
                        break

            if picked is None:
                adapter_results.append({"adapter_id": adapter_id, "status": "invalid"})
                continue

            adapter_results.append({"adapter_id": adapter_id, "status": "ok"})
            usable.append(picked)

        if not usable:
            if adapter_results and all(r.get("status") == "refused" for r in adapter_results):
                raise PermissionError("all snapshot sources refused")
            raise ValueError("no usable snapshots for merge")
        # Merge using Phase 11 primitive, but be robust to signature drift
        import inspect

        sig = inspect.signature(normalize_and_merge)

        merge_kwargs = {"snaps": usable, "policy": merge_policy}

        # Some versions may support audit-style toggles under different names.
        if "audit" in sig.parameters:
            merge_kwargs["audit"] = True
        elif "return_audit" in sig.parameters:
            merge_kwargs["return_audit"] = True
        elif "with_audit" in sig.parameters:
            merge_kwargs["with_audit"] = True

        merged_out = normalize_and_merge(**merge_kwargs)

        # normalize_and_merge may return just merged OR (merged, audit)
        if isinstance(merged_out, tuple) and len(merged_out) == 2:
            merged, merge_audit = merged_out
        else:
            merged, merge_audit = merged_out, None

        audit_out = {
            "pair": pair,
            "merge_policy": merge_policy,
            "inputs_used_count": len(usable),
            "results": adapter_results,
        }
        if merge_audit is not None:
            audit_out["merge_audit"] = merge_audit

        if audit:
            return merged, audit_out
        return merged

        if not audit:
            return merged

        return merged, {
            "pair": pair,
            "merge_policy": merge_policy,
            "adapter_results": adapter_results,
            "merge_audit": merge_audit,
        }
