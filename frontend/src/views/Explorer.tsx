import { useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Meta } from "../api";
import { Card, Kpi, Legend, Status, TipBox } from "../components/ui";
import { GW_TICKS, axisGw, gw, mw, pct, signedGw, ukDateTime } from "../format";
import { COLORS } from "../theme";
import { useApi } from "../useApi";

const dayTick = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

export default function ExplorerView({ meta }: { meta: Meta }) {
  const [first, last] = meta.delivery_range;
  const [start, setStart] = useState("2026-01-08");
  const [end, setEnd] = useState("2026-01-14");
  const [horizon, setHorizon] = useState(24);
  const [committed, setCommitted] = useState(24); // slider only refetches on release
  const { data, error, loading } = useApi(() => api.explorer(start, end, committed), [start, end, committed]);

  return (
    <>
      <div className="toolbar">
        <label>
          From
          <input type="date" value={start} min={first} max={end} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={end} min={start} max={last} onChange={(e) => e.target.value && setEnd(e.target.value)} />
        </label>
        <label className="slider">
          <span>Forecast made at least <b>{horizon} h</b> before delivery</span>
          <input
            type="range"
            min={0}
            max={48}
            step={1}
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            onPointerUp={() => setCommitted(horizon)}
            onKeyUp={() => setCommitted(horizon)}
          />
        </label>
      </div>

      <Status loading={loading && !data} error={error} />
      {data && (
        <>
          <div className="kpis compact">
            <Kpi label="Mean absolute error" value={mw(data.metrics?.mae)} />
            <Kpi label="Bias" value={signedGw(data.metrics?.bias)} />
            <Kpi label="90th pct absolute error" value={mw(data.metrics?.p90_abs)} />
            <Kpi label="WAPE" value={pct(data.metrics?.wape, 1)} />
          </div>
          <Card
            title={`Actual wind vs the forecast available ${committed} h ahead`}
            subtitle="For each hour, the latest forecast published at least this long before it. Drag the slider to see how accuracy changes with lead time."
          >
            <Legend items={[{ label: "Actual outturn", color: COLORS.actual }, { label: `Forecast (≥ ${committed} h ahead)`, color: COLORS.forecast }]} />
            <div className="chart tall">
              <ResponsiveContainer>
                <ComposedChart data={data.series} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="time" tickFormatter={dayTick} interval={47} tick={{ fontSize: 12 }} stroke="var(--axis)" />
                  <YAxis ticks={GW_TICKS} domain={[0, 22000]} tickFormatter={axisGw} tick={{ fontSize: 12 }} stroke="var(--axis)" width={56} unit=" GW" />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const r = payload[0].payload as (typeof data.series)[number];
                      return (
                        <TipBox
                          title={ukDateTime(String(label))}
                          rows={[
                            { label: "Actual", value: mw(r.actual), color: COLORS.actual },
                            ...(r.forecast != null
                              ? [
                                  { label: "Forecast", value: mw(r.forecast), color: COLORS.forecast },
                                  { label: "Published", value: ukDateTime(r.published!) },
                                  ...(r.actual != null ? [{ label: "Error", value: gw(r.actual - r.forecast, 2) }] : []),
                                ]
                              : []),
                          ]}
                        />
                      );
                    }}
                  />
                  <Line dataKey="actual" stroke={COLORS.actual} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line dataKey="forecast" stroke={COLORS.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
