"use client";
/**
 * Digest diario del equipo: se muestra ya renderizado (server-side) y se puede
 * copiar o descargar como texto plano.
 *
 * v1 NO envía nada: no hay correo, ni Teams, ni notificaciones. Este panel es la
 * única salida del digest y es manual a propósito — el envío automático es la
 * fase "automatizar" y está fuera del alcance de WP15.
 *
 * El texto llega ya armado desde lib/digest.ts; este componente no lo construye
 * ni lo reordena, solo lo presenta y lo pone en el portapapeles.
 */
import { useState } from "react";

export default function DigestPanel({ text, day }: { text: string; day: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("El navegador no dejó copiar. Selecciona el texto y cópialo a mano.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={copy} className="btn btn-primary py-1.5 text-sm">
          {copied ? "Copiado" : "Copiar el digest"}
        </button>
        <a
          href={`/api/equipo/digest?dia=${encodeURIComponent(day)}`}
          className="btn btn-ghost py-1.5 text-sm"
          download
        >
          Descargar .txt
        </a>
        <span className="text-xs text-faint">
          No se envía por correo ni a Teams: se copia a mano. El envío automático es otra fase.
        </span>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <pre className="max-h-96 overflow-auto rounded-md border border-line bg-bg px-4 py-3 text-sm leading-relaxed text-muted whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}
