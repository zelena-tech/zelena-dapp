"use client";
import { useState } from "react";
import Link from "next/link";
import { INTERESES } from "@/lib/servicios";

// Formulario comercial. Sigue el patrón de ApplyForm: estados explícitos, el
// error de la API se muestra tal cual y el éxito reemplaza al formulario.
export default function ContactoForm({ interesInicial }: { interesInicial: string }) {
  const valido = INTERESES.some((i) => i.slug === interesInicial);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [interes, setInteres] = useState(valido ? interesInicial : "harmony");
  const [mensaje, setMensaje] = useState("");
  const [sitio, setSitio] = useState("");
  const [estado, setEstado] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("loading");
    setError("");
    try {
      const res = await fetch("/api/empresas/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, empresa, interes, mensaje, sitio }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEstado("error");
        setError(data.error ?? "No pudimos enviar tu mensaje. Intenta de nuevo.");
        return;
      }
      setEstado("ok");
    } catch {
      setEstado("error");
      setError("Sin conexión. Revisa tu red e intenta de nuevo.");
    }
  }

  if (estado === "ok") {
    return (
      <div className="card flex flex-col gap-4 border-primary/40 p-8" role="status" aria-live="polite">
        <span className="text-[11px] uppercase tracking-[0.18em] text-primary">Recibido</span>
        <p className="font-serif text-3xl normal-case leading-snug text-paper">
          Gracias, {nombre.split(" ")[0]}.
        </p>
        <p className="text-base leading-7 text-muted">
          Te escribimos a <span className="text-paper">{email}</span> para coordinar la conversación.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="card flex flex-col gap-5 p-6 sm:p-8" noValidate={false}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="c-nombre">Nombre</label>
          <input
            id="c-nombre"
            className="input"
            autoComplete="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="c-email">Correo</label>
          <input
            id="c-email"
            type="email"
            className="input"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="c-empresa">
          Empresa <span className="normal-case tracking-normal text-faint">· opcional</span>
        </label>
        <input
          id="c-empresa"
          className="input"
          autoComplete="organization"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          maxLength={120}
        />
      </div>

      <div>
        <label className="label" htmlFor="c-interes">Qué te interesa</label>
        <select
          id="c-interes"
          className="input"
          value={interes}
          onChange={(e) => setInteres(e.target.value)}
          required
        >
          {INTERESES.map((i) => (
            <option key={i.slug} value={i.slug}>
              {i.nombre}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="c-mensaje">
          Cuéntanos de tu operación <span className="normal-case tracking-normal text-faint">· opcional</span>
        </label>
        <textarea
          id="c-mensaje"
          className="input min-h-[120px]"
          placeholder="Cuántas bodegas, cuántas personas en piso, qué sistema usan hoy…"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          maxLength={2000}
        />
      </div>

      {/* Campo trampa: invisible y fuera del orden de tabulación para personas. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="c-sitio">Sitio web</label>
        <input
          id="c-sitio"
          tabIndex={-1}
          autoComplete="off"
          value={sitio}
          onChange={(e) => setSitio(e.target.value)}
        />
      </div>

      {/* Autorización de tratamiento de datos (Ley 1581): obligatoria y NUNCA premarcada. */}
      <label htmlFor="c-acepto" className="flex items-start gap-3 text-sm leading-6 text-muted">
        <input
          id="c-acepto"
          name="acepto"
          type="checkbox"
          required
          className="mt-1 h-4 w-4 shrink-0 accent-primary"
        />
        <span>
          Acepto el tratamiento de mis datos según el{" "}
          <Link href="/privacidad" className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
            aviso de privacidad
          </Link>
          .
        </span>
      </label>

      {estado === "error" && error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <button className="btn btn-primary w-full normal-case tracking-normal sm:w-fit" disabled={estado === "loading"}>
        {estado === "loading" ? "Enviando…" : "Enviar"}
      </button>
    </form>
  );
}
