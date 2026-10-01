"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Alta del asistente de Telegram (WP19). Genera el código de un solo uso y lo
 * muestra UNA vez: la base solo guarda su hash, así que no hay forma de volver a
 * consultarlo. Si se pierde, se genera otro.
 *
 * Dos modos (WP31-C2), con las props de siempre compatibles con `/admin`:
 *  - `admin` (por defecto): el panel del founder, con el diagnóstico de variables.
 *    La clave de Anthropic aparece como OPCIONAL: sin ella el bot atiende comandos.
 *  - `equipo`: `/equipo/telegram`, para cualquiera del equipo. Habla de recibir el
 *    resumen de sus entregas y lo urgente, sin nombres de variables de entorno.
 */
export default function BotLinkPanel({
  linked,
  linkedAt,
  enabled,
  missing,
  optional,
  modo = "admin",
  bot,
}: {
  linked: boolean;
  linkedAt: string | null;
  enabled: boolean;
  missing: string[];
  /** Variables opcionales que faltan (hoy, `ANTHROPIC_API_KEY`). Sin la prop, se explica en general. */
  optional?: string[];
  modo?: "admin" | "equipo";
  /** Cómo nombrar al bot en el copy: `@usuario` si se conoce; si no, "el bot de Zelena". */
  bot?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const nombreBot = bot?.trim() || "el bot de Zelena";

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

  if (modo === "equipo") {
    return (
      <div className="space-y-4">
        {linked ? (
          <p className="text-sm text-white">Listo: tu Telegram está vinculado.</p>
        ) : (
          <ol className="list-inside list-decimal space-y-1 text-sm text-muted">
            <li>Genera tu código.</li>
            <li>
              Escríbele a {nombreBot} {"«/start CÓDIGO»"}. Vence en 30 minutos.
            </li>
          </ol>
        )}

        {!enabled && !linked ? (
          <p className="text-xs text-faint">
            El bot de Telegram todavía no está encendido. Mientras tanto, lo que necesita tu atención sigue en tu
            bandeja de avisos.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {linked ? (
            <button className="btn btn-ghost" onClick={() => llamar("desvincular")} disabled={loading}>
              {loading ? "…" : "Desvincular"}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => llamar()} disabled={loading || !enabled}>
              {loading ? "Generando…" : "Generar código"}
            </button>
          )}
        </div>

        {code ? (
          <div className="rounded-md border border-primary/30 bg-primary/[0.06] p-3">
            <p className="text-xs text-faint">Escríbele esto a {nombreBot}. Se muestra una sola vez:</p>
            <p className="mt-1 font-mono text-lg text-primary">/start {code}</p>
          </div>
        ) : null}

        {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
      </div>
    );
  }

  const faltaClave = optional ? optional.includes("ANTHROPIC_API_KEY") : null;

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

      <p className="text-xs text-faint">
        {faltaClave === null
          ? "ANTHROPIC_API_KEY es opcional: sin ella, el bot atiende /start y los comandos, y no interpreta texto libre."
          : faltaClave
            ? "Opcional: ANTHROPIC_API_KEY. Sin ella, el bot atiende /start y los comandos, y no interpreta texto libre."
            : "Texto libre activo (ANTHROPIC_API_KEY configurada)."}
      </p>

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
