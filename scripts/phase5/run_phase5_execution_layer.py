from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional


EXIT_OK = 0
EXIT_HALT = 2


@dataclass(frozen=True)
class HaltReport:
    code: str
    message: str
    details: Dict[str, Any]

    def to_json(self) -> Dict[str, Any]:
        return {"status": "HALT", "code": self.code, "message": self.message, "details": self.details}


def _read_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def _write_json(p: Path, obj: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_text(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def _halt(outdir: Path, report: HaltReport) -> int:
    _write_json(outdir / "phase5_halt_report.json", report.to_json())
    return EXIT_HALT


def _select_input(args: argparse.Namespace, outdir: Path) -> Optional[Path]:
    if bool(args.input) == bool(args.inputs_dir):
        _halt(
            outdir,
            HaltReport(
                code="E_INPUT_SELECTION",
                message="Specify exactly one of --input or --inputs-dir.",
                details={"input": args.input, "inputs_dir": args.inputs_dir},
            ),
        )
        return None

    if args.input:
        return Path(args.input)

    d = Path(args.inputs_dir)
    if not d.exists():
        _halt(
            outdir,
            HaltReport(
                code="E_NO_INPUTS_DIR",
                message="inputs-dir does not exist.",
                details={"inputs_dir": str(d)},
            ),
        )
        return None

    cand = sorted([p for p in d.glob("phase4_control_*.json") if p.name.endswith(f"_{args.asof}.json")])
    if not cand:
        _halt(
            outdir,
            HaltReport(
                code="E_NO_PHASE4_FILES",
                message="No Phase-4 control files found matching requested asof.",
                details={"inputs_dir": str(d), "requested_asof": args.asof},
            ),
        )
        return None

    if len(cand) > 1:
        _halt(
            outdir,
            HaltReport(
                code="E_AMBIGUOUS_PHASE4_INPUTS",
                message="Multiple Phase-4 control files match requested asof; refusing ambiguous selection.",
                details={"inputs_dir": str(d), "requested_asof": args.asof, "candidates": [str(x) for x in cand]},
            ),
        )
        return None

    return cand[0]


def _payload_template(enabled: bool, mode: str) -> Dict[str, Any]:
    # Deterministic placeholders ONLY. No timestamps. No randomness.
    # Downstream phases may fill these in; Phase-5 never executes.
    if mode == "arbitrage":
        return {
            "enabled": enabled,
            "venues": None,            # e.g. ["coinbase", "kraken", "uniswap_v3"] (placeholder)
            "route_hints": None,       # e.g. "CEX->DEX->CEX" (placeholder)
            "max_notional_usd": None,  # placeholder risk limit
            "slippage_bps": None,      # placeholder
            "min_edge_bps": None,      # placeholder
            "gas_policy": None,        # placeholder (L2 choice etc.)
            "notes": "placeholder_only",
        }
    if mode == "directional":
        return {
            "enabled": enabled,
            "strategy_id": None,       # placeholder (e.g. "MACD_BB_v2")
            "timeframe": None,         # placeholder
            "max_notional_usd": None,  # placeholder risk limit
            "risk_policy": None,       # placeholder (stops, sizing rules)
            "notes": "placeholder_only",
        }
    if mode == "flashloan":
        return {
            "enabled": enabled,
            "protocols": None,         # placeholder (Aave, Balancer, etc.)
            "max_notional_usd": None,  # placeholder
            "safety_policy": None,     # placeholder (simulation required, revert conditions)
            "notes": "placeholder_only",
        }
    # unreachable in current contract
    return {"enabled": enabled, "notes": "placeholder_only"}


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--asof", required=True, choices=["last", "i60"])
    ap.add_argument("--input", required=False, help="Path to a single Phase-4 control JSON file")
    ap.add_argument("--inputs-dir", required=False, help="Directory containing Phase-4 control JSON files")
    ap.add_argument("--outdir", required=True, help="Where to write Phase-5 outputs")
    args = ap.parse_args(argv)

    outdir = Path(args.outdir)

    in_path = _select_input(args, outdir)
    if in_path is None:
        return EXIT_HALT

    if not in_path.exists():
        return _halt(outdir, HaltReport(code="E_NO_INPUT_FILE", message="Phase-4 input file not found.", details={"input": str(in_path)}))

    try:
        data = _read_json(in_path)
    except Exception as e:
        return _halt(outdir, HaltReport(code="E_BAD_JSON", message="Failed to parse Phase-4 JSON.", details={"input": str(in_path), "error": repr(e)}))

    if not isinstance(data, dict):
        return _halt(outdir, HaltReport(code="E_SCHEMA_TOPLEVEL_NOT_DICT", message="Phase-4 JSON top-level must be a dict.", details={"input": str(in_path), "toplevel_type": type(data).__name__}))

    if data.get("phase") != 4:
        return _halt(outdir, HaltReport(code="E_PHASE_NOT_4", message="Phase-4 input must have phase==4.", details={"input": str(in_path), "phase": data.get("phase")}))

    file_asof = data.get("asof")
    if file_asof != args.asof:
        return _halt(outdir, HaltReport(code="E_ASOF_MISMATCH", message="Input asof does not match requested asof; refusing to mix horizons.", details={"input": str(in_path), "file_asof": file_asof, "requested_asof": args.asof}))

    assets = data.get("assets")
    if not isinstance(assets, dict):
        return _halt(outdir, HaltReport(code="E_SCHEMA_ASSETS_NOT_DICT", message="Phase-4 input must include assets as a dict.", details={"input": str(in_path), "assets_type": type(assets).__name__}))

    intents: list[dict[str, Any]] = []
    for asset in sorted(assets.keys()):
        node = assets[asset]
        if not isinstance(node, dict):
            return _halt(outdir, HaltReport(code="E_SCHEMA_ASSET_NODE_NOT_DICT", message="Each assets.<ASSET> node must be a dict.", details={"input": str(in_path), "asset": asset, "node_type": type(node).__name__}))

        perms = node.get("permissions")
        if not isinstance(perms, dict):
            return _halt(outdir, HaltReport(code="E_SCHEMA_PERMISSIONS_NOT_DICT", message="Each assets.<ASSET>.permissions must be a dict.", details={"input": str(in_path), "asset": asset, "permissions_type": type(perms).__name__}))

        missing = [k for k in ("allow_arbitrage", "allow_directional", "allow_flashloan") if k not in perms]
        if missing:
            return _halt(outdir, HaltReport(code="E_SCHEMA_MISSING_PERMISSION_KEYS", message="Missing required permission keys.", details={"input": str(in_path), "asset": asset, "missing": missing}))

        allow_arbitrage = bool(perms["allow_arbitrage"])
        allow_directional = bool(perms["allow_directional"])
        allow_flashloan = bool(perms["allow_flashloan"])

        allowed_modes: list[str] = []
        reasons: list[dict[str, Any]] = []

        if allow_arbitrage:
            allowed_modes.append("arbitrage")
        else:
            reasons.append({"code": "S_PERM_ARBITRAGE_FALSE", "severity": "SUPPRESS", "msg": "Phase-4 permissions disallow arbitrage."})

        if allow_directional:
            allowed_modes.append("directional")
        else:
            reasons.append({"code": "S_PERM_DIRECTIONAL_FALSE", "severity": "SUPPRESS", "msg": "Phase-4 permissions disallow directional."})

        if allow_flashloan:
            allowed_modes.append("flashloan")
        else:
            reasons.append({"code": "S_PERM_FLASHLOAN_FALSE", "severity": "SUPPRESS", "msg": "Phase-4 permissions disallow flashloan."})

        if not allowed_modes:
            status = "SUPPRESSED"
            reasons.insert(0, {"code": "S_SUPPRESSION_INFERRED_FROM_PERMISSIONS", "severity": "SUPPRESS", "msg": "No execution modes permitted by Phase-4 permissions (compatibility suppression)."})
        else:
            status = "ALLOWED"
            reasons.insert(0, {"code": "A_ALLOWED_BY_CONTROL", "severity": "ALLOW", "msg": "One or more execution modes permitted by Phase-4 permissions."})

        phase4_evidence = {
            "activation_band": node.get("activation_band"),
            "activation_band_flip": node.get("activation_band_flip"),
            "activation_band_prev": node.get("activation_band_prev"),
            "overrides_applied": node.get("overrides_applied"),
            "inputs": {"global_confidence": (data.get("inputs") or {}).get("global_confidence")},
        }

        # Payload placeholders (deterministic)
        enabled_set = set(allowed_modes)
        intent_payload = {
            "arbitrage": _payload_template("arbitrage" in enabled_set, "arbitrage"),
            "directional": _payload_template("directional" in enabled_set, "directional"),
            "flashloan": _payload_template("flashloan" in enabled_set, "flashloan"),
        }

        intents.append({
            "asset": asset,
            "grid": data.get("grid"),
            "asof": args.asof,
            "status": status,
            "allowed_modes": allowed_modes,
            "intent_payload": intent_payload,
            "phase4_evidence": phase4_evidence,
            "phase4_permissions": {
                "allow_arbitrage": allow_arbitrage,
                "allow_directional": allow_directional,
                "allow_flashloan": allow_flashloan,
            },
            "reasons": reasons,
        })

    # Human audit (include payload enabled flags only)
    lines: list[str] = []
    lines.append("PHASE 5 — EXECUTION LAYER AUDIT")
    lines.append("==============================")
    lines.append(f"asof: {args.asof}")
    lines.append(f"grid: {data.get('grid')}")
    gc = (data.get("inputs") or {}).get("global_confidence")
    lines.append(f"global_confidence: {gc}")
    lines.append("")

    for it in intents:
        lines.append(f"ASSET: {it['asset']}")
        lines.append(f"status: {it['status']}")
        am = it.get("allowed_modes") or []
        lines.append("allowed_modes: " + (" ".join(am) if am else "<none>"))

        perms_out = it.get("phase4_permissions") or {}
        lines.append(
            f"permissions: allow_arbitrage={perms_out.get('allow_arbitrage')} "
            f"allow_directional={perms_out.get('allow_directional')} "
            f"allow_flashloan={perms_out.get('allow_flashloan')}"
        )

        ev = it.get("phase4_evidence") or {}
        lines.append(f"activation_band: {ev.get('activation_band')}")
        lines.append(f"activation_band_flip: {ev.get('activation_band_flip')}")
        lines.append(f"activation_band_prev: {ev.get('activation_band_prev')}")

        pl = it.get("intent_payload") or {}
        lines.append(
            "payload_enabled: "
            f"arb={pl.get('arbitrage', {}).get('enabled')} "
            f"dir={pl.get('directional', {}).get('enabled')} "
            f"fl={pl.get('flashloan', {}).get('enabled')}"
        )

        codes = [r.get("code") for r in (it.get("reasons") or []) if isinstance(r, dict)]
        lines.append("reason_codes: " + (" ".join([c for c in codes if c]) if codes else "<none>"))
        lines.append("")

    _write_text(outdir / "phase5_audit.txt", "\n".join(lines) + "\n")

    _write_json(outdir / "phase5_execution_intents.json", {
        "status": "OK",
        "phase": 5,
        "asof": args.asof,
        "grid": data.get("grid"),
        "source_input": str(in_path),
        "intents": intents,
    })

    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
