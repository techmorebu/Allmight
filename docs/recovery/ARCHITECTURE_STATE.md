# ALLMIGHT — ARCHITECTURE STATE

## Supervision model
A component can appear healthy at one layer while useful work has stopped.
Health therefore uses independent authorities:

1. process — is the process alive?
2. heartbeat — is the worker loop turning?
3. output — is useful work landing?

`controlState`: PASSING | DEGRADED | FAILED | UNKNOWN
`healthState`: HEALTHY | PARTIAL | UNVERIFIABLE | DEGRADED | FAILED | UNKNOWN

HEALTHY is reserved for certified health and requires every required authority to be ACTIVE and passing.

A DECLARED signal is not failure authority until its producer is proven DEPLOYED.
PENDING_MIGRATION maps to NOT_APPLICABLE, never FAIL.

Empty-set semantics:
NO OBSERVATION YET != STALE OBSERVATION != FAILED PRODUCER.

At the frozen checkpoint, heat was the first component to reach certified 3-of-3 health.

## Runtime safety
Recovery/archive work has no authority to:
- restart or repair notification_router
- activate another heartbeat
- restart the stack
- access Redis for new recovery work
- enable live trading
- sign or broadcast
- move capital
