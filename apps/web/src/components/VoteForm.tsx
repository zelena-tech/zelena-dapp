"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const OPTIONS = [
  { key: "favor", label: "A favor" },
  { key: "contra", label: "En contra" },
  { key: "abstencion", label: "Abstención" },
] as const;

export default function VoteForm({ proposalId, current }: { proposalId: number; current: string | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState<string | null>(current);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function vote(k: string) {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/governance/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, choice: k }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo registrar el voto.");
        return;
      }
      setChoice(k);
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  if (current) {
    return (
      <p className="text-sm text-primary">
        Ya votaste: <strong>{OPTIONS.find((o) => o.key === current)?.label}</strong>. Un voto por wallet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => vote(o.key)}
            disabled={loading}
            className={`btn ${choice === o.key ? "btn-primary" : "btn-ghost"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {msg ? <p className="mt-2 text-sm text-red-400">{msg}</p> : null}
    </div>
  );
}
