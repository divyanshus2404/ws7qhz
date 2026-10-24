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

const HERO: Record<Tab, { eyebrow: string; title: string; italic: string; body: string }> = {
  desk: {
    eyebrow: "Day-ahead desk",
    title: "Know the wind,",
    italic: "before you buy.",
    body: "The exact forecast you had when the auction closed, turned into a range of wind you can actually plan around.",
  },
  accuracy: {
    eyebrow: "Forecast accuracy",
    title: "How far can you",
    italic: "trust the forecast?",
    body: "Every January delivery hour scored against the forecast the desk really had, with the error measured and corrected.",
  },
  explorer: {
    eyebrow: "Horizon explorer",
    title: "The further ahead,",
    italic: "the wider the miss.",
    body: "Choose how far ahead the forecast was made and see how accuracy changes with lead time.",
  },
};

const CUTOFFS = ["07:00", "09:00", "10:00", "11:00", "12:00", "16:00"];

export default function App() {
  const [tab, setTab] = useState<Tab>("desk");
  const [cutoff, setCutoff] = useState("11:00");
  const meta = useApi(api.meta, []);

  return (
    <>
    <div className="banner">
      Pilot results · every January 2026 day-ahead decision, scored against Elexon outturn
      <a href="https://github.com/divyanshus2404/ws7qhz" target="_blank" rel="noreferrer">How it works ›</a>
    </div>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <div className="brand-name">Wind Forecast Desk</div>
        </div>
        <div className="brand-sub">GB national wind · day-ahead procurement</div>
      </header>

      <section className="hero">
        <div className="eyebrow">{HERO[tab].eyebrow}</div>
        <h1>
          {HERO[tab].title} <em>{HERO[tab].italic}</em>
        </h1>
        <p>{HERO[tab].body}</p>
      </section>

      <div className="controls">
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
      </div>

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
    </>
  );
}
