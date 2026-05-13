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
    return {
        "deployment_mode": settings.DEPLOYMENT_MODE,
        "features": settings.features,
        "app_name": "Portfolio Lab",
    }
