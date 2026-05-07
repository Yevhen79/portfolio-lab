from pathlib import Path
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parent.parent


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

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()


def ensure_directories() -> None:
    for path in (
        settings.PRICES_CACHE_DIR,
        settings.EXPORTS_DIR,
        settings.BACKUPS_DIR,
        settings.LOGS_DIR,
    ):
        Path(path).mkdir(parents=True, exist_ok=True)
