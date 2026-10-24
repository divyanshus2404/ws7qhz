// Typed client for the FastAPI backend. Shapes mirror backend/app/analytics.py.

export interface Metrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  wape: number | null;
  p50_abs: number;
  p90_abs: number;
  p99_abs: number;
  max_abs: number;
  error_p10: number;
  error_p90: number;
}

export interface Meta {
  delivery_range: [string, string];
  default_cutoff_uk: string;
  publications: number;
  publish_range: [string, string] | null;
  actuals_range: [string, string] | null;
  data_source: string;
}

export interface Calibration {
  p10_error: number;
  p50_error: number;
  p90_error: number;
  sample_size: number;
  window: [string, string];
}

export interface DayAheadRow {
  time: string;
  actual: number | null;
  forecast: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface DayAhead {
  delivery_date: string;
  decision_cutoff: string;
  forecast_published: string | null;
  horizon_hours: [number, number] | null;
  calibration: Calibration | null;
  series: DayAheadRow[];
  summary: {
    forecast_mwh: number | null;
    p10_mwh: number | null;
    p50_mwh: number | null;
    p90_mwh: number | null;
    actual_mwh: number | null;
    peak_forecast_mw: number | null;
    min_forecast_mw: number | null;
  };
  metrics: Metrics | null;
  calibrated_metrics: Metrics | null;
  vintages: { publish_time: string; points: { time: string; forecast: number }[] }[];
}

export interface Explorer {
  horizon_hours: number;
  series: { time: string; actual: number | null; forecast: number | null; published: string | null }[];
  metrics: Metrics | null;
}

export interface Accuracy {
  decision_cutoff_uk: string;
  delivery_range: [string, string];
  overall: Metrics;
  calibrated: Metrics | null;
  band_coverage: number | null;
  by_hour: (Metrics & { hour: number })[];
  daily: {
    date: string;
    mae: number;
    bias: number;
    calibrated_mae: number | null;
    forecast_mwh: number;
    actual_mwh: number;
  }[];
  histogram: { from: number; to: number; count: number }[];
  scatter: { forecast: number; actual: number }[];
  by_horizon: (Metrics & { horizon_from: number; horizon_to: number })[];
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}/api/${path}${qs.size ? `?${qs}` : ""}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  meta: () => get<Meta>("meta"),
  dayAhead: (delivery_date: string, cutoff: string) => get<DayAhead>("day-ahead", { delivery_date, cutoff }),
  explorer: (start: string, end: string, horizon_hours: number) =>
    get<Explorer>("forecast", { start, end, horizon_hours }),
  accuracy: (cutoff: string) => get<Accuracy>("accuracy", { cutoff }),
};
