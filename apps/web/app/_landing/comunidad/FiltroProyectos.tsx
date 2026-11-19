"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import s from "../landing.module.css";
import c from "./comunidad.module.css";
import Chip from "../Chip";
import { IconoFlechaDerecha } from "../Iconos";
import { PROYECTOS } from "../copy-comunidad";
import type { ClaveTipoProyecto, ProyectoAbierto } from "@/lib/landing-datos";

/** Un filtro por cada tipo que de verdad aparece en la lista (con su etiqueta en inglés). */
export interface FiltroTipo {
  clave: ClaveTipoProyecto;
  etiqueta: string;
}

/**
 * La rejilla de proyectos abiertos, con filtros por tipo solo si hay dos tipos o más
 * (los decide el servidor: nunca un filtro que deja la lista vacía). Botones con
 * `aria-pressed` dentro de un grupo con nombre y un estado que anuncia cuántos quedan.
 * Todo llega por props (objetos planos): esta isla no lee la base.
 */
export default function FiltroProyectos({
  cabecera,
  proyectos,
  filtros,
}: {
  /** Eyebrow y h2 de la sección (del servidor): los filtros van a su derecha. */
  cabecera: ReactNode;
  proyectos: ProyectoAbierto[];
  filtros: FiltroTipo[];
}) {
  const [filtro, setFiltro] = useState<ClaveTipoProyecto | null>(null);
  const visibles = filtro ? proyectos.filter((p) => p.tipo === filtro) : proyectos;
  const conFiltros = filtros.length >= 2;

  return (
    <>
      <div className={c.cabecera} data-reveal="titulo">
        {cabecera}
        {conFiltros ? (
          <div className={c.filtros} role="group" aria-label={PROYECTOS.filtrosAria}>
            <button type="button" className={c.filtro} aria-pressed={filtro === null} onClick={() => setFiltro(null)}>
              {PROYECTOS.todos}
            </button>
            {filtros.map((f) => (
              <button
                key={f.clave}
                type="button"
                className={c.filtro}
                aria-pressed={filtro === f.clave}
                onClick={() => setFiltro(f.clave)}
              >
                {f.etiqueta}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <ul className={c.proyGrid} data-reveal="escalonado">
        {visibles.map((p) => (
          <li key={p.id}>
            <Link href={p.href} hrefLang="es" className={c.proy}>
              <span className={c.proyArriba}>
                <Chip tono="blanco" tamano="sm" className={c.mayusculas}>
                  {p.etiquetaTipo}
                </Chip>
                <span className={c.proySemanas}>{PROYECTOS.semanas(p.semanas)}</span>
              </span>
              <h3 className={c.proyTitulo} lang="es">
                {p.titulo}
              </h3>
              <span className={c.proyAbajo}>
                <span className={c.proyMonto}>
                  {PROYECTOS.monto(p.presupuestoUsd)}
                  <Chip tono="blanco" tamano="sm" className={c.mayusculas}>
                    {PROYECTOS.red}
                  </Chip>
                </span>
                <span className={c.proyFlecha} aria-hidden="true">
                  <IconoFlechaDerecha tamano={16} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {conFiltros ? (
        <p role="status" className={s.srOnly}>
          {PROYECTOS.mostrados(visibles.length)}
        </p>
      ) : null}
    </>
  );
}
