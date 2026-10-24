import type { ReactNode } from "react";

export function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "accent" | "muted";
}) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children, actions }: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="card-sub">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "line" | "dash" | "band" }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <span className={`swatch ${i.kind ?? "line"}`} style={{ "--c": i.color } as React.CSSProperties} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Status({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <div className="status error">Couldn’t load data: {error}</div>;
  if (loading) return <div className="status">Loading…</div>;
  return null;
}

// Shared tooltip shell for Recharts so every chart reads the same.
export function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="tip">
      <div className="tip-title">{title}</div>
      {rows.map((r) => (
        <div className="tip-row" key={r.label}>
          <span>
            {r.color && <i style={{ background: r.color }} />}
            {r.label}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}
