# Portfolio Lab

Markowitz mean-variance portfolio optimizer with a modern interactive web UI.

Features:
- 4 optimization objectives: Min Variance, Max Sharpe, Target Return, Target Risk
- Long-only, no maximum-weight cap, automatic risk-free rate (10Y Treasury via yfinance)
- Estimation: monthly returns, up to 20 years history (configurable), Ledoit-Wolf shrinkage cov matrix
- Filters: drops assets with insufficient history (< 6 years default), drops assets with non-positive mean
- 12-month forecast: analytical metrics + Monte Carlo (5,000 sims) + S&P 500 benchmark
- Sparsification (1% threshold) with renormalization
- Multi-user with admin approval, per-user daily/weekly quotas, quota request workflow
- Portfolio sharing, comparison, PDF / Excel export
- Dark neon UI, Plotly dashboards, responsive layout

## Stack
- **Backend:** Python 3.11 / FastAPI / SQLAlchemy / SQLite / cvxpy / scikit-learn / yfinance
- **Frontend:** React 18 / TypeScript / Vite / Tailwind / Plotly / Zustand
- **Auth:** JWT + bcrypt
- **Data:** yfinance (primary) + TradingView MCP (fallback for missing tickers)

## Quick Start (Windows)

**Prerequisites:** Python 3.11 (preferred) or 3.13. Node.js 18+. `cloudflared` (optional, for public access).

```bat
setup.bat
start.bat
```

`setup.bat` (run once, ~5–10 min):
1. Detects an installed Python 3.11 / 3.13 (skips 3.14 because some wheels are missing).
2. Creates `backend/.venv`, installs Python deps with `--only-binary=:all:` (fast, no compilation).
3. Copies `.env.example → .env`, runs `seed.py` (admin user + ~180 Libertex CFDs).
4. Runs `npm install` in `frontend/`.

`start.bat` (every launch):
1. Opens 3 windows: FastAPI on `:8000`, Vite on `:5173`, Cloudflare Tunnel.
2. The tunnel window prints a public `*.trycloudflare.com` URL after a few seconds — share that with anyone.

Open `http://localhost:5173` (or the trycloudflare URL). Default admin:
- email: `evgenij.shakotko@gmail.com`
- password: `12345`

Other users register via the form; the admin must approve them before they can save portfolios.

### Flags
- `start.bat --no-tunnel` — local + LAN only, no public URL.
- `start.bat --backend` / `--frontend` — start one half only.

### Installing cloudflared (if missing)
```bat
winget install Cloudflare.cloudflared
```
No account or auth token needed for quick tunnels — just run and copy the URL.

## Quick Start (Linux/macOS)
```bash
./start.sh
```

## Project Layout
```
portfolio-lab/
├── backend/
│   ├── app/
│   │   ├── main.py                FastAPI entry
│   │   ├── config.py              Settings
│   │   ├── database.py            SQLAlchemy session
│   │   ├── auth/                  JWT, password hashing, deps
│   │   ├── models/                User, Portfolio, Asset, AuditLog, ...
│   │   ├── schemas/               Pydantic IO schemas
│   │   ├── routes/                auth, users, portfolios, optimize, admin, export, assets
│   │   └── services/
│   │       ├── data_loader.py     yfinance + parquet cache
│   │       ├── universe.py        builds the returns DataFrame
│   │       ├── optimizer.py       cvxpy mean-variance optimizer
│   │       ├── metrics.py         Sharpe / Sortino / VaR / CVaR / MDD
│   │       ├── monte_carlo.py     forward simulation (12 months)
│   │       ├── portfolio_engine.py  full pipeline
│   │       ├── libertex_seed.py   curated seed list (~180 instruments)
│   │       ├── libertex_parser.py loads seed or refreshed cache
│   │       ├── exporter.py        PDF + Excel
│   │       └── quota.py           daily/weekly limits + bonus
│   ├── data/                      SQLite DB + parquet cache + exports
│   ├── seed.py                    bootstraps DB
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/                   Axios client + endpoints
│   │   ├── components/            Layout, charts, tables, ...
│   │   ├── pages/                 Login, Register, Dashboard, Builder, View, Compare, History, Admin
│   │   ├── store/                 Zustand auth store
│   │   └── utils/                 formatters
│   └── ...                        Vite + Tailwind + TS configs
├── start.bat / start.sh
└── README.md
```

## Math
The optimizer minimizes the quadratic form `½ wᵀ Σ w` subject to:
- `wᵀ μ ≥ target` (for target-return) **or** `wᵀ Σ w ≤ σ²` (for target-risk)
- `Σ wᵢ = 1` (full investment)
- `w ≥ 0` (long-only)

For Max Sharpe we use the standard reformulation: minimize `yᵀΣy` s.t. `(μ − rᶠ)ᵀy = 1, y ≥ 0`,
then renormalize `w = y / Σy`.

`μ` is the sample mean of monthly returns; `Σ` is the **Ledoit-Wolf shrunk covariance** by default
(switchable to sample or EWMA). All metrics displayed are **annualized**.

## Refreshing the Asset Universe
The shipped seed list covers ~180 of the most liquid Libertex CFDs across stocks (US/EU), indices,
commodities, FX, ETFs and crypto. To refresh from the live Libertex spec page, use the
"Refresh Libertex Universe" button on the Admin page. To extend manually, edit
`backend/app/services/libertex_seed.py` or drop a JSON list at `backend/data/libertex_assets.json`.

## ngrok (Remote Access)
1. Install ngrok and `ngrok config add-authtoken <TOKEN>`.
2. Run `start.bat`. A separate window will start `ngrok http 5173`.
3. Share the public URL.

## Notes
- First optimization will be slow because yfinance has to download history for ~180 symbols
  (~30-60s). Subsequent runs hit the 24-hour parquet cache and complete in seconds.
- The TradingView MCP is used only as a fallback for tickers yfinance cannot resolve and for
  live spot quotes; it is not required for normal operation.
- Saved portfolios consume the user's daily quota (1 save = 1 generation). Optimizing without
  saving does NOT consume quota — users can experiment freely.
