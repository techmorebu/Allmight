"""
Phase 9 test-only spy utilities.

Hard rule: these helpers must NEVER perform real network I/O.
They only record attempted calls and optionally raise controlled exceptions.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class NetAttempt:
    method: str
    url: str
    kwargs: Dict[str, Any]


class NetworkGateSpy:
    """
    A duck-typed spy that can stand in for common NetworkGate shapes.

    It exposes:
      - request(method, url, **kwargs)
      - get(url, **kwargs)

    If your NetworkGate uses a different method name, adapt in tests by
    calling the matching attribute on this spy (or add an alias here).
    """
    def __init__(self, *, raise_exc: Optional[BaseException] = None):
        self.attempts: List[NetAttempt] = []
        self.raise_exc = raise_exc

    def request(self, method: str, url: str, **kwargs) -> Any:
        self.attempts.append(NetAttempt(method=method, url=url, kwargs=dict(kwargs)))
        if self.raise_exc is not None:
            raise self.raise_exc
        # Return a fake "response-like" object by default; tests can override.
        return {"_fake": True, "status": 200, "text": "{}", "headers": {"content-type": "application/json"}}

    def get(self, url: str, **kwargs) -> Any:
        return self.request("GET", url, **kwargs)

    @property
    def call_count(self) -> int:
        return len(self.attempts)
