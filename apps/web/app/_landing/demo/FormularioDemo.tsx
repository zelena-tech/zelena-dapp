"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AVISO_PRIVACIDAD_VERSION } from "@/lib/aviso-privacidad";
import s from "../landing.module.css";
import d from "./demo.module.css";
import { IconoCheck, IconoFlechaDiagonal } from "../Iconos";
import type { TextosFormularioDemo } from "../copy-demo";

/** La única llamada de esta isla: la misma API que el formulario en español. */
const API_SOLICITUD = "/api/empresas/contacto";

type Estado = "listo" | "enviando" | "ok" | "error";

/**
 * Formulario de la demo (isla de cliente), con el patrón de ContactoForm: estados
 * explícitos, el éxito reemplaza al formulario y la casilla de autorización (Ley 1581)
 * viaja al servidor con la versión del aviso que enlaza. La API responde en español: aquí
 * se traduce por código de estado, nunca se muestra su texto. Al enviar, el aviso de éxito
 * es más corto que el formulario: se trae a la vista y recibe el foco.
 */
export default function FormularioDemo({
  textos,
  interesInicial,
}: {
  textos: TextosFormularioDemo;
  interesInicial: string;
}) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [interes, setInteres] = useState(interesInicial);
  const [mensaje, setMensaje] = useState("");
  const [sitio, setSitio] = useState("");
  const [estado, setEstado] = useState<Estado>("listo");
  const [error, setError] = useState("");
  const exito = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (estado !== "ok") return;
    exito.current?.scrollIntoView({ block: "center" });
    exito.current?.focus({ preventScroll: true });
  }, [estado]);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const casilla = e.currentTarget.elements.namedItem("acepto") as HTMLInputElement | null;
    const acepto = casilla?.checked === true;
    setEstado("enviando");
    setError("");
    try {
      const res = await fetch(API_SOLICITUD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, empresa, interes, mensaje, sitio, acepto, aviso: AVISO_PRIVACIDAD_VERSION }),
      });
      if (!res.ok) {
        const m = textos.errores;
        setEstado("error");
        setError(res.status === 400 ? m.datos : res.status === 409 ? m.aviso : res.status === 429 ? m.muchos : m.otro);
        return;
      }
      setEstado("ok");
    } catch {
      setEstado("error");
      setError(textos.errores.red);
    }
  }

  if (estado === "ok") {
    const x = textos.exito;
    return (
      <div ref={exito} tabIndex={-1} className={d.exito} role="status" aria-live="polite">
        <span className={d.exitoIcono} aria-hidden="true">
          <IconoCheck tamano={22} trazo={3} />
        </span>
        <p className={d.exitoEtiqueta}>{x.etiqueta}</p>
        <p className={`${s.display} ${d.exitoTitulo}`}>
          {x.saludo}, {nombre.trim().split(/\s+/)[0]}.
        </p>
        <p className={d.exitoTexto}>
          {x.antes}
          <strong>{email}</strong>
          {x.despues}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className={d.formulario} aria-labelledby="demo-formulario-titulo">
      <h2 id="demo-formulario-titulo" className={`${s.display} ${d.formularioTitulo}`}>
        {textos.titulo}
      </h2>

      <div className={d.dosColumnas}>
        <div className={d.campo}>
          <label className={d.etiqueta} htmlFor="demo-nombre">
            {textos.nombre}
          </label>
          <input
            id="demo-nombre"
            className={d.entrada}
            autoComplete="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
        </div>
        <div className={d.campo}>
          <label className={d.etiqueta} htmlFor="demo-email">
            {textos.email}
          </label>
          <input
            id="demo-email"
            type="email"
            className={d.entrada}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
            required
          />
        </div>
      </div>

      <div className={d.campo}>
        <label className={d.etiqueta} htmlFor="demo-empresa">
          {textos.empresa} <span className={d.opcional}>· {textos.opcional}</span>
        </label>
        <input
          id="demo-empresa"
          className={d.entrada}
          autoComplete="organization"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          maxLength={120}
        />
      </div>

      <fieldset className={d.intereses}>
        <legend className={d.etiqueta}>{textos.interes}</legend>
        <div className={d.opciones}>
          {textos.intereses.map((i) => (
            <label key={i.slug} className={d.opcion}>
              <input
                type="radio"
                name="interes"
                value={i.slug}
                checked={interes === i.slug}
                onChange={() => setInteres(i.slug)}
                className={d.opcionInput}
              />
              <span className={d.opcionPildora}>{i.etiqueta}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={d.campo}>
        <label className={d.etiqueta} htmlFor="demo-mensaje">
          {textos.mensaje} <span className={d.opcional}>· {textos.opcional}</span>
        </label>
        <textarea
          id="demo-mensaje"
          className={`${d.entrada} ${d.area}`}
          placeholder={textos.mensajeAyuda}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          maxLength={2000}
        />
      </div>

      {/* Campo trampa: invisible y fuera del orden de tabulación para personas. */}
      <div aria-hidden="true" className={d.trampa}>
        <label htmlFor="demo-sitio">{textos.trampa}</label>
        <input id="demo-sitio" tabIndex={-1} autoComplete="off" value={sitio} onChange={(e) => setSitio(e.target.value)} />
      </div>

      {/* Autorización de tratamiento de datos (Ley 1581): obligatoria y NUNCA premarcada. */}
      <label htmlFor="demo-acepto" className={d.casilla}>
        <input id="demo-acepto" name="acepto" type="checkbox" required className={d.casillaInput} />
        <span>
          {textos.consentimiento.antes}
          <Link href="/privacidad" hrefLang="es" className={d.enlace}>
            {textos.consentimiento.enlace}
          </Link>
          {textos.consentimiento.despues}
        </span>
      </label>

      {estado === "error" && error ? (
        <p className={d.error} role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className={`${s.ctaPrimario} ${d.enviar}`} disabled={estado === "enviando"}>
        <span>{estado === "enviando" ? textos.enviando : textos.enviar}</span>
        <span className={s.ctaFlecha} aria-hidden="true">
          <IconoFlechaDiagonal tamano={16} />
        </span>
      </button>
    </form>
  );
}
