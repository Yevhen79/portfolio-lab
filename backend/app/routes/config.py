"""Public deployment configuration endpoint.

The frontend calls /api/config on bootstrap to learn which features are
available in the current build (personal vs libertex_lite). Locked controls
are then hidden in the UI.
"""
from fastapi import APIRouter

from app.config import settings


router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def get_config() -> dict:
    b = settings.branding
    return {
        "deployment_mode": settings.DEPLOYMENT_MODE,
        "edition": settings.EDITION,          # "full" | "libertex"
        "features": settings.features,
        "app_name": b["app_name"],
        "tagline": b["tagline"],
        "broker_name": b["broker_name"],      # "" for full, "Libertex" for libertex
        "theme": b["theme"],                  # frontend swaps CSS vars on this
    }
