from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Dual-version feature flags
# ---------------------------------------------------------------------------
# The same codebase ships as two products:
#   * "personal"      — full version, used by the project owner and (later)
#                       sold as retail SaaS. All features ON.
#   * "libertex_lite" — gift / B2B-trial version. Stripped-down feature set
#                       so Libertex (or any partner) can deploy without
#                       getting the premium IP (Black-Litterman, broker API,
#                       advanced metrics, etc.).
#
# Setting DEPLOYMENT_MODE in .env switches the active set. Code calls
# `settings.feature("xyz")` to gate behaviour, and the same dict is exposed
# to the frontend via /api/config so the UI hides locked controls.

FEATURE_FLAGS: Dict[str, Dict[str, Any]] = {
    "personal": {
        # Hard cap. Live Libertex catalogue is ~1500; this leaves headroom.
        # Frontend slider exposes up to 1500 explicitly via an "All" button.
        "max_assets":         2000,
        "advanced_metrics":   True,    # Sortino, Calmar, Omega, Treynor, etc.
        "black_litterman":    True,    # subjective views overlay
        "monte_carlo":        True,
        "custom_constraints": True,    # max-weight, sector caps, ESG screens
        "broker_api":         True,    # live execution via partner APIs
        "export_formats":     ["pdf", "excel", "csv"],
        "cov_methods":        ["sample", "ewma", "ledoit_wolf"],
        "geometric_mean":     True,    # show CAGR alongside arithmetic μ
        "history_max_years":  25,
        "monte_carlo_sims":   5000,
    },
    "libertex_lite": {
        "max_assets":         50,
        "advanced_metrics":   False,
        "black_litterman":    False,
        "monte_carlo":        False,
        "custom_constraints": False,
        "broker_api":         False,
        "export_formats":     ["pdf"],
        "cov_methods":        ["ledoit_wolf"],
        "geometric_mean":     True,    # still show CAGR — basic sanity, no IP
        "history_max_years":  10,
        "monte_carlo_sims":   1000,
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    SECRET_KEY: str = "dev-secret-change-me-please-32-chars-or-more"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    DATABASE_URL: str = f"sqlite:///{BACKEND_ROOT / 'data' / 'portfolio_lab.db'}"

    ADMIN_EMAIL: str = "evgenij.shakotko@gmail.com"
    ADMIN_PASSWORD: str = "12345"
    ADMIN_NAME: str = "Evgenij"

    DEFAULT_DAILY_LIMIT: int = 5
    DEFAULT_WEEKLY_LIMIT: Optional[int] = None

    PRICES_CACHE_DIR: str = str(BACKEND_ROOT / "data" / "prices")
    EXPORTS_DIR: str = str(BACKEND_ROOT / "data" / "exports")
    BACKUPS_DIR: str = str(BACKEND_ROOT / "data" / "backups")
    LOGS_DIR: str = str(BACKEND_ROOT / "logs")
    LIBERTEX_CACHE_FILE: str = str(BACKEND_ROOT / "data" / "libertex_assets.json")

    RISK_FREE_TICKER: str = "^TNX"
    DEFAULT_HISTORY_YEARS: int = 20
    DEFAULT_MIN_HISTORY_YEARS: int = 6
    MONTE_CARLO_SIMULATIONS: int = 5000
    SPARSIFICATION_THRESHOLD: float = 0.01

    DEPLOYMENT_MODE: str = "personal"  # "personal" | "libertex_lite"

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def features(self) -> Dict[str, Any]:
        """Active feature flags for the current DEPLOYMENT_MODE."""
        return FEATURE_FLAGS.get(self.DEPLOYMENT_MODE, FEATURE_FLAGS["personal"])

    def feature(self, name: str, default: Any = None) -> Any:
        """Look up a single feature flag value for the active deployment mode."""
        return self.features.get(name, default)


settings = Settings()


def ensure_directories() -> None:
    for path in (
        settings.PRICES_CACHE_DIR,
        settings.EXPORTS_DIR,
        settings.BACKUPS_DIR,
        settings.LOGS_DIR,
    ):
        Path(path).mkdir(parents=True, exist_ok=True)
