"use client";
/**
 * WP13 · Banner persistente del segundo correo personal (doc 15 §2).
 *
 * PERSISTENTE, no bloqueante: no hay botón de "descartar" porque el correo es
 * obligatorio para el core, pero el banner NO tapa ni interrumpe el trabajo del día.
 * El texto habla del trámite, nunca de la persona.
 *
 * El segundo correo es de CONTACTO, no una puerta: no existe el login con correo
 * personal (hallazgo M1), así que el texto no lo promete. Sin la cuenta corporativa
 * se entra con una wallet.
 *
 * Se autoconsulta a `/api/auth/entra/segundo-correo`: si ya hay correo vinculado, o la
 * puerta de Microsoft está apagada (`AUTH_ENTRA_ENABLED`), no se dibuja; así que se
 * puede montar sin condicionales en cualquier página.
 */
import { useEffect, useState } from "react";

export function EntraSecondEmailBanner() {
  const [needs, setNeeds] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/entra/segundo-correo")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setNeeds(d ? !!d.needsRecoveryEmail : false);
      })
      .catch(() => {
        if (alive) setNeeds(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/auth/entra/segundo-correo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo vincular el correo.");
        return;
      }
      setDone(data.email);
      setNeeds(false);
    } catch {
      setError("Error de red.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-primary/40 bg-primary/10 p-4 text-sm text-white">
        Segundo correo vinculado: <span className="font-mono">{done}</span>.
      </div>
    );
  }
  if (needs !== true) return null;

  return (
    <div
      role="status"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100"
    >
      <p className="font-bold text-amber-50">Falta tu segundo correo personal</p>
      <p className="mt-1">
        Es un correo de contacto fuera de la organización: si algún día sales, pierdes el acceso corporativo
        pero no tu historial ni tus puntos, y por ahí te ubicamos. No sirve para entrar: sin la cuenta
        corporativa se entra con una wallet. Puedes seguir trabajando con normalidad.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          type="email"
          placeholder="tu.correo@personal.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Segundo correo personal"
        />
        <button className="btn btn-ghost" onClick={save} disabled={saving || email.trim().length < 5}>
          {saving ? "Vinculando…" : "Vincular correo"}
        </button>
      </div>
      {error ? <p className="mt-2 text-red-300">{error}</p> : null}
    </div>
  );
}
