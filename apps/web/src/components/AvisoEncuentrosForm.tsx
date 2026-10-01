"use client";
import { useState } from "react";

// Mismo patrón que ContactoForm: estados explícitos, el error de la API se
// muestra tal cual y el éxito reemplaza al formulario.
export default function AvisoEncuentrosForm() {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [sitio, setSitio] = useState("");
  const [estado, setEstado] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("loading");
    setError("");
    try {
      const res = await fetch("/api/encuentros/aviso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, ciudad, sitio }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEstado("error");
        setError(data.error ?? "No pudimos guardar tu correo. Intenta de nuevo.");
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
        <span className="text-[11px] uppercase tracking-[0.18em] text-primary">Anotado</span>
        <p className="font-serif text-3xl normal-case leading-snug text-paper">
          Nos vemos pronto, {nombre.split(" ")[0]}.
        </p>
        <p className="text-base leading-7 text-muted">
          Te escribimos a <span className="text-paper">{email}</span> apenas publiquemos la fecha.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="card flex flex-col gap-5 p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="a-nombre">Nombre</label>
          <input
            id="a-nombre"
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
          <label className="label" htmlFor="a-email">Correo</label>
          <input
            id="a-email"
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
        <label className="label" htmlFor="a-ciudad">
          Ciudad <span className="normal-case tracking-normal text-faint">· opcional</span>
        </label>
        <input
          id="a-ciudad"
          className="input"
          autoComplete="address-level2"
          placeholder="Bogotá, Medellín, Ciudad de México…"
          value={ciudad}
          onChange={(e) => setCiudad(e.target.value)}
          maxLength={80}
        />
      </div>

      {/* Campo trampa: invisible y fuera del orden de tabulación para personas. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="a-sitio">Sitio web</label>
        <input
          id="a-sitio"
          tabIndex={-1}
          autoComplete="off"
          value={sitio}
          onChange={(e) => setSitio(e.target.value)}
        />
      </div>

      {estado === "error" && error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <button className="btn btn-primary w-full normal-case tracking-normal sm:w-fit" disabled={estado === "loading"}>
        {estado === "loading" ? "Guardando…" : "Avísame"}
      </button>
    </form>
  );
}
