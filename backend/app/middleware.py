"""Security middleware: rate limiting + hardening headers.

Self-contained (no extra dependency). Two concerns:

1. RateLimitMiddleware — a sliding-window per-client limiter. Auth endpoints
   get a strict budget (brute-force / enumeration defence), the expensive
   compute endpoints (optimize / backtest) a moderate one (DoS defence), and
   everything else a generous global cap. Keyed on the real client IP, which
   behind ngrok arrives in X-Forwarded-For.

2. SecurityHeadersMiddleware — adds the standard hardening headers
   (HSTS, nosniff, frame-deny, referrer policy, a conservative CSP).

In-process state — fine for a single-worker uvicorn. If the app ever scales to
multiple workers/hosts, move the counters to Redis.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


# (max_requests, window_seconds) per path prefix. First match wins.
_RULES: list[tuple[str, Tuple[int, int]]] = [
    ("/api/auth/login", (10, 15 * 60)),       # 10 attempts / 15 min
    ("/api/auth/register", (5, 60 * 60)),     # 5 / hour
    ("/api/auth/change-password", (5, 15 * 60)),
    ("/api/optimize", (30, 5 * 60)),          # 30 heavy builds / 5 min
    ("/api/backtest", (30, 5 * 60)),
    ("/api/export", (40, 5 * 60)),            # document generation
]
# Global fallback for any other /api path.
_GLOBAL_RULE: Tuple[int, int] = (300, 60)     # 300 req / min per IP


def client_ip(request: Request) -> str:
    """Best-effort real client IP. ngrok / reverse proxies put the real
    client first in X-Forwarded-For; fall back to the socket peer."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# Backwards-compatible private alias used within this module.
_client_ip = client_ip


def _rule_for(path: str) -> Tuple[int, int]:
    for prefix, rule in _RULES:
        if path.startswith(prefix):
            return rule
    return _GLOBAL_RULE


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        # key -> deque[timestamps]
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Only meter the API surface; skip static/docs/health.
        if not path.startswith("/api") or path == "/api/health":
            return await call_next(request)

        max_req, window = _rule_for(path)
        key = f"{_client_ip(request)}|{_bucket(path)}"
        now = time.monotonic()
        dq = self._hits[key]
        # Drop timestamps outside the window.
        cutoff = now - window
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= max_req:
            retry = int(dq[0] + window - now) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={"Retry-After": str(max(retry, 1))},
            )
        dq.append(now)
        # Opportunistic cleanup so the dict doesn't grow unbounded.
        if len(self._hits) > 10000:
            self._gc(now)
        return await call_next(request)

    def _gc(self, now: float) -> None:
        dead = [k for k, dq in self._hits.items() if not dq or dq[-1] < now - 3600]
        for k in dead:
            self._hits.pop(k, None)


def _bucket(path: str) -> str:
    """Collapse a path to its rate-limit bucket so /optimize and
    /optimize/trace/<id> share one counter."""
    for prefix, _ in _RULES:
        if path.startswith(prefix):
            return prefix
    return "global"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
        # The API serves JSON only; a strict CSP costs nothing here and blocks
        # any accidental HTML/script rendering. The SPA is served separately
        # by Vite/static hosting with its own policy.
        response.headers.setdefault(
            "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
        )
        return response
