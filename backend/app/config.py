from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import model_validator
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
        # --- UI simplifications (libertex gift build only) ---
        "hide_swaps_ui":      False,   # hide the swap toggle section
        "force_swaps":        False,   # force overnight swaps ON regardless of request
        "hide_min_variance":  False,   # hide the Min Variance strategy everywhere
        "ai_strategy_naming": False,   # rename Max Sharpe -> "AI choice"
        "hide_backtest":      False,   # hide the Backtest page + nav link
        "hide_compare":       False,   # hide the Compare page + nav link
        "nobel_hero":         False,   # consumer "Nobel portfolio" dashboard hero
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
        # Simplified, consumer-friendly UI for the Libertex gift build.
        "hide_swaps_ui":      True,    # swaps are always on; no toggle shown
        "force_swaps":        True,    # every portfolio already nets out swaps
        "hide_min_variance":  True,    # only AI (max-Sharpe) & target strategies
        "ai_strategy_naming": True,    # Max Sharpe shown as "AI choice"
        "hide_backtest":      True,    # no Backtest page in the gift build
        "hide_compare":       True,    # no Compare page in the gift build
        "nobel_hero":         True,    # "Create your own Nobel portfolio!" hero
    },
}


# ---------------------------------------------------------------------------
# Editions (white-label) — one codebase, two products
# ---------------------------------------------------------------------------
# `EDITION` in .env selects which product this instance IS. It drives three
# things: (1) which FEATURE_FLAGS set is active, (2) branding (name/tagline/
# broker term), and (3) the frontend theme (via a data-edition attribute the
# UI sets from /api/config). Full = the broad-audience, monetised product with
# generic terminology; libertex = the stripped-down, Libertex-branded gift
# build. Run two instances of the SAME code, each with its own .env.
EDITIONS: Dict[str, Dict[str, Any]] = {
    "full": {
        "feature_key": "personal",
        "app_name":    "Portfolio Lab",
        "tagline":     "Markowitz Engine",
        # broker_name is interpolated into user-facing copy. Empty here so the
        # full build reads broker-agnostic ("overnight financing costs", not
        # "Libertex swap costs").
        "broker_name": "",
        "theme":       "full",   # frontend maps this to its cyan/magenta theme
    },
    "libertex": {
        "feature_key": "libertex_lite",
        "app_name":    "Libertex Portfolio Builder",
        "tagline":     "Markowitz Engine",
        "broker_name": "Libertex",
        "theme":       "libertex",  # frontend maps this to the red theme
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SECRET_KEY, ADMIN_EMAIL and ADMIN_PASSWORD have NO defaults on purpose:
    # pydantic-settings raises at import if they're missing from the
    # environment / .env, so the app can never silently boot with a known
    # placeholder key (which would let anyone forge admin JWTs). The
    # _reject_weak_secrets validator below further bans placeholder values
    # and enforces minimum strength.
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24h; revocation via token_version

    DATABASE_URL: str = f"sqlite:///{BACKEND_ROOT / 'data' / 'portfolio_lab.db'}"

    ADMIN_EMAIL: str
    ADMIN_PASSWORD: str
    ADMIN_NAME: str = "Admin"

    DEFAULT_DAILY_LIMIT: int = 5
    DEFAULT_WEEKLY_LIMIT: Optional[int] = None

    # --- Self-service registration ---------------------------------------
    # When true, new sign-ups are auto-approved (no admin gate) and get the
    # default quotas below. Flip to false to restore the manual-approval flow.
    AUTO_APPROVE_REGISTRATIONS: bool = True
    NEW_USER_DAILY_LIMIT: int = 5
    NEW_USER_WEEKLY_LIMIT: int = 15

    # Anti-abuse caps on the public /register endpoint. A successful sign-up
    # is logged with its source IP + a device cookie; a new attempt is
    # rejected once either count reaches the cap within the rolling window.
    # The IP cap is the hard backstop (a spammer can clear the device cookie
    # but not trivially change IP); the device cap stops casual same-browser
    # spam. Tune via .env if a shared NAT needs more headroom.
    REG_MAX_PER_IP: int = 2
    REG_MAX_PER_DEVICE: int = 2
    REG_WINDOW_DAYS: int = 7

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

    DEPLOYMENT_MODE: str = "personal"  # legacy; kept for /health display

    # Which product this instance is: "full" (broad-audience, monetised,
    # generic branding) or "libertex" (stripped, Libertex-branded gift).
    # Drives features + branding + frontend theme. Default full so the live
    # instance keeps its current behaviour.
    EDITION: str = "full"

    # Interactive API docs (/docs, /redoc, /openapi.json) are OFF by default —
    # on an internet-facing deploy they hand an attacker the full API map.
    # Set ENABLE_DOCS=true in a local .env only when you need them.
    ENABLE_DOCS: bool = False

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    @model_validator(mode="after")
    def _reject_weak_secrets(self) -> "Settings":
        """Fail fast on placeholder / weak security values.

        These checks run at process start (Settings() is instantiated at
        import). If they raise, the server won't boot — which is the
        intended behaviour: a misconfigured deploy should never come up
        with a guessable signing key or admin password.
        """
        sk = self.SECRET_KEY or ""
        weak_markers = ("change-me", "change_me", "dev-secret", "CHANGE_ME")
        if any(m in sk for m in weak_markers):
            raise ValueError(
                "SECRET_KEY looks like a placeholder. Generate a real one: "
                "python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        if len(sk) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters.")
        pw = self.ADMIN_PASSWORD or ""
        if any(m in pw for m in ("CHANGE_ME", "change-me")) or len(pw) < 12:
            raise ValueError(
                "ADMIN_PASSWORD must be a real password of at least 12 characters."
            )
        # CORS must never be wildcarded — credentials are allowed.
        if "*" in self.CORS_ORIGINS:
            raise ValueError("CORS_ORIGINS must list explicit origins, never '*'.")
        return self

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def edition(self) -> Dict[str, Any]:
        """Branding + feature-key for the active EDITION (falls back to full)."""
        return EDITIONS.get(self.EDITION, EDITIONS["full"])

    @property
    def features(self) -> Dict[str, Any]:
        """Active feature flags — selected by EDITION's feature_key."""
        return FEATURE_FLAGS.get(self.edition["feature_key"], FEATURE_FLAGS["personal"])

    def feature(self, name: str, default: Any = None) -> Any:
        """Look up a single feature flag value for the active edition."""
        return self.features.get(name, default)

    @property
    def branding(self) -> Dict[str, Any]:
        """Branding tokens the frontend renders (name, tagline, broker, theme)."""
        e = self.edition
        return {
            "app_name": e["app_name"],
            "tagline": e["tagline"],
            "broker_name": e["broker_name"],
            "theme": e["theme"],
        }


settings = Settings()


def ensure_directories() -> None:
    for path in (
        settings.PRICES_CACHE_DIR,
        settings.EXPORTS_DIR,
        settings.BACKUPS_DIR,
        settings.LOGS_DIR,
    ):
        Path(path).mkdir(parents=True, exist_ok=True)
