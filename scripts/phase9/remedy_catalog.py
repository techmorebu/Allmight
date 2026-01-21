from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class Remedy:
    code: str
    title: str
    meaning: str
    why_it_happens: List[str]
    immediate_actions: List[str]
    verification_commands: List[str]
    escalation: List[str]


def _r(
    code: str,
    title: str,
    meaning: str,
    why_it_happens: List[str],
    immediate_actions: List[str],
    verification_commands: List[str],
    escalation: List[str],
) -> Remedy:
    return Remedy(
        code=code,
        title=title,
        meaning=meaning,
        why_it_happens=why_it_happens,
        immediate_actions=immediate_actions,
        verification_commands=verification_commands,
        escalation=escalation,
    )


def get_remedy_catalog() -> Dict[str, Remedy]:
    # NOTE: Guidance only. No behavior changes. Fail-closed assumptions.
    return {
        "E_FLAG_REQUIRED": _r(
            code="E_FLAG_REQUIRED",
            title="Required operator acknowledgement flags missing",
            meaning="The command refused to proceed because explicit operator acknowledgement flags were not provided.",
            why_it_happens=[
                "You ran a live-adjacent command without the required acknowledgement flags.",
                "Shell quoting caused the ack phrase to be parsed differently than intended.",
            ],
            immediate_actions=[
                "Re-run the command with the required acknowledgement flags.",
                "Use explicit quoting around the ack string.",
            ],
            verification_commands=[
                "python scripts/phase5/run_phase5_live_order.py --help | sed -n '1,200p'",
                "python scripts/phase6/arming_ceremony.py --help | sed -n '1,200p'",
            ],
            escalation=[
                "If flags appear missing from --help, your branch may be stale; git pull and re-run pytest.",
            ],
        ),
        "E_LIVE_DISABLED": _r(
            code="E_LIVE_DISABLED",
            title="Live execution disabled by environment (safe default)",
            meaning="Live execution is blocked unless explicitly enabled. This is a safety gate.",
            why_it_happens=[
                "ALLMIGHT_LIVE is unset or not equal to '1'.",
                "Policy/envelope gates require live to be explicitly enabled.",
            ],
            immediate_actions=[
                "Keep using --dry-run for testing (recommended).",
                "Only when you are truly ready, set ALLMIGHT_LIVE=1 for that one command invocation.",
            ],
            verification_commands=[
                "python - <<'PY'\nimport os\nprint(os.environ.get('ALLMIGHT_LIVE'))\nPY",
                "ALLMIGHT_LIVE=1 python scripts/phase5/run_phase5_live_order.py --help | head",
            ],
            escalation=[
                "If live still denies after enabling, check kill switch and envelope validity (E_KILL_SWITCH_ACTIVE, E_ENVELOPE_INVALID).",
            ],
        ),
        "E_ARMING_REQUIRED": _r(
            code="E_ARMING_REQUIRED",
            title="Arming ceremony required before proceeding",
            meaning="The system requires a recent arming ceremony record before allowing live-adjacent actions.",
            why_it_happens=[
                "No arming record exists at the configured path.",
                "Arming ceremony wasn't run in this environment/session.",
            ],
            immediate_actions=[
                "Run the arming ceremony immediately before the intended action.",
                "Then re-run the intended command (dry-run first).",
            ],
            verification_commands=[
                "python scripts/phase6/arming_ceremony.py --i-acknowledge-live-risk --ack \"I ACKNOWLEDGE\"",
                "ls -la outputs/phase6/arming/phase6_arming.jsonl || true",
                "tail -n 3 outputs/phase6/arming/phase6_arming.jsonl || true",
            ],
            escalation=[
                "If ceremony runs but record file is missing, check permissions and that outputs/ is writable.",
            ],
        ),
        "E_ARMING_STALE": _r(
            code="E_ARMING_STALE",
            title="Arming record exists but is stale",
            meaning="An arming record was found, but it is older than the allowed max age; the system denied fail-closed.",
            why_it_happens=[
                "You waited too long after arming before executing.",
                "Clock drift or timestamp parsing mismatch made it appear old.",
            ],
            immediate_actions=[
                "Re-run arming ceremony and immediately re-run the intended action.",
                "Avoid long delays between arming and execution.",
            ],
            verification_commands=[
                "cat config/phase6/arming_policy_v0.json",
                "python scripts/phase6/arming_ceremony.py --i-acknowledge-live-risk --ack \"I ACKNOWLEDGE\"",
            ],
            escalation=[
                "If it becomes stale instantly, inspect system clock and ts_unix values in the record.",
            ],
        ),
        "E_ARMING_TTL": _r(
            code="E_ARMING_TTL",
            title="Arming TTL window violated",
            meaning="The arming TTL policy rejected execution; the arming event is outside the allowed TTL window.",
            why_it_happens=[
                "The arming event's ts_unix is outside policy TTL.",
                "TTL tightened and now requires faster execution after arming.",
            ],
            immediate_actions=[
                "Re-run arming ceremony and retry immediately.",
                "Confirm you are on canonical policy (no local modifications).",
            ],
            verification_commands=[
                "git status --porcelain",
                "cat config/phase6/arming_policy_v0.json",
                "python scripts/phase6/arming_ceremony.py --i-acknowledge-live-risk --ack \"I ACKNOWLEDGE\"",
            ],
            escalation=[
                "If TTL doesn’t match your operational needs, change via phase governance: appendix + tests + commit.",
            ],
        ),
        "E_KILL_SWITCH_ACTIVE": _r(
            code="E_KILL_SWITCH_ACTIVE",
            title="Kill switch is active (hard block)",
            meaning="A kill switch gate is enabled, blocking live actions regardless of arming/flags.",
            why_it_happens=[
                "A prior safety incident enabled it.",
                "A policy file indicates kill switch active.",
            ],
            immediate_actions=[
                "Do not bypass. Treat as a safety incident.",
                "Generate an incident report and determine why it was activated.",
            ],
            verification_commands=[
                "python scripts/phase9/audit_scan.py --deny-summary --json",
                "python scripts/phase9/audit_incident_explain.py --last-deny --window-sec 1800 --print",
            ],
            escalation=[
                "Require explicit operator decision + documented appendix to clear it.",
            ],
        ),
        "E_POLICY_INVALID": _r(
            code="E_POLICY_INVALID",
            title="Policy invalid/unreadable (fail-closed)",
            meaning="A required policy file failed validation, was missing, or could not be parsed.",
            why_it_happens=[
                "Malformed JSON.",
                "Manual edit introduced syntax error.",
                "Path changed but code expects old location.",
            ],
            immediate_actions=[
                "Restore policy from git and re-run pytest.",
                "Validate JSON using python -m json.tool.",
            ],
            verification_commands=[
                "python -m json.tool config/phase6/arming_policy_v0.json >/dev/null && echo OK",
                "git restore --staged --worktree config/phase6/arming_policy_v0.json || true",
                "pytest -q",
            ],
            escalation=[
                "If this repeats, lock policy edits behind one controlled script path + tests.",
            ],
        ),
        "E_ENVELOPE_INVALID": _r(
            code="E_ENVELOPE_INVALID",
            title="Execution envelope invalid/unreadable (fail-closed)",
            meaning="The live execution envelope is missing or invalid, so execution is blocked.",
            why_it_happens=[
                "Envelope file missing.",
                "Envelope JSON invalid.",
                "Envelope integrity mismatch.",
            ],
            immediate_actions=[
                "Restore the envelope from git and re-run tests.",
                "Do not attempt live operations until envelope validates.",
            ],
            verification_commands=[
                "ls -la config/phase5/live_execution_envelope_v0.json || true",
                "python -m json.tool config/phase5/live_execution_envelope_v0.json >/dev/null && echo OK",
                "pytest -q",
            ],
            escalation=[
                "If integrity mismatch is suspected, treat as security incident.",
            ],
        ),
    }


def explain_code(code: str) -> Optional[Remedy]:
    return get_remedy_catalog().get(code)
