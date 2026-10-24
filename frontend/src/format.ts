// All times are displayed on the UK clock, which is what the trading desk works in.
const UK = "Europe/London";

export const ukTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: UK, hour: "2-digit", minute: "2-digit" });

export const ukDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: UK,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const ukDay = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: UK,
    weekday: "short",
    day: "numeric",
    month: "short",
  });

export const mw = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v).toLocaleString("en-GB")} MW`);

export const gw = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v / 1000).toFixed(digits)} GW`);

export const gwh = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${(mwh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 0 })} GWh`;

export const signedGw = (v: number | null | undefined) =>
  v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v / 1000).toFixed(2)} GW`;

export const pct = (v: number | null | undefined, digits = 0) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);

export const axisGw = (v: number) => `${(v / 1000).toFixed(0)}`;

// National GB wind stays under ~22 GW, so charts share one fixed, readable scale.
export const GW_TICKS = [0, 5000, 10000, 15000, 20000];
