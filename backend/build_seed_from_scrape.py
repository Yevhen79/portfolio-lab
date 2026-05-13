"""Read backend/data/libertex_raw.json (output of scrape_libertex.py)
and write a refreshed backend/app/services/libertex_seed.py.

Maps each Libertex ticker to a yfinance symbol. Tickers without a known
mapping are dropped from the seed (with a notice).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
RAW = ROOT / "data" / "libertex_raw.json"
OUT = ROOT / "app" / "services" / "libertex_seed.py"


# ---------- Manual stock-name → yfinance ticker map ----------
STOCK_MAP = {
    "Adidas":             ("ADS.DE", "Adidas AG", "EUR"),
    "Adobe":              ("ADBE",   "Adobe Inc.", "USD"),
    "AF":                 ("AF.PA",  "Air France-KLM", "EUR"),
    "AIR":                ("AIR.PA", "Airbus SE", "EUR"),
    "Alcoa":              ("AA",     "Alcoa Corp.", "USD"),
    "Alibaba":            ("BABA",   "Alibaba Group", "USD"),
    "Amazon":             ("AMZN",   "Amazon.com Inc.", "USD"),
    "AMC":                ("AMC",    "AMC Entertainment", "USD"),
    "American_Express":   ("AXP",    "American Express", "USD"),
    "AMX":                ("AMX",    "America Movil", "USD"),
    "Apple":              ("AAPL",   "Apple Inc.", "USD"),
    "AT&T":               ("T",      "AT&T Inc.", "USD"),
    "Baidu":              ("BIDU",   "Baidu Inc.", "USD"),
    "Banco_Santander":    ("SAN",    "Banco Santander", "USD"),
    "Bank_of_America":    ("BAC",    "Bank of America", "USD"),
    "BAS":                ("BAS.DE", "BASF SE", "EUR"),
    "Bayer":              ("BAYN.DE","Bayer AG", "EUR"),
    "BMW":                ("BMW.DE", "BMW AG", "EUR"),
    "BNP":                ("BNP.PA", "BNP Paribas", "EUR"),
    "Boeing":             ("BA",     "Boeing Co.", "USD"),
    "Caterpillar":        ("CAT",    "Caterpillar Inc.", "USD"),
    "CCL":                ("CCL",    "Carnival Corp.", "USD"),
    "CIB":                ("CIB",    "Bancolombia", "USD"),
    "Cisco":              ("CSCO",   "Cisco Systems", "USD"),
    "Citigroup":          ("C",      "Citigroup Inc.", "USD"),
    "Coca–Cola":     ("KO", "Coca-Cola Co.", "USD"),
    "Coca-Cola":          ("KO", "Coca-Cola Co.", "USD"),
    "COIN":               ("COIN",   "Coinbase Global", "USD"),
    "CX":                 ("CX",     "Cemex SAB", "USD"),
    "Deutsche_Bank":      ("DBK.DE", "Deutsche Bank AG", "EUR"),
    "DG":                 ("DG",     "Dollar General", "USD"),
    "Disney":             ("DIS",    "Walt Disney Co.", "USD"),
    "eBay":               ("EBAY",   "eBay Inc.", "USD"),
    "EC":                 ("EC",     "Ecopetrol SA", "USD"),
    "ENEL":               ("ENEL.MI","Enel SpA", "EUR"),
    "ENI":                ("ENI.MI", "Eni SpA", "EUR"),
    "ENIC":               ("ENIC",   "Entel Chile", "USD"),
    "Estee_Lauder":       ("EL",     "Estee Lauder", "USD"),
    "Ethan_Allen":        ("ETD",    "Ethan Allen", "USD"),
    "Exxon":              ("XOM",    "Exxon Mobil", "USD"),
    "Ferrari":            ("RACE",   "Ferrari NV", "USD"),
    "Ford":               ("F",      "Ford Motor Co.", "USD"),
    "GBTC":               ("GBTC",   "Grayscale Bitcoin Trust", "USD"),
    "General_Electrics":  ("GE",     "General Electric", "USD"),
    "GILD":               ("GILD",   "Gilead Sciences", "USD"),
    "GME":                ("GME",    "GameStop Corp.", "USD"),
    "Goldman_Sachs":      ("GS",     "Goldman Sachs", "USD"),
    "Google":             ("GOOGL",  "Alphabet Inc. Class A", "USD"),
    "GTLB":               ("GTLB",   "GitLab Inc.", "USD"),
    "Harley_Davidson":    ("HOG",    "Harley-Davidson", "USD"),
    "Hewlett_Packard":    ("HPQ",    "HP Inc.", "USD"),
    "Home_Depot":         ("HD",     "Home Depot Inc.", "USD"),
    "HOOD":               ("HOOD",   "Robinhood Markets", "USD"),
    "IBM":                ("IBM",    "IBM Corp.", "USD"),
    "Intel":              ("INTC",   "Intel Corp.", "USD"),
    "JPMorgan":           ("JPM",    "JPMorgan Chase", "USD"),
    "JUVE":               ("JUVE.MI","Juventus FC", "EUR"),
    "LTM":                ("LTM",    "LATAM Airlines", "USD"),
    "LUV":                ("LUV",    "Southwest Airlines", "USD"),
    "LYFT":               ("LYFT",   "Lyft Inc.", "USD"),
    "MARA":               ("MARA",   "Marathon Digital", "USD"),
    "Mastercard":         ("MA",     "Mastercard Inc.", "USD"),
    "McDonald":           ("MCD",    "McDonald's Corp.", "USD"),
    "MELI":               ("MELI",   "MercadoLibre", "USD"),
    "META":               ("META",   "Meta Platforms", "USD"),
    "Microsoft":          ("MSFT",   "Microsoft Corp.", "USD"),
    "MRNA":               ("MRNA",   "Moderna Inc.", "USD"),
    "NCLH":               ("NCLH",   "Norwegian Cruise Line", "USD"),
    "Nike":               ("NKE",    "Nike Inc.", "USD"),
    "nVidia":             ("NVDA",   "NVIDIA Corp.", "USD"),
    "Oracle":             ("ORCL",   "Oracle Corp.", "USD"),
    "Petrobras":          ("PBR",    "Petrobras SA", "USD"),
    "Pfizer":             ("PFE",    "Pfizer Inc.", "USD"),
    "Philip_Morris":      ("PM",     "Philip Morris", "USD"),
    "PINS":               ("PINS",   "Pinterest Inc.", "USD"),
    "Procter&Gamble":     ("PG",     "Procter & Gamble", "USD"),
    "PVH":                ("PVH",    "PVH Corp.", "USD"),
    "Ralph_Lauren":       ("RL",     "Ralph Lauren Corp.", "USD"),
    "RCL":                ("RCL",    "Royal Caribbean Cruises", "USD"),
    "REP":                ("REP.MC", "Repsol SA", "EUR"),
    "RNO":                ("RNO.PA", "Renault SA", "EUR"),
    "RYAAY":              ("RYAAY",  "Ryanair Holdings", "USD"),
    "Salesforce":         ("CRM",    "Salesforce Inc.", "USD"),
    "SAP":                ("SAP",    "SAP SE", "USD"),
    "SIE":                ("SIE.DE", "Siemens AG", "EUR"),
    "Snap":               ("SNAP",   "Snap Inc.", "USD"),
    "SPCE":               ("SPCE",   "Virgin Galactic Holdings", "USD"),
    "SQM":                ("SQM",    "Sociedad Quimica y Minera", "USD"),
    "Starbucks":          ("SBUX",   "Starbucks Corp.", "USD"),
    "Tesla":              ("TSLA",   "Tesla Inc.", "USD"),
    "Travelers":          ("TRV",    "Travelers Companies", "USD"),
    "TripAdvisor":        ("TRIP",   "Tripadvisor Inc.", "USD"),
    "UBER":               ("UBER",   "Uber Technologies", "USD"),
    "UnitedHealth":       ("UNH",    "UnitedHealth Group", "USD"),
    "Vale":               ("VALE",   "Vale SA", "USD"),
    "Verizon":            ("VZ",     "Verizon Communications", "USD"),
    "VF":                 ("VFC",    "VF Corporation", "USD"),
    "Visa":               ("V",      "Visa Inc.", "USD"),
    "Vodafone":           ("VOD",    "Vodafone Group", "USD"),
    "Volkswagen":         ("VOW3.DE","Volkswagen AG", "EUR"),
    "Wells_Fargo":        ("WFC",    "Wells Fargo & Co.", "USD"),
    "Williams_Sonoma":    ("WSM",    "Williams-Sonoma", "USD"),
    "WYNN":               ("WYNN",   "Wynn Resorts", "USD"),
    "Yandex":             ("YNDX",   "Yandex NV", "USD"),
}

# Crypto: Libertex 3-letter code → yfinance symbol & full name
CRYPTO_MAP = {
    "ADAUSD":  ("ADA-USD",  "Cardano"),
    "APEUSD":  ("APE-USD",  "ApeCoin"),
    "ATMUSD":  ("ATOM-USD", "Cosmos"),
    "BCHUSD":  ("BCH-USD",  "Bitcoin Cash"),
    "BTCUSD":  ("BTC-USD",  "Bitcoin"),
    "CMPUSD":  ("COMP-USD", "Compound"),
    "DOGUSD":  ("DOGE-USD", "Dogecoin"),
    "DOTUSD":  ("DOT-USD",  "Polkadot"),
    "DSHUSD":  ("DASH-USD", "Dash"),
    "ETCUSD":  ("ETC-USD",  "Ethereum Classic"),
    "ETHUSD":  ("ETH-USD",  "Ethereum"),
    "GMTUSD":  ("GMT-USD",  "STEPN"),
    "ICPUSD":  ("ICP-USD",  "Internet Computer"),
    "IOTUSD":  ("IOTA-USD", "IOTA"),
    "LNKUSD":  ("LINK-USD", "Chainlink"),
    "LTCUSD":  ("LTC-USD",  "Litecoin"),
    "NEOUSD":  ("NEO-USD",  "Neo"),
    "ONTUSD":  ("ONT-USD",  "Ontology"),
    "PEPEUSD": ("PEPE24478-USD", "Pepe"),
    "QTMUSD":  ("QTUM-USD", "Qtum"),
    "SBAUSD":  ("SHIB-USD", "Shiba Inu"),  # Libertex SBA = Shiba Inu shortened
    "SNXUSD":  ("SNX-USD",  "Synthetix"),
    "SOLUSD":  ("SOL-USD",  "Solana"),
    "TONUSD":  ("TON11419-USD", "Toncoin"),
    "TRXUSD":  ("TRX-USD",  "TRON"),
    "UNIUSD":  ("UNI7083-USD", "Uniswap"),
    "VETUSD":  ("VET-USD",  "VeChain"),
    "XLMUSD":  ("XLM-USD",  "Stellar"),
    "XMRUSD":  ("XMR-USD",  "Monero"),
    "XRPUSD":  ("XRP-USD",  "Ripple"),
    "XTZUSD":  ("XTZ-USD",  "Tezos"),
    "ZECUSD":  ("ZEC-USD",  "Zcash"),
    "ZRXUSD":  ("ZRX-USD",  "0x"),
    # Crypto-vs-crypto (BCHBTC/ETHBTC/LTCBTC/LTCETH) — no USD reference; SKIP
    # TRUMPUSD — no reliable yfinance ticker; SKIP
}

INDEX_MAP = {
    "ES":        ("^GSPC",     "S&P 500"),
    "ESCash":    ("^GSPC",     "S&P 500 (cash)"),
    "FCE":       ("^FCHI",     "CAC 40 (France)"),
    "FDAX":      ("^GDAXI",    "DAX 40 (Germany)"),
    "FDAXCash":  ("^GDAXI",    "DAX 40 cash"),
    "FESX":      ("^STOXX50E", "Euro Stoxx 50"),
    "FTI":       ("^AEX",      "AEX 25 (Netherlands)"),
    "HSI":       ("^HSI",      "Hang Seng (Hong Kong)"),
    "NIY":       ("^N225",     "Nikkei 225"),
    "NIYCash":   ("^N225",     "Nikkei 225 cash"),
    "NQ":        ("^NDX",      "Nasdaq 100"),
    "NQCash":    ("^NDX",      "Nasdaq 100 cash"),
    "TF":        ("^RUT",      "Russell 2000"),
    "USDX":      ("DX-Y.NYB",  "US Dollar Index"),
    "VIX":       ("^VIX",      "CBOE Volatility Index"),
    "YM":        ("^DJI",      "Dow Jones Industrial"),
    "YMCash":    ("^DJI",      "Dow Jones cash"),
    "Z":         ("^FTSE",     "FTSE 100 (UK)"),
    "ZCash":     ("^FTSE",     "FTSE 100 cash"),
}

OIL_GAS_MAP = {
    "BRN":        ("BZ=F", "Brent Crude Oil"),
    "BRNCash":    ("BZ=F", "Brent Crude (cash)"),
    "CL":         ("CL=F", "WTI Crude Oil"),
    "HO":         ("HO=F", "Heating Oil"),
    "NG":         ("NG=F", "Natural Gas"),
    "NGASCash":   ("NG=F", "Natural Gas (cash)"),
    "USOILCash":  ("CL=F", "WTI Crude (cash)"),
    # WT — likely Wheat (sometimes labeled as Wheat) but in Oil/Gas group is unclear; skip
}

METALS_MAP = {
    "HG":      ("HG=F",     "Copper Futures"),
    "PA":      ("PA=F",     "Palladium Futures"),
    "PL":      ("PL=F",     "Platinum Futures"),
    "XAGUSD":  ("SI=F",     "Silver"),
    "XAUUSD":  ("GC=F",     "Gold"),
    # XAUEUR — gold in EUR, no direct yfinance equivalent; skip
    # XAUXAG — gold/silver ratio, derived; skip
}

AGRI_MAP = {
    "COCOA":    ("CC=F", "Cocoa Futures"),
    "COFFEE":   ("KC=F", "Coffee Futures"),
    "CORN":     ("ZC=F", "Corn Futures"),
    "COTTON":   ("CT=F", "Cotton Futures"),
    "SOYBEAN":  ("ZS=F", "Soybean Futures"),
    "SUGAR":    ("SB=F", "Sugar Futures"),
    "WHEAT":    ("ZW=F", "Wheat Futures"),
}

ETF_MAP = {
    "AGG":  ("AGG", "iShares Core US Aggregate Bond ETF"),
    "EWG":  ("EWG", "iShares MSCI Germany ETF"),
    "EWU":  ("EWU", "iShares MSCI United Kingdom ETF"),
    "EWW":  ("EWW", "iShares MSCI Mexico ETF"),
    "EWZ":  ("EWZ", "iShares MSCI Brazil ETF"),
    "FXI":  ("FXI", "iShares China Large-Cap ETF"),
    "ILF":  ("ILF", "iShares Latin America 40 ETF"),
    "SPY":  ("SPY", "SPDR S&P 500 ETF"),
    "VGK":  ("VGK", "Vanguard FTSE Europe ETF"),
}

# Bonds platform group (Libertex-only; bond ETFs already standard yfinance tickers)
BOND_MAP = {
    "IEF":  ("IEF", "iShares 7-10 Year Treasury Bond ETF"),
    "SHY":  ("SHY", "iShares 1-3 Year Treasury Bond ETF"),
    "TLT":  ("TLT", "iShares 20+ Year Treasury Bond ETF"),
}

# Swap-Free instruments (Islamic-finance variant). Libertex prefixes them with
# lowercase "i". The underlying market data is identical to the standard form,
# so we strip the "i" and reuse the regular crypto/metal mapping.
SWAP_FREE_MAP = {
    "iBTCUSD": ("BTC-USD",  "Bitcoin (swap-free)",  "crypto",    True),
    "iETHUSD": ("ETH-USD",  "Ethereum (swap-free)", "crypto",    True),
    "iXRPUSD": ("XRP-USD",  "Ripple (swap-free)",   "crypto",    True),
    "iXAU":    ("GC=F",     "Gold (swap-free)",     "commodity", False),
}

GROUP_TO_CATEGORY = {
    "Cryptocurrencies": "crypto",
    "Indexes":          "index",
    "Oil and Gas":      "commodity",
    "Metals":           "commodity",
    "Stocks":           "stock",
    "Forex":            "fx",
    "Agriculture":      "commodity",
    "ETFs":             "etf",
    "Bonds":            "bond",
    "Swap-Free":        "crypto",  # placeholder, real category set by SWAP_FREE_MAP
}

IS_CRYPTO = {"crypto": True}

# Stocks that Libertex labels in a way yfinance does NOT understand verbatim.
# Most stock symbols are already standard ALLCAPS tickers — pass-through covers
# them. This denylist lets us skip Libertex-exclusive ones with no public ticker.
KNOWN_BAD_STOCK_TICKERS = {
    "ADAM",   # Libertex-only, no public listing under this ticker
    "FPH",    # Five Point Holdings — yfinance has it but data is thin; example
    "KLAR",   # Klarna pre-IPO listing on Libertex CFD; no yf data
    "SATS",   # EchoStar — keep, has yf data
}


def map_forex(symbol: str) -> tuple[str, str, str]:
    """EURUSD -> (EURUSD=X, 'Euro vs US Dollar', 'USD' or quote currency)."""
    if not re.fullmatch(r"[A-Z]{6}", symbol):
        raise ValueError(f"unexpected fx symbol {symbol}")
    base, quote = symbol[:3], symbol[3:]
    return f"{symbol}=X", f"{base}/{quote} cross", quote


# Pattern for a syntactically valid US/EU exchange ticker that yfinance
# is likely to accept verbatim (e.g. AAPL, BRK.B, BF-B, ADS.DE, RACE).
STD_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.&-]{1,6}$")


def map_etf(libertex_sym: str) -> tuple[str, str] | None:
    """Best-effort Libertex-ETF → yfinance mapping.

    Explicit overrides (ETF_MAP) cover the funds we want a friendly name for;
    everything else passes through if it looks like a standard exchange ETF
    ticker. Same heuristic as `map_stock` but returns (yf_symbol, name).
    """
    if libertex_sym in ETF_MAP:
        return ETF_MAP[libertex_sym]
    if STD_TICKER_RE.match(libertex_sym):
        return (libertex_sym, libertex_sym)
    return None


def map_crypto(libertex_sym: str) -> tuple[str, str] | None:
    """Libertex crypto symbol → yfinance crypto pair.

    Heuristic: 3-4 letter ticker followed by USD → yfinance "TICKER-USD".
    Crypto-vs-crypto pairs (e.g. ETHBTC, IOTETH, LTCETH) are skipped because
    yfinance only quotes USD/USDT pairs reliably.
    """
    if libertex_sym in CRYPTO_MAP:
        return CRYPTO_MAP[libertex_sym]
    # XYZUSD → XYZ-USD (yfinance convention)
    m = re.fullmatch(r"([A-Z]{2,5})USD", libertex_sym)
    if m:
        return (f"{m.group(1)}-USD", m.group(1))
    return None


def map_stock(libertex_sym: str) -> tuple[str, str, str] | None:
    """Best-effort Libertex-stock → yfinance mapping.

    Order:
        1. Explicit STOCK_MAP override (for friendly-name labels like "Apple"
           or for European listings with non-default suffix).
        2. If the label already looks like a standard exchange ticker
           (ALLCAPS, optional dot/dash/ampersand, ≤7 chars), pass through —
           yfinance accepts this for ~95% of US/EU equities. Worst case
           it returns no data and the warmup script flags it as inactive.
        3. Otherwise skip with a "no mapping" notice.

    Returns (yf_symbol, name, currency) or None.
    """
    if libertex_sym in STOCK_MAP:
        return STOCK_MAP[libertex_sym]
    if libertex_sym in KNOWN_BAD_STOCK_TICKERS:
        return None
    if STD_TICKER_RE.match(libertex_sym):
        # Pass-through: assume same ticker on yfinance, USD-listed.
        return (libertex_sym, libertex_sym, "USD")
    return None


def main() -> None:
    with RAW.open(encoding="utf-8") as f:
        raw = json.load(f)

    out_rows: list[tuple] = []
    skipped: list[tuple[str, str, str]] = []

    for r in raw["rows"]:
        grp = r["group"]
        sym = r["cells"][0]
        category = GROUP_TO_CATEGORY.get(grp)
        if not category:
            skipped.append((grp, sym, "unknown group"))
            continue

        try:
            if grp == "Cryptocurrencies":
                mapped = map_crypto(sym)
                if mapped is None:
                    skipped.append((grp, sym, "no crypto mapping"))
                    continue
                yf_sym, name = mapped
                tv_sym = f"BINANCE:{sym.replace('USD', 'USDT')}" if sym.endswith("USD") else None
                out_rows.append((sym, yf_sym, tv_sym, name, "crypto", "USD", True))

            elif grp == "Indexes":
                if sym not in INDEX_MAP:
                    skipped.append((grp, sym, "no index mapping"))
                    continue
                yf_sym, name = INDEX_MAP[sym]
                out_rows.append((sym, yf_sym, None, name, "index", "USD", False))

            elif grp == "Oil and Gas":
                if sym not in OIL_GAS_MAP:
                    skipped.append((grp, sym, "no oil/gas mapping"))
                    continue
                yf_sym, name = OIL_GAS_MAP[sym]
                out_rows.append((sym, yf_sym, None, name, "commodity", "USD", False))

            elif grp == "Metals":
                if sym not in METALS_MAP:
                    skipped.append((grp, sym, "no metals mapping"))
                    continue
                yf_sym, name = METALS_MAP[sym]
                out_rows.append((sym, yf_sym, None, name, "commodity", "USD", False))

            elif grp == "Agriculture":
                if sym not in AGRI_MAP:
                    skipped.append((grp, sym, "no agri mapping"))
                    continue
                yf_sym, name = AGRI_MAP[sym]
                out_rows.append((sym, yf_sym, None, name, "commodity", "USD", False))

            elif grp == "ETFs":
                mapped = map_etf(sym)
                if mapped is None:
                    skipped.append((grp, sym, "no etf mapping"))
                    continue
                yf_sym, name = mapped
                out_rows.append((sym, yf_sym, None, name, "etf", "USD", False))

            elif grp == "Stocks":
                mapped = map_stock(sym)
                if mapped is None:
                    skipped.append((grp, sym, "no stock mapping"))
                    continue
                yf_sym, name, currency = mapped
                out_rows.append((sym, yf_sym, None, name, "stock", currency, False))

            elif grp == "Forex":
                if not re.fullmatch(r"[A-Z]{6}", sym):
                    skipped.append((grp, sym, "non-standard fx"))
                    continue
                yf_sym, name, currency = map_forex(sym)
                out_rows.append((sym, yf_sym, f"FX:{sym}", name, "fx", currency, False))

            elif grp == "Bonds":
                if sym not in BOND_MAP:
                    skipped.append((grp, sym, "no bond mapping"))
                    continue
                yf_sym, name = BOND_MAP[sym]
                out_rows.append((sym, yf_sym, None, name, "bond", "USD", False))

            elif grp == "Swap-Free":
                if sym not in SWAP_FREE_MAP:
                    skipped.append((grp, sym, "no swap-free mapping"))
                    continue
                yf_sym, name, cat, is_c = SWAP_FREE_MAP[sym]
                out_rows.append((sym, yf_sym, None, name, cat, "USD", is_c))

        except Exception as e:
            skipped.append((grp, sym, f"map error: {e}"))

    # De-duplicate by symbol (keep first)
    seen = set()
    deduped = []
    for row in out_rows:
        if row[0] in seen:
            continue
        seen.add(row[0])
        deduped.append(row)

    # Write libertex_seed.py
    lines = []
    lines.append('"""Curated seed of Libertex MT5-Market CFDs.\n')
    lines.append('Auto-generated from data/libertex_raw.json (scraped from\n')
    lines.append('https://libertex.org/cfd-specification — MT5-Market platform).\n')
    lines.append('\n')
    lines.append('Each row: (symbol, yf_symbol, tv_symbol, name, category, currency, is_crypto)\n')
    lines.append('"""\n\n')
    lines.append("LIBERTEX_SEED = [\n")
    cat_order = ["stock", "etf", "bond", "index", "commodity", "fx", "crypto"]
    by_cat = {c: [] for c in cat_order}
    for r in deduped:
        by_cat.setdefault(r[4], []).append(r)
    for c in cat_order:
        rows_c = by_cat.get(c, [])
        if not rows_c:
            continue
        lines.append(f"    # ---------- {c.upper()} ({len(rows_c)}) ----------\n")
        for s, yf, tv, name, cat, cur, is_c in rows_c:
            tv_repr = f'"{tv}"' if tv else "None"
            name_safe = name.replace('"', '\\"')
            lines.append(
                f'    ("{s}", "{yf}", {tv_repr}, "{name_safe}", "{cat}", "{cur}", {is_c}),\n'
            )
    lines.append("]\n")
    OUT.write_text("".join(lines), encoding="utf-8")

    print(f"Written: {OUT}")
    print(f"  rows: {len(deduped)}")
    from collections import Counter
    by_c = Counter(r[4] for r in deduped)
    for c in cat_order:
        if c in by_c:
            print(f"  {c}: {by_c[c]}")
    print(f"\nSkipped ({len(skipped)}):")
    for grp, sym, why in skipped:
        print(f"  [{grp}] {sym}: {why}")


if __name__ == "__main__":
    main()
