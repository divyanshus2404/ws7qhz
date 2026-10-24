import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type Accuracy } from "../api";
import { Card, Kpi, Legend, Status, TipBox } from "../components/ui";
import { axisGw, gw, mw, pct, signedGw, ukDay } from "../format";
import { COLORS } from "../theme";
import { useApi } from "../useApi";

const axis = { tick: { fontSize: 12 }, stroke: "var(--axis)" };

export default function AccuracyView({ cutoff }: { cutoff: string }) {
  const { data, error, loading } = useApi(() => api.accuracy(cutoff), [cutoff]);
  return (
    <>
      <Status loading={loading && !data} error={error} />
      {data && <AccuracyBody data={data} />}
    </>
  );
}

function AccuracyBody({ data }: { data: Accuracy }) {
  const o = data.overall;
  const c = data.calibrated;
  const improvement = c ? 1 - c.mae / o.mae : null;
  const worstDay = [...data.daily].sort((a, b) => b.mae - a.mae)[0];
  const overForecastShare = data.daily.filter((d) => d.bias < 0).length / data.daily.length;
  const dayAheadBucket = data.by_horizon.find((b) => b.horizon_from === 24);
  const nearBucket = data.by_horizon[0];

  return (
    <>
      <p className="lede">
        Every hour of every delivery day from {ukDay(data.delivery_range[0])} to {ukDay(data.delivery_range[1])} scored
        against the forecast the desk would actually have had at {data.decision_cutoff_uk} the day before ({o.n} hours).
      </p>

      <div className="kpis">
        <Kpi label="Typical error (MAE)" value={gw(o.mae, 2)} sub={`${pct(o.wape)} of actual wind energy`} />
        <Kpi label="Systematic bias" value={signedGw(o.bias)} sub={`Forecast too high on ${pct(overForecastShare)} of days`} />
        <Kpi label="1-in-10 hour error is worse than" value={gw(o.p90_abs, 2)} sub={`Worst hour ${gw(o.max_abs, 2)}`} />
        <Kpi
          label="Calibrated P50 error (MAE)"
          value={gw(c?.mae, 2)}
          tone="accent"
          sub={improvement != null ? `${pct(improvement)} lower than the raw forecast` : undefined}
        />
        <Kpi
          label="Actuals inside P10–P90"
          value={pct(data.band_coverage)}
          sub="Target 80% — the range is honest"
        />
      </div>

      <div className="insights">
        <h3>What this means for buying</h3>
        <ul>
          <li>
            <b>The raw forecast ran high.</b> On average wind came in {gw(Math.abs(o.bias), 1)} below the forecast used at
            the auction. Taken at face value, the desk would be short and exposed to imbalance prices.
          </li>
          <li>
            <b>Learning from recent errors fixes most of the bias.</b> Shifting the forecast by the median error of the
            previous 14 settled days cut the typical error by {pct(improvement)}. It uses no information the desk
            wouldn’t have had.
          </li>
          <li>
            <b>Plan to the range, not the point.</b> Wind fell inside the P10–P90 range {pct(data.band_coverage)} of the
            time. Covering demand down to P10 wind protects against 9 shortfalls in 10.
          </li>
          {dayAheadBucket && nearBucket && (
            <li>
              <b>Lead time matters, though not as much as bias.</b> MAE is {gw(nearBucket.mae, 2)} for forecasts 0–3 h
              ahead and {gw(dayAheadBucket.mae, 2)} at 24–27 h ahead.
            </li>
          )}
          {worstDay && (
            <li>
              <b>Worst day: {ukDay(worstDay.date)}</b>, average miss {gw(worstDay.mae, 1)} per hour. Days like this are why
              the P10 figure matters more than the headline forecast.
            </li>
          )}
        </ul>
      </div>

      <div className="grid-2">
        <Card title="Error grows with lead time" subtitle="All forecast publications, by hours between publish and delivery">
          <Legend items={[{ label: "Mean absolute error", color: COLORS.forecast }, { label: "90th percentile absolute error", color: COLORS.forecast, kind: "dash" }]} />
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={data.by_horizon} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="horizon_from" {...axis} tickFormatter={(h) => `${h}h`} interval={1} />
                <YAxis {...axis} tickFormatter={axisGw} unit=" GW" width={56} />
                <ReferenceArea x1={12} x2={36} fill="var(--hover)" label={{ value: "lead times used for day-ahead decisions", position: "insideTop", fontSize: 11, fill: "var(--text-muted)" }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const b = payload[0].payload as Accuracy["by_horizon"][number];
                  return <TipBox title={`${b.horizon_from}–${b.horizon_to} h ahead`} rows={[
                    { label: "MAE", value: mw(b.mae) },
                    { label: "P90 abs error", value: mw(b.p90_abs) },
                    { label: "Bias", value: signedGw(b.bias) },
                    { label: "Hours scored", value: b.n.toLocaleString() },
                  ]} />;
                }} />
                <Line dataKey="mae" stroke={COLORS.forecast} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line dataKey="p90_abs" stroke={COLORS.forecast} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Daily error: raw vs calibrated" subtitle="Mean absolute error of the decision forecast per delivery day">
          <Legend items={[{ label: "Raw forecast", color: COLORS.vintage }, { label: "Calibrated P50", color: COLORS.forecast }]} />
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={data.daily} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barGap={2}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => d.slice(8)} interval={2} />
                <YAxis {...axis} tickFormatter={axisGw} unit=" GW" width={56} />
                <Tooltip cursor={{ fill: "var(--hover)" }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as Accuracy["daily"][number];
                  return <TipBox title={ukDay(d.date)} rows={[
                    { label: "Raw MAE", value: mw(d.mae), color: COLORS.vintage },
                    { label: "Calibrated MAE", value: mw(d.calibrated_mae), color: COLORS.forecast },
                    { label: "Raw bias", value: signedGw(d.bias) },
                  ]} />;
                }} />
                <Bar dataKey="mae" fill={COLORS.vintage} fillOpacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="calibrated_mae" fill={COLORS.forecast} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Distribution of hourly errors" subtitle="Actual − forecast. Left of zero = forecast too high (risk of being short)">
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={data.histogram} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barCategoryGap={2}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="from" {...axis} tickFormatter={(v: number) => (v / 1000).toFixed(1)} interval={1} unit="" />
                <YAxis {...axis} width={56} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--hover)" }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const b = payload[0].payload as Accuracy["histogram"][number];
                  return <TipBox title={`${gw(b.from, 1)} to ${gw(b.to, 1)}`} rows={[{ label: "Hours", value: String(b.count) }]} />;
                }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {data.histogram.map((b) => (
                    <Cell key={b.from} fill={b.to <= 0 ? COLORS.actual : COLORS.forecast} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="axis-caption">Error, GW</div>
        </Card>

        <Card title="Forecast vs actual, every hour" subtitle="Points under the diagonal: wind came in below forecast">
          <div className="chart">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--grid)" />
                <XAxis type="number" dataKey="forecast" ticks={[0, 5000, 10000, 15000, 20000]} name="Forecast" {...axis} tickFormatter={axisGw} domain={[0, 22000]} unit=" GW" />
                <YAxis type="number" dataKey="actual" ticks={[0, 5000, 10000, 15000, 20000]} name="Actual" {...axis} tickFormatter={axisGw} domain={[0, 22000]} unit=" GW" width={56} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="var(--axis)" strokeDasharray="4 4" />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as Accuracy["scatter"][number];
                  return <TipBox title="Hour" rows={[{ label: "Forecast", value: mw(p.forecast) }, { label: "Actual", value: mw(p.actual) }]} />;
                }} />
                <Scatter data={data.scatter} fill={COLORS.forecast} fillOpacity={0.45} shape="circle" isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Error by hour of delivery" subtitle="Mean absolute error and bias by UK hour of day">
          <Legend items={[{ label: "Mean absolute error", color: COLORS.forecast }, { label: "Bias (actual − forecast)", color: COLORS.actual }]} />
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={data.by_hour} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="hour" {...axis} tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} interval={3} />
                <YAxis {...axis} tickFormatter={axisGw} unit=" GW" width={56} />
                <ReferenceLine y={0} stroke="var(--axis)" />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const h = payload[0].payload as Accuracy["by_hour"][number];
                  return <TipBox title={`${String(h.hour).padStart(2, "0")}:00 UK`} rows={[
                    { label: "MAE", value: mw(h.mae), color: COLORS.forecast },
                    { label: "Bias", value: signedGw(h.bias), color: COLORS.actual },
                  ]} />;
                }} />
                <Line dataKey="mae" stroke={COLORS.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="bias" stroke={COLORS.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Metric definitions" subtitle="All errors are actual − forecast, measured hourly">
          <table className="defs">
            <tbody>
              <tr><th>MAE</th><td>Average size of the miss, in MW. The headline accuracy number.</td><td>{mw(o.mae)}</td></tr>
              <tr><th>RMSE</th><td>Like MAE but punishes big misses harder.</td><td>{mw(o.rmse)}</td></tr>
              <tr><th>Bias</th><td>Average signed miss. Negative = forecast too high.</td><td>{signedGw(o.bias)}</td></tr>
              <tr><th>WAPE</th><td>Total absolute error ÷ total actual wind energy.</td><td>{pct(o.wape, 1)}</td></tr>
              <tr><th>P50 / P90 / P99</th><td>Half / 9-in-10 / 99-in-100 hours miss by less than this.</td><td>{gw(o.p50_abs, 1)} / {gw(o.p90_abs, 1)} / {gw(o.p99_abs, 1)}</td></tr>
              <tr><th>P10–P90 range</th><td>Forecast + 10th / 90th percentile of errors from the previous 14 settled days.</td><td>{pct(data.band_coverage)} hit</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
