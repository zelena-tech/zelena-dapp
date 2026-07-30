"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Alta del asistente de Telegram (WP19). Genera el código de un solo uso y lo
 * muestra UNA vez: la base solo guarda su hash, así que no hay forma de volver a
 * consultarlo. Si se pierde, se genera otro.
 */
export default function BotLinkPanel({
  linked,
  linkedAt,
  enabled,
  missing,
}: {
  linked: boolean;
  linkedAt: string | null;
  enabled: boolean;
  missing: string[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function llamar(action?: string) {
    setLoading(true);
    setMsg("");
    setCode(null);
    try {
      const res = await fetch("/api/telegram/vincular", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action ? { action } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo completar.");
        return;
      }
      if (data.code) setCode(data.code);
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {linked
          ? `Telegram vinculado${linkedAt ? ` desde ${linkedAt.slice(0, 10)}` : ""}.`
          : "Genera un código, escríbele al bot «/start CÓDIGO» y queda vinculado."}
      </p>

      {!enabled ? (
        <p className="text-xs text-faint">
          El bot está apagado (`TELEGRAM_ENABLED`). El scaffolding está listo; se enciende cuando existan las
          variables de entorno.
          {missing.length > 0 ? ` Faltan: ${missing.join(", ")}.` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => llamar()} disabled={loading || linked}>
          {loading ? "Generando…" : "Generar código de alta"}
        </button>
        {linked ? (
          <button className="btn btn-ghost" onClick={() => llamar("desvincular")} disabled={loading}>
            Desvincular
          </button>
        ) : null}
      </div>

      {code ? (
        <div className="rounded-md border border-primary/30 bg-primary/[0.06] p-3">
          <p className="text-xs text-faint">Envíale esto al bot. Se muestra una sola vez:</p>
          <p className="mt-1 font-mono text-lg text-primary">/start {code}</p>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
    </div>
  );
}
