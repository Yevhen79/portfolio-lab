import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.deps import get_approved_user
from app.database import get_db
from app.models import User
from app.schemas import OptimizeRequest, OptimizeResponse
from app.services import portfolio_engine, quota
from app.services.errors import PortfolioBuildError


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/optimize", tags=["optimize"])


@router.get("/trace/{trace_id}")
def download_trace(
    trace_id: str,
    _: User = Depends(get_approved_user),
):
    """Download the per-run pipeline trace as a Markdown file.

    The optimize endpoint writes one such file per successful run; the
    response includes the `trace_id`. Restricted to authenticated users.
    Path-validation prevents traversal (`../`) — only hex-uuid filenames
    in the configured traces directory are served.
    """
    # Guard against path traversal — only 32-char hex IDs (uuid.hex format).
    if not re.fullmatch(r"[0-9a-f]{32}", trace_id):
        raise HTTPException(status_code=404, detail="Invalid trace id")
    path = portfolio_engine.TRACES_DIR / f"{trace_id}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Trace not found")
    return FileResponse(
        path,
        media_type="text/markdown; charset=utf-8",
        filename=f"portfolio-trace-{trace_id[:8]}.md",
    )


@router.post("", response_model=OptimizeResponse)
def optimize(
    req: OptimizeRequest,
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
) -> OptimizeResponse:
    """Run optimization. Does NOT consume quota — only saving consumes it.

    Error handling, layered:
      * `PortfolioBuildError` — known infeasibility case (target unreachable,
        empty universe, etc.). Returns 422 with a structured detail
        `{"code": "...", "context": {...}}` that the frontend translates.
      * `ValueError` — anything else the engine surfaces as a "user error".
        Returns 422 with raw message; rare path, kept for backward compat.
      * Anything else → 500 with class name + message, full traceback logged.
    """
    try:
        return portfolio_engine.build_portfolio(db, req)
    except PortfolioBuildError as exc:
        logger.info("Portfolio build rejected: %s (%s)", exc.code, exc.context)
        raise HTTPException(status_code=422, detail=exc.to_dict())
    except ValueError as exc:
        logger.warning("Optimization rejected (legacy): %s", exc)
        raise HTTPException(
            status_code=422,
            detail={"code": "GENERIC", "context": {"message": str(exc)}},
        )
    except Exception as exc:
        logger.exception("Optimization crashed (%s): %s", type(exc).__name__, exc)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL",
                "context": {"message": f"{type(exc).__name__}: {exc}"},
            },
        )


@router.get("/quota-status")
def quota_status(
    user: User = Depends(get_approved_user),
    db: Session = Depends(get_db),
):
    allowed, reason, info = quota.check_can_generate(db, user)
    return {"can_generate": allowed, "reason": reason, **info}
