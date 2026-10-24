import { useState } from "react";
import { api } from "./api";
import { useApi } from "./useApi";
import DayAheadView from "./views/DayAhead";
import ExplorerView from "./views/Explorer";
import AccuracyView from "./views/Accuracy";

const TABS = [
  { id: "desk", label: "Day-ahead desk" },
  { id: "accuracy", label: "Forecast accuracy" },
  { id: "explorer", label: "Horizon explorer" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const CUTOFFS = ["07:00", "09:00", "10:00", "11:00", "12:00", "16:00"];

export default function App() {
  const [tab, setTab] = useState<Tab>("desk");
  const [cutoff, setCutoff] = useState("11:00");
  const meta = useApi(api.meta, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <div>
            <div className="brand-name">Wind Forecast Desk</div>
            <div className="brand-sub">GB national wind · day-ahead procurement · January 2026</div>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        {tab !== "explorer" && (
          <label className="cutoff">
            Decision time (D-1, UK)
            <select value={cutoff} onChange={(e) => setCutoff(e.target.value)}>
              {CUTOFFS.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === "11:00" ? " · auction close" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <main>
        {meta.data && tab === "desk" && <DayAheadView meta={meta.data} cutoff={cutoff} />}
        {meta.data && tab === "accuracy" && <AccuracyView cutoff={cutoff} />}
        {meta.data && tab === "explorer" && <ExplorerView meta={meta.data} />}
        {meta.error && <div className="status error">Couldn’t reach the API: {meta.error}</div>}
      </main>

      <footer className="foot">
        Data: Elexon BMRS — FUELHH (wind outturn, half-hourly) and WINDFOR (wind forecast, hourly).
        {meta.data && ` ${meta.data.publications} forecast publications loaded (${meta.data.data_source}).`}
      </footer>
    </div>
  );
}
