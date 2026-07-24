"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Variant = "primary" | "ghost" | "danger" | "done";

export default function AdminAction({
  action,
  payload,
  label,
  variant = "ghost",
  disabled = false,
}: {
  action: string;
  payload: Record<string, number | string>;
  label: string;
  variant?: Variant;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Error");
        return;
      }
      router.refresh();
    } catch {
      setErr("Error de red");
    } finally {
      setLoading(false);
    }
  }

  const cls =
    variant === "primary"
      ? "btn-primary"
      : variant === "danger"
      ? "btn-danger"
      : variant === "done"
      ? "btn-ghost opacity-60"
      : "btn-ghost";

  return (
    <span className="inline-flex flex-col">
      <button className={`btn ${cls} py-1.5 text-xs`} onClick={run} disabled={loading || disabled}>
        {loading ? "…" : label}
      </button>
      {err ? <span className="mt-1 text-[11px] text-red-400">{err}</span> : null}
    </span>
  );
}
