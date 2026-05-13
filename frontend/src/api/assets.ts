import { api } from "./client";

export interface AssetPricePoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface AssetPriceHistory {
  symbol: string;
  name: string;
  category: string;
  currency: string;
  yf_symbol: string;
  interval: string; // "1mo" | "1wk"
  years: number;
  points: AssetPricePoint[];
  start: string;
  end: string;
  first_close: number;
  last_close: number;
  total_return: number;
  cagr: number;
}

/** Fetch historical close prices for a single asset, used by the price-history
 *  modal that opens when the user clicks a bar in the allocation chart. The
 *  backend serves the same parquet cache the optimiser reads, so the chart
 *  matches what produced the weights. */
export async function getAssetPrices(symbol: string, years = 20): Promise<AssetPriceHistory> {
  const r = await api.get(`/assets/${encodeURIComponent(symbol)}/prices`, {
    params: { years },
  });
  return r.data;
}
