import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type DayAhead, type Meta, type Procurement } from "../api";
import { Card, DownloadButton, Kpi, Legend, Status, TipBox } from "../components/ui";
import { downloadCsv } from "../csv";
import { GW_TICKS, axisGw, gw, gwh, mw, pct, signedGw, ukDateTime, ukDay, ukTime } from "../format";
import { useApi } from "../useApi";
import { COLORS } from "../theme";

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function DayAheadView({ meta, cutoff }: { meta: Meta; cutoff: string }) {
  const [first, last] = meta.delivery_range;
  const [day, setDay] = useState("2026-01-15");
  const [showVintages, setShowVintages] = useState(false);
  // Flat demand to cover, in GW. Default is roughly GB winter demand, as an illustration.
  const [demandGw, setDemandGw] = useState("35");
  const demand = Number(demandGw);
  const demandMw = demandGw !== "" && Number.isFinite(demand) && demand >= 0 && demand <= 100 ? demand * 1000 : undefined;
  const { data, error, loading } = useApi(() => api.dayAhead(day, cutoff, demandMw), [day, cutoff, demandMw]);

  return (
    <>
      <div className="toolbar">
        <div className="day-picker">
          <button onClick={() => setDay(shiftDate(day, -1))} disabled={day <= first} aria-label="Previous day">
            ‹
          </button>
          <input type="date" value={day} min={first} max={last} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button onClick={() => setDay(shiftDate(day, 1))} disabled={day >= last} aria-label="Next day">
            ›
          </button>
        </div>
        <label className="demand">
          Demand to cover (GW, flat)
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={demandGw}
            onChange={(e) => setDemandGw(e.target.value)}
          />
        </label>
        <span className="toolbar-note">
          Delivery day <b>{ukDay(day)}</b> · bought in the auction on <b>{ukDay(shiftDate(day, -1))}</b>
        </span>
      </div>

      <Status loading={loading && !data} error={error} />
      {data && <DayAheadBody data={data} showVintages={showVintages} setShowVintages={setShowVintages} />}
    </>
  );
}

function DayAheadBody({
  data,
  showVintages,
  setShowVintages,
}: {
  data: DayAhead;
  showVintages: boolean;
  setShowVintages: (v: boolean) => void;
}) {
  const s = data.summary;
  const cal = data.calibration;

  // Merge the decision series with earlier vintages (keyed v0, v1, ...) for one chart.
  const rows = useMemo(() => {
    const byTime = new Map(
      data.series.map((r) => [
        r.time,
        { ...r, band: r.p10 != null && r.p90 != null ? [r.p10, r.p90] : null } as Record<string, unknown>,
      ]),
    );
    data.vintages.forEach((v, i) =>
      v.points.forEach((p) => {
        const row = byTime.get(p.time);
        if (row) row[`v${i}`] = p.forecast;
      }),
    );
    return [...byTime.values()];
  }, [data]);

  const decisionIdx = data.vintages.findIndex((v) => v.publish_time === data.forecast_published);
  const hasActuals = data.series.some((r) => r.actual != null);

  return (
    <>
      <div className="kpis">
        <Kpi
          label="Forecast used for the decision"
          value={data.forecast_published ? ukDateTime(data.forecast_published) : "None available"}
          sub={
            data.horizon_hours &&
            `Latest before ${ukTime(data.decision_cutoff)} cutoff · ${data.horizon_hours[0]}–${data.horizon_hours[1]} h ahead`
          }
        />
        <Kpi label="Raw forecast wind energy" value={gwh(s.forecast_mwh)} sub={`Peak ${gw(s.peak_forecast_mw)} · low ${gw(s.min_forecast_mw)}`} />
        <Kpi
          label="Expected wind (P50, calibrated)"
          value={gwh(s.p50_mwh)}
          tone="accent"
          sub={cal ? `Adjusted ${signedGw(cal.p50_error)} per hour from recent errors` : "Not enough history"}
        />
        <Kpi
          label="Wind you can count on (P10)"
          value={gwh(s.p10_mwh)}
          sub="9 days in 10 wind delivered at least this much"
        />
        <Kpi
          label="Actual outturn (hindsight)"
          value={gwh(s.actual_mwh)}
          tone="muted"
          sub={
            s.actual_mwh != null && s.forecast_mwh != null
              ? `Raw forecast was ${pct((s.forecast_mwh - s.actual_mwh) / s.actual_mwh)} ${s.forecast_mwh >= s.actual_mwh ? "too high" : "too low"}`
              : "Not settled yet"
          }
        />
      </div>

      <Card
        title="Wind generation for the delivery day"
        subtitle={
          <>
            GW, UK time. Shaded range = P10–P90 from decision-forecast errors on {cal ? `${ukDay(cal.window[0])} – ${ukDay(cal.window[1])}` : "recent days"} — only days already settled at decision time.
          </>
        }
        actions={
          <div className="card-actions">
            <label className="toggle">
              <input type="checkbox" checked={showVintages} onChange={(e) => setShowVintages(e.target.checked)} />
              Show how the forecast evolved ({data.vintages.length} publications)
            </label>
            <DownloadButton
              onClick={() =>
                downloadCsv(
                  `wind-day-ahead-${data.delivery_date}.csv`,
                  data.series.map((r) => ({
                    time_utc: r.time,
                    raw_forecast_mw: r.forecast,
                    p10_mw: r.p10,
                    p50_mw: r.p50,
                    p90_mw: r.p90,
                    actual_mw: r.actual,
                  })),
                )
              }
            />
          </div>
        }
      >
        <Legend
          items={[
            { label: "P10–P90 range", color: COLORS.forecast, kind: "band" },
            { label: "Calibrated P50", color: COLORS.forecast },
            { label: "Raw Elexon forecast", color: COLORS.forecast, kind: "dash" },
            ...(hasActuals ? [{ label: "Actual outturn", color: COLORS.actual }] : []),
            ...(showVintages ? [{ label: "Earlier / later publications", color: COLORS.vintage }] : []),
          ]}
        />
        <div className="chart tall">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="time" tickFormatter={ukTime} interval={5} tick={{ fontSize: 12 }} stroke="var(--axis)" />
              <YAxis ticks={GW_TICKS} domain={[0, 22000]} tickFormatter={axisGw} tick={{ fontSize: 12 }} stroke="var(--axis)" width={56} unit=" GW" />
              <Tooltip content={<DayTip />} />
              <Area dataKey="band" stroke="none" fill={COLORS.forecast} fillOpacity={0.14} connectNulls isAnimationActive={false} />
              {showVintages &&
                data.vintages.map((v, i) =>
                  i === decisionIdx ? null : (
                    <Line
                      key={v.publish_time}
                      dataKey={`v${i}`}
                      stroke={COLORS.vintage}
                      strokeWidth={1}
                      strokeOpacity={0.35 + (0.5 * i) / data.vintages.length}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ),
                )}
              <Line dataKey="forecast" stroke={COLORS.forecast} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="p50" stroke={COLORS.forecast} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="actual" stroke={COLORS.actual} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {data.procurement && <BuyPlan p={data.procurement} date={data.delivery_date} />}

      {data.metrics && (
        <Card title="How did the decision forecast do on this day?" subtitle="Hourly points, error = actual − forecast">
          <div className="kpis compact">
            <Kpi label="Mean absolute error — raw" value={mw(data.metrics.mae)} />
            <Kpi label="Mean absolute error — calibrated P50" value={mw(data.calibrated_metrics?.mae)} tone="accent" />
            <Kpi label="Bias — raw" value={signedGw(data.metrics.bias)} sub={data.metrics.bias < 0 ? "Forecast too high" : "Forecast too low"} />
            <Kpi label="Worst hour" value={mw(data.metrics.max_abs)} />
          </div>
        </Card>
      )}
    </>
  );
}

function DayTip({ active, payload, label }: { active?: boolean; payload?: { payload: Record<string, number | null> }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  const r = payload[0].payload;
  const rows = [
    r.p50 != null && { label: "Calibrated P50", value: mw(r.p50), color: COLORS.forecast },
    r.p10 != null && { label: "P10 – P90", value: `${gw(r.p10)} – ${gw(r.p90)}` },
    r.forecast != null && { label: "Raw forecast", value: mw(r.forecast) },
    r.actual != null && { label: "Actual", value: mw(r.actual), color: COLORS.actual },
  ].filter(Boolean) as { label: string; value: string; color?: string }[];
  return <TipBox title={ukDateTime(label)} rows={rows} />;
}

function BuyPlan({ p, date }: { p: Procurement; date: string }) {
  const cover = p.p10_mwh != null && p.p50_mwh != null ? p.p10_mwh - p.p50_mwh : null;
  const rows = p.hourly.map((h) => ({ ...h, cover: h.p10 != null && h.p50 != null ? [h.p50, h.p10] : null }));
  return (
    <Card
      title="How much to buy beyond wind"
      subtitle={
        <>
          Flat demand of {gw(p.demand_mw)} minus wind, for each hour of the day. Enter your own portfolio demand above;
          the default is roughly GB winter demand, for illustration.
        </>
      }
      actions={
        <DownloadButton
          onClick={() =>
            downloadCsv(
              `buy-plan-${date}.csv`,
              p.hourly.map((h) => ({
                time_utc: h.time,
                demand_mw: p.demand_mw,
                buy_vs_raw_forecast_mw: h.raw,
                buy_vs_p50_wind_mw: h.p50,
                buy_vs_p10_wind_mw: h.p10,
              })),
            )
          }
        />
      }
    >
      <div className="kpis compact">
        <Kpi label="Expected need (vs P50 wind)" value={gwh(p.p50_mwh)} tone="accent" />
        <Kpi label="Cautious need (vs P10 wind)" value={gwh(p.p10_mwh)} sub={cover != null ? `${gwh(cover)} extra buys 9-in-10 cover` : undefined} />
        <Kpi label="Using the raw forecast" value={gwh(p.raw_mwh)} />
        <Kpi
          label="Actually needed (hindsight)"
          value={gwh(p.hindsight_mwh)}
          tone="muted"
          sub={
            p.raw_shortfall_mwh != null
              ? p.raw_shortfall_mwh > 0
                ? `Raw forecast would have left you ${gwh(p.raw_shortfall_mwh)} short`
                : `Raw forecast would have over-bought by ${gwh(-p.raw_shortfall_mwh)}`
              : "Not settled yet"
          }
        />
      </div>
      <Legend
        items={[
          { label: "Buy vs P50 wind", color: COLORS.forecast },
          { label: "Extra for P10 cover", color: COLORS.forecast, kind: "band" },
          { label: "Buy vs raw forecast", color: COLORS.forecast, kind: "dash" },
        ]}
      />
      <div className="chart">
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="time" tickFormatter={ukTime} interval={2} tick={{ fontSize: 12 }} stroke="var(--axis)" />
            <YAxis tickFormatter={axisGw} tick={{ fontSize: 12 }} stroke="var(--axis)" width={56} unit=" GW" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const h = payload[0].payload as Procurement["hourly"][number];
                return (
                  <TipBox
                    title={ukDateTime(String(label))}
                    rows={[
                      { label: "Buy vs P50 wind", value: mw(h.p50), color: COLORS.forecast },
                      { label: "Buy vs P10 wind", value: mw(h.p10) },
                      { label: "Buy vs raw forecast", value: mw(h.raw) },
                    ]}
                  />
                );
              }}
            />
            <Area dataKey="cover" stroke="none" fill={COLORS.forecast} fillOpacity={0.14} isAnimationActive={false} />
            <Line dataKey="raw" stroke={COLORS.forecast} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line dataKey="p50" stroke={COLORS.forecast} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
