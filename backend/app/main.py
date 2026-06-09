"""FastAPI application entry point."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  -- ensures models are registered with Base
from app.config import ensure_directories, settings
from app.database import Base, engine
from app.routes import admin, assets, auth, backtest, config as config_route, export, optimize, portfolios, users


def configure_logging() -> None:
    ensure_directories()
    log_file = Path(settings.LOGS_DIR) / "app.log"
    handler = RotatingFileHandler(log_file, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    stream = logging.StreamHandler()
    stream.setFormatter(formatter)
    root.addHandler(stream)


configure_logging()
logger = logging.getLogger(__name__)


def _migrate_schema() -> None:
    """Lightweight additive migrations for columns added after the DB was
    first created (SQLAlchemy's create_all never ALTERs existing tables).
    Idempotent: each ADD COLUMN is guarded by a PRAGMA existence check."""
    from sqlalchemy import text

    additions = {
        "users": [("token_version", "INTEGER NOT NULL DEFAULT 0")],
    }
    try:
        with engine.begin() as conn:
            for table, cols in additions.items():
                existing = {
                    row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
                }
                for col, ddl in cols:
                    if col not in existing:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                        logger.info("Schema migration: added %s.%s", table, col)
    except Exception as exc:
        logger.warning("Schema migration check failed: %s", exc)


def create_app() -> FastAPI:
    # Interactive docs are gated behind ENABLE_DOCS (default off) so the
    # OpenAPI schema isn't public on an internet-facing deploy.
    docs_url = "/docs" if settings.ENABLE_DOCS else None
    redoc_url = "/redoc" if settings.ENABLE_DOCS else None
    openapi_url = "/openapi.json" if settings.ENABLE_DOCS else None

    app = FastAPI(
        title="Portfolio Lab API",
        description="Markowitz mean-variance portfolio optimization with full analytics.",
        version="1.0.0",
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
    )

    # Hardening headers on every response.
    from app.middleware import RateLimitMiddleware, SecurityHeadersMiddleware
    app.add_middleware(SecurityHeadersMiddleware)
    # Per-IP sliding-window rate limiting (auth brute-force + compute DoS).
    app.add_middleware(RateLimitMiddleware)

    # CORS: explicit origins only, never a wildcard alongside credentials.
    # Methods/headers are scoped to what the SPA actually uses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    Base.metadata.create_all(bind=engine)
    _migrate_schema()

    app.include_router(config_route.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(assets.router, prefix="/api")
    app.include_router(optimize.router, prefix="/api")
    app.include_router(backtest.router, prefix="/api")
    app.include_router(portfolios.router, prefix="/api")
    app.include_router(export.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "service": "Portfolio Lab",
            "mode": settings.DEPLOYMENT_MODE,
        }

    @app.on_event("startup")
    def on_startup():
        logger.info(
            "Portfolio Lab API starting up (deployment_mode=%s)",
            settings.DEPLOYMENT_MODE,
        )
        # Weekly swap-rate refresh. Checks data/swap_refresh.json — if the
        # last successful refresh was > 7 days ago (or never), schedules a
        # background scrape + DB populate. Startup is NOT blocked: the
        # refresh runs in a daemon thread and writes its result when done.
        try:
            from app.services.swap_refresh import maybe_refresh_on_startup
            maybe_refresh_on_startup()
        except Exception as exc:
            logger.warning("Swap-refresh boot check failed: %s", exc)

    return app


app = create_app()
