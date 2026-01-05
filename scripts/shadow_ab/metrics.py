from __future__ import annotations

from typing import Any, Dict, List

from .contracts import DecisionRecord

def compute_metrics(
    baseline: List[DecisionRecord],
    candidate: List[DecisionRecord],
) -> Dict[str, Any]:
    """Minimal metric stub.

    Real metrics (MDD, tail loss, profit factor) require PnL simulation, fees, etc.
    This stub focuses on decision stability placeholders until you wire in the full stack.
    """
    def churn(decisions: List[DecisionRecord]) -> int:
        # Counts regime flips; with UNKNOWN this will be 0, but the shape is correct.
        flips = 0
        last = None
        for d in decisions:
            if last is not None and d.regime != last:
                flips += 1
            last = d.regime
        return flips

    baseline_churn = churn(baseline)
    candidate_churn = churn(candidate)

    detail = {
        "window": {"n": min(len(baseline), len(candidate))},
        "decision_quality": {
            "baseline_regime_flips": baseline_churn,
            "candidate_regime_flips": candidate_churn,
        },
        "pnl": {
            "available": False,
            "reason": "PnL simulation not wired in yet (intentional for skeleton).",
        },
    }
    return detail

def format_onepage(detail: Dict[str, Any]) -> str:
    n = detail.get("window", {}).get("n", "N/A")
    dq = detail.get("decision_quality", {})
    return (
        "SHADOW A/B METRICS (ONE-PAGE)\n"
        "==========================\n"
        f"Samples compared: {n}\n\n"
        "Decision Stability\n"
        "------------------\n"
        f"Baseline regime flips: {dq.get('baseline_regime_flips','N/A')}\n"
        f"Candidate regime flips: {dq.get('candidate_regime_flips','N/A')}\n\n"
        "PnL\n"
        "---\n"
        "PnL metrics: N/A (skeleton mode; wire in simulation later)\n"
    )
