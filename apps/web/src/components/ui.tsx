import React from "react";
import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6 L20 6 L4 18 L20 18" stroke="#3CE109" strokeWidth="2.2" strokeLinecap="square" fill="none" />
      </svg>
      <span className="font-mono text-lg font-bold uppercase tracking-tight text-white">
        ZELENA<span className="text-primary">.</span>
      </span>
    </span>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card card-hover p-5">
      <div className="font-head text-3xl font-bold text-primary glow-text">{value}</div>
      <div className="mt-1 text-sm text-white">{label}</div>
      {hint ? <div className="mt-0.5 text-xs text-faint">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="#1A3A0A" strokeWidth="1.6" />
        <path d="M7 9h10M7 13h6" stroke="#3CE109" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <h3 className="font-head text-xl font-bold text-white">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {cta ? (
        <Link href={cta.href} className="btn btn-ghost mt-1">
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar-track h-2 w-full overflow-hidden rounded-full">
      <div className="bar-fill h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tag({ type }: { type: string }) {
  const isSas = type === "SAS";
  return <span className={`tag ${isSas ? "tag-sas" : "tag-dao"}`}>{type}</span>;
}

export function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    Open: "text-primary border-primary/40 bg-glow",
    Assigned: "text-amber-300 border-amber-700/40 bg-amber-950/20",
    Delivered: "text-sky-300 border-sky-700/40 bg-sky-950/20",
    Scored: "text-violet-300 border-violet-700/40 bg-violet-950/20",
    Distributed: "text-emerald-300 border-emerald-700/40 bg-emerald-950/20",
  };
  return <span className={`tag ${map[state] ?? "text-muted border-line"}`}>{state}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function shortWallet(w: string): string {
  if (!w) return "";
  return w.length > 12 ? `${w.slice(0, 5)}…${w.slice(-4)}` : w;
}
