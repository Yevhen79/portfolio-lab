"""FastAPI application entry point."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  -- ensures models are registered with Base
from app.config import ensure_directories, settings
from app.database import Base, engine
from app.routes import admin, assets, auth, config as config_route, export, optimize, portfolios, users


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


def create_app() -> FastAPI:
    app = FastAPI(
        title="Portfolio Lab API",
        description="Markowitz mean-variance portfolio optimization with full analytics.",
        version="1.0.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list + ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    Base.metadata.create_all(bind=engine)

    app.include_router(config_route.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(assets.router, prefix="/api")
    app.include_router(optimize.router, prefix="/api")
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
