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
import { api, type DayAhead, type Meta } from "../api";
import { Card, Kpi, Legend, Status, TipBox } from "../components/ui";
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
  const { data, error, loading } = useApi(() => api.dayAhead(day, cutoff), [day, cutoff]);

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
          <label className="toggle">
            <input type="checkbox" checked={showVintages} onChange={(e) => setShowVintages(e.target.checked)} />
            Show how the forecast evolved ({data.vintages.length} publications)
          </label>
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
