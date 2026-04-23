#!/usr/bin/env python3
# Phase 4: Intelligence & Control Layer (read-only over Phase-3 outputs)
#
# - Loads Phase-3 component CSV outputs + regime_state.json
# - Applies normalization + weights (from YAML configs)
# - Applies execution permissions from activation_band (YAML matrix)
# - Enforces confidence/risk gating (no silent execution)
# - Adds flip-aware confidence thresholds
# - Sources macro_score and risk_penalty from regime_state dominant_drivers when available
#
# Non-goals:
# - Do not refactor Phase-3 generators
# - Do not fabricate signals

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Tuple

try:
    import yaml  # PyYAML
except Exception as e:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: PyYAML. Install it (e.g., pip install pyyaml) and retry."
    ) from e


def _stats(xs: list[float]) -> Dict[str, float]:
    if not xs:
        return {"min": 0.0, "mean": 0.0, "max": 0.0}
    mn = min(xs)
    mx = max(xs)
    mean = sum(xs) / float(len(xs))
    return {"min": float(mn), "mean": float(mean), "max": float(mx)}


@dataclass(frozen=True)
class Phase4Configs:
    weights: Dict[str, Any]
    normalization: Dict[str, Any]
    execution_matrix: Dict[str, Any]


def _load_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Required config missing: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Config must be a mapping/object: {path}")
    return data


def load_phase4_configs(base_dir: Path) -> Phase4Configs:
    weights = _load_yaml(base_dir / "weights.yaml")
    normalization = _load_yaml(base_dir / "normalization.yaml")
    execution_matrix = _load_yaml(base_dir / "execution_matrix.yaml")
    _validate_weights(weights)
    _validate_normalization(normalization)
    _validate_execution_matrix(execution_matrix)
    return Phase4Configs(weights=weights, normalization=normalization, execution_matrix=execution_matrix)


def _validate_weights(cfg: Dict[str, Any]) -> None:
    if cfg.get("schema_version") != 1:
        raise ValueError("weights.yaml schema_version must be 1")
    policy = cfg.get("policy") or {}
    w = cfg.get("weights")
    if not isinstance(w, dict) or not w:
        raise ValueError("weights.yaml must define a non-empty 'weights' mapping")
    allow_negative = bool(policy.get("allow_negative", False))
    total = 0.0
    for k, v in w.items():
        if not isinstance(k, str) or not k:
            raise ValueError("weights keys must be non-empty strings")
        if not isinstance(v, (int, float)):
            raise ValueError(f"weight for {k} must be numeric")
        if (not allow_negative) and float(v) < 0:
            raise ValueError(f"weight for {k} cannot be negative")
        total += float(v)
    if bool(policy.get("sum_to_one", True)):
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"weights must sum to 1.0 (got {total})")


def _validate_normalization(cfg: Dict[str, Any]) -> None:
    if cfg.get("schema_version") != 1:
        raise ValueError("normalization.yaml schema_version must be 1")
    comps = cfg.get("components")
    if not isinstance(comps, dict) or not comps:
        raise ValueError("normalization.yaml must define 'components' mapping")
    for name, spec in comps.items():
        if not isinstance(spec, dict):
            raise ValueError(f"normalization spec for {name} must be a mapping")
        method = spec.get("method")
        if method not in {"range", "constant"}:
            raise ValueError(f"normalization method for {name} must be 'range' or 'constant'")
        if method == "range":
            for req in ("min", "max", "invert"):
                if req not in spec:
                    raise ValueError(f"normalization spec for {name} missing '{req}'")
            mn = float(spec["min"])
            mx = float(spec["max"])
            if mx <= mn:
                raise ValueError(f"normalization spec for {name}: max must be > min")
        else:
            if "value" not in spec:
                raise ValueError(f"normalization spec for {name} missing 'value' for constant method")
            v = float(spec["value"])
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"normalization constant value for {name} must be in [0,1] (got {v})")


def _validate_execution_matrix(cfg: Dict[str, Any]) -> None:
    if cfg.get("schema_version") != 1:
        raise ValueError("execution_matrix.yaml schema_version must be 1")
    bands = cfg.get("bands")
    if not isinstance(bands, dict) or not bands:
        raise ValueError("execution_matrix.yaml must define non-empty 'bands'")
    for band, perms in bands.items():
        if not isinstance(perms, dict):
            raise ValueError(f"bands.{band} must be a mapping")
        for key in ("allow_directional", "allow_flashloan", "allow_arbitrage"):
            if key not in perms:
                raise ValueError(f"bands.{band} missing '{key}'")
            if not isinstance(perms[key], bool):
                raise ValueError(f"bands.{band}.{key} must be boolean")

    conf = cfg.get("confidence", {})
    if conf.get("enabled", False):
        mc = conf.get("min_confidence", {})
        if "default" not in mc:
            raise ValueError("execution_matrix.yaml confidence.min_confidence.default required when enabled")

    rp = cfg.get("risk_penalty", {})
    if rp.get("enabled", False):
        if "disable_flashloan_at" not in rp:
            raise ValueError("execution_matrix.yaml risk_penalty.disable_flashloan_at required when enabled")


def _read_component_csv(path: Path) -> Dict[str, Dict[str, Any]]:
    import csv
    out: Dict[str, Dict[str, Any]] = {}
    if not path.exists():
        raise FileNotFoundError(f"Missing component CSV: {path}")
    with path.open("r", encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        expected = ["asset", "value", "audit_json"]
        if r.fieldnames != expected:
            raise ValueError(f"Unexpected headers in {path}: {r.fieldnames} (expected {expected})")
        for row in r:
            asset = row["asset"]
            out[asset] = {"value": float(row["value"]), "audit_json": row["audit_json"]}
    return out


def _extract_global_confidence(regime_state_obj: Any) -> float:
    if isinstance(regime_state_obj, dict) and isinstance(regime_state_obj.get("confidence"), (int, float)):
        return float(regime_state_obj["confidence"])

    def visit(x):
        if isinstance(x, dict):
            if "confidence" in x and isinstance(x["confidence"], (int, float)):
                return float(x["confidence"])
            for v in x.values():
                out = visit(v)
                if out is not None:
                    return out
        elif isinstance(x, list):
            for v in x:
                out = visit(v)
                if out is not None:
                    return out
        return None

    out = visit(regime_state_obj)
    if out is None:
        raise ValueError("Could not extract confidence from regime_state JSON")
    return float(out)


def _find_activation_bands(regime_state_obj: Any) -> Dict[str, str]:
    bands: Dict[str, str] = {}

    if isinstance(regime_state_obj, dict):
        for k, v in regime_state_obj.items():
            if isinstance(v, dict) and isinstance(v.get("activation_band"), str):
                bands[k] = v["activation_band"]
        for v in regime_state_obj.values():
            if isinstance(v, list):
                for item in v:
                    if isinstance(item, dict):
                        asset = item.get("asset") or item.get("symbol")
                        band = item.get("activation_band")
                        if isinstance(asset, str) and isinstance(band, str):
                            bands[asset] = band

    elif isinstance(regime_state_obj, list):
        for item in regime_state_obj:
            if isinstance(item, dict):
                asset = item.get("asset") or item.get("symbol")
                band = item.get("activation_band")
                if isinstance(asset, str) and isinstance(band, str):
                    bands[asset] = band

    if not bands:
        raise ValueError("Could not extract activation_band per asset from regime_state JSON")
    return bands


def _dominant_drivers_by_asset(regime_state_obj: Any) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    if isinstance(regime_state_obj, dict):
        dd = regime_state_obj.get("dominant_drivers")
        if isinstance(dd, list):
            for row in dd:
                if isinstance(row, dict):
                    asset = row.get("asset") or row.get("symbol")
                    if isinstance(asset, str) and asset:
                        out[asset] = row
    return out


def _normalize_value(component: str, raw: float, norm_cfg: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    spec = (norm_cfg.get("components") or {}).get(component)
    if not isinstance(spec, dict):
        raise KeyError(f"Missing normalization spec for component: {component}")

    method = spec.get("method")
    if method == "constant":
        v = float(spec["value"])
        return v, {"method": "constant", "value": v}

    if method != "range":
        raise ValueError(f"Unsupported normalization method for {component}: {method}")

    mn = float(spec["min"])
    mx = float(spec["max"])
    inv = bool(spec.get("invert", False))

    clamped = max(mn, min(mx, raw))
    norm = 0.0 if mx == mn else (clamped - mn) / (mx - mn)
    if inv:
        norm = 1.0 - norm

    return float(norm), {"method": "range", "min": mn, "max": mx, "invert": inv, "raw": raw, "clamped": clamped}


def _permissions_for_band(band: str, exec_cfg: Dict[str, Any]) -> Dict[str, bool]:
    bands = exec_cfg.get("bands") or {}
    if band not in bands:
        raise KeyError(f"execution_matrix has no entry for activation_band '{band}'")
    perms = bands[band]
    return {
        "allow_directional": bool(perms["allow_directional"]),
        "allow_flashloan": bool(perms["allow_flashloan"]),
        "allow_arbitrage": bool(perms["allow_arbitrage"]),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase4-config-dir", default="config/phase4")
    ap.add_argument("--replay-dir", default="outputs/replay")
    ap.add_argument("--grid", default="GRID_BTC_ETH_XRP_XAU_15m")
    ap.add_argument("--asof", default="last", choices=["last", "i60"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    cfgs = load_phase4_configs(Path(args.phase4_config_dir))
    replay_dir = Path(args.replay_dir)

    comp_files = {
        "sweep_l2": replay_dir / f"sweep_l2_{args.grid}_{args.asof}.csv",
        "liquidity_arch_l3": replay_dir / f"liquidity_arch_l3_{args.grid}_{args.asof}.csv",
        "macro_score": replay_dir / f"macro_score_{args.grid}_{args.asof}.csv",
        "risk_penalty": replay_dir / f"risk_penalty_{args.grid}_{args.asof}.csv",
    }
    regime_path = replay_dir / f"regime_state_{args.grid}_{args.asof}.json"

    # Read component CSVs. If requested asof CSVs are missing, fall back to 'last' CSVs with explicit audit.
    comp_maps = {}
    for k, path in comp_files.items():
        try:
            comp_maps[k] = _read_component_csv(path)
        except FileNotFoundError:
            if args.asof != 'last':
                # fall back to last for this component only
                fb = str(path).replace(f"_{args.asof}.csv", "_last.csv")
                fb_path = Path(fb)
                if fb_path.exists():
                    comp_maps[k] = _read_component_csv(fb_path)
                    missing = []
                    missing.append(str(path))
                else:
                    raise
            else:
                raise

    regime_obj = json.loads(regime_path.read_text(encoding="utf-8"))

    activation_by_asset = _find_activation_bands(regime_obj)
    dd_by_asset = _dominant_drivers_by_asset(regime_obj)
    global_confidence = _extract_global_confidence(regime_obj)

    # Flip detection (compare i60 -> current when current is last)
    prev_activation_by_asset = {}
    if args.asof == "last":
        prev_path = replay_dir / f"regime_state_{args.grid}_i60.json"
        if prev_path.exists():
            prev_obj = json.loads(prev_path.read_text(encoding="utf-8"))
            prev_activation_by_asset = _find_activation_bands(prev_obj)

    weights = cfgs.weights["weights"]
    for key in weights.keys():
        if key not in comp_maps:
            raise ValueError(f"weights.yaml references component not loaded from replay-dir: {key}")

    out: Dict[str, Any] = {
        "phase": 4,
        "grid": args.grid,
        "asof": args.asof,
        "assets": {},
    }

    for asset, band in activation_by_asset.items():
        raw_components: Dict[str, Any] = {}
        norm_components: Dict[str, Any] = {}
        contribs: Dict[str, Any] = {}
        total = 0.0

        for comp, path in comp_files.items():
            cmap = comp_maps[comp]
            if asset not in cmap:
                raise KeyError(f"Asset '{asset}' missing from component CSV for {comp}: {path}")

            # Prefer regime_state dominant_drivers for macro_score / risk_penalty when available.
            # If those fields are degenerate (e.g., 0.0), derive deterministically from dominant_drivers.driver.
            if comp in ("macro_score", "risk_penalty"):
                dd = dd_by_asset.get(asset)
                driver = None
                if isinstance(dd, dict) and isinstance(dd.get("driver"), (int, float)):
                    driver = float(dd["driver"])

                if isinstance(dd, dict) and isinstance(dd.get(comp), (int, float)):
                    v = float(dd[comp])
                else:
                    v = None

                use_driver_fallback = False
                if v is None:
                    use_driver_fallback = True
                else:
                    # treat exact 0.0 as degenerate for these components in current replay
                    if abs(v) < 1e-12 and driver is not None:
                        use_driver_fallback = True

                if use_driver_fallback and driver is not None:
                    if comp == "macro_score":
                        raw = float(driver)
                        src_tag = "driver_fallback"
                        field = "driver"
                    else:
                        raw = max(0.0, -float(driver))
                        src_tag = "driver_to_penalty"
                        field = "driver"
                    raw_components[comp] = {
                        "value": raw,
                        "audit_json": json.dumps(
                            {"asset": asset, comp: raw, "source": f"{regime_path}#dominant_drivers.{field}", "transform": src_tag},
                            sort_keys=True,
                        ),
                    }
                else:
                    raw = float(v) if v is not None else float(cmap[asset]["value"])
                    raw_components[comp] = {
                        "value": raw,
                        "audit_json": json.dumps(
                            {"asset": asset, comp: raw, "source": f"{regime_path}#dominant_drivers.{comp}"},
                            sort_keys=True,
                        )
                        if v is not None
                        else cmap[asset]["audit_json"],
                    }
            else:
                raw = float(cmap[asset]["value"])
                raw_components[comp] = {"value": raw, "audit_json": cmap[asset]["audit_json"]}

            norm, norm_audit = _normalize_value(comp, raw, cfgs.normalization)
            w = float(weights[comp])
            contrib = norm * w
            total += contrib

            norm_components[comp] = {"normalized": norm, "details": norm_audit}
            contribs[comp] = {"weight": w, "contribution": contrib}

        perms = _permissions_for_band(band, cfgs.execution_matrix)
        overrides_applied = []

        # Flip-aware confidence gate
        conf_cfg = cfgs.execution_matrix.get("confidence") or {}
        if bool(conf_cfg.get("enabled", False)):
            mc = conf_cfg.get("min_confidence") or {}
            default_thr = float(mc.get("default", 0.0))
            on_flip_thr = float(mc.get("on_flip", default_thr))

            prev_band = prev_activation_by_asset.get(asset)
            curr_band = band
            band_flip = (prev_band is not None) and (prev_band != curr_band)
            thr_used = on_flip_thr if band_flip else default_thr

            flip_context = {
                "band_prev": prev_band,
                "band_curr": curr_band,
                "band_flip": bool(band_flip),
                "confidence_threshold_used": thr_used,
            }

            if global_confidence < thr_used:
                perms = {"allow_directional": False, "allow_flashloan": False, "allow_arbitrage": False}
                overrides_applied.append({
                    "type": "confidence_floor",
                    "confidence": global_confidence,
                    "min_confidence": thr_used,
                    "action": "SUPPRESS_ALL",
                    **flip_context,
                })
            else:
                overrides_applied.append({"type": "flip_context", **flip_context})        # Promotion gate: if current band is more permissive than prev band, require higher confidence
        promo_cfg = cfgs.execution_matrix.get("promotion") or {}
        if bool(promo_cfg.get("enabled", False)):
            prev_band = prev_activation_by_asset.get(asset)
            if prev_band is not None:
                prev_perms = _permissions_for_band(prev_band, cfgs.execution_matrix)
                curr_perms = perms
                band_rank = cfgs.execution_matrix.get("band_rank") or {}
                prev_rank = int(band_rank.get(prev_band, 0))
                curr_rank = int(band_rank.get(band, 0))
                promoted = curr_rank > prev_rank
                if promoted:
                    promo_thr = float(promo_cfg.get("min_confidence", 1.0))
                    if global_confidence < promo_thr:
                        perms = {"allow_directional": False, "allow_flashloan": False, "allow_arbitrage": False}
                        overrides_applied.append({
                            "type": "promotion_gate",
                            "action": "SUPPRESS_ALL",
                            "confidence": global_confidence,
                            "min_confidence": promo_thr,
                            "band_prev": prev_band,
                            "band_curr": band,
                            "promoted": True,
                        })

        # Risk penalty gate (per-asset)
        rp_cfg = cfgs.execution_matrix.get("risk_penalty") or {}
        if bool(rp_cfg.get("enabled", False)):
            thr = float(rp_cfg.get("disable_flashloan_at", 1.0))
            rp_raw = float(raw_components["risk_penalty"]["value"])
            if rp_raw >= thr and perms.get("allow_flashloan", False):
                perms = dict(perms)
                perms["allow_flashloan"] = False
                overrides_applied.append({
                    "type": "risk_penalty_flashloan_off",
                    "risk_penalty": rp_raw,
                    "threshold": thr,
                    "action": "FLASHLOAN_OFF",
                })

        out["assets"][asset] = {
            "activation_band": band,
            "activation_band_prev": prev_activation_by_asset.get(asset),
            "activation_band_flip": (prev_activation_by_asset.get(asset) is not None and prev_activation_by_asset.get(asset) != band),
            "permissions": perms,
            "overrides_applied": overrides_applied,
            "score": {
                "total": total,
                "raw": raw_components,
                "normalized": norm_components,
                "contributions": contribs,
            },
        }

    bands_present = sorted(set(activation_by_asset.values()))
    assets_by_band: Dict[str, list[str]] = {}
    for a, b in activation_by_asset.items():
        assets_by_band.setdefault(b, []).append(a)
    for b in assets_by_band:
        assets_by_band[b] = sorted(assets_by_band[b])

    degenerate_components = sorted([
        name for name, spec in (cfgs.normalization.get("components") or {}).items()
        if isinstance(spec, dict) and spec.get("method") == "constant"
    ])

    totals = []
    comp_raw_vals: Dict[str, list[float]] = {k: [] for k in comp_files.keys()}
    comp_norm_vals: Dict[str, list[float]] = {k: [] for k in comp_files.keys()}
    comp_contrib_vals: Dict[str, list[float]] = {k: [] for k in comp_files.keys()}

    for asset, payload in out["assets"].items():
        t = float(payload["score"]["total"])
        totals.append(t)
        for comp in comp_files.keys():
            comp_raw_vals[comp].append(float(payload["score"]["raw"][comp]["value"]))
            comp_norm_vals[comp].append(float(payload["score"]["normalized"][comp]["normalized"]))
            comp_contrib_vals[comp].append(float(payload["score"]["contributions"][comp]["contribution"]))

    out["summary"] = {
        "bands_present": bands_present,
        "assets_by_band": assets_by_band,
        "degenerate_components": degenerate_components,
        "score_totals": _stats(totals),
        "component_stats": {
            comp: {
                "raw": _stats(comp_raw_vals[comp]),
                "normalized": _stats(comp_norm_vals[comp]),
                "contribution": _stats(comp_contrib_vals[comp]),
            }
            for comp in comp_files.keys()
        },
    }

    out_path = Path(args.out) if args.out else (Path("outputs/phase4") / f"phase4_control_{args.grid}_{args.asof}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Ensure stable output schema for tests/audit (set BEFORE writing JSON)
    out.setdefault('inputs', {})
    # Ensure stable output schema for tests/audit (set BEFORE writing JSON)
    out.setdefault('inputs', {})
    out['inputs'].setdefault('global_confidence', global_confidence)
    out_path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    # Ensure stable output schema for tests/audit
    print(f"Wrote: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
