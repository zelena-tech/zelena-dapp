"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteGenerator({
  activeCount,
  cap,
  tier,
}: {
  activeCount: number;
  cap: number;
  tier: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const atCap = activeCount >= cap;

  async function generate() {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/invite/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo generar.");
        return;
      }
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button className="btn btn-primary w-full" onClick={generate} disabled={loading || atCap}>
        {atCap ? `Tope de ${tier} alcanzado (${cap})` : loading ? "Generando…" : "Generar invitación"}
      </button>
      {msg ? <p className="mt-2 text-sm text-red-400">{msg}</p> : null}
    </div>
  );
}
