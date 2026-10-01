"use client";
/**
 * Publicar una entrega en el Ágora (WP31-C2, spec §5.C.4 y §8.5).
 *
 * Todo lo que va a ser público se ve y se edita aquí antes de confirmar: el formulario
 * llega prellenado desde la tarea (título, qué hay que entregar, cómo se evalúa) y con
 * la campaña "Zelena", y "Ver cómo quedará" muestra la ficha tal como la verá
 * cualquiera. Solo después aparece "Publicar".
 *
 * Las reglas las vuelve a aplicar el servidor (lib/agora-publicar.ts); este formulario
 * no es el guardián. Usa las mismas funciones puras para la suma y los montos, así la
 * vista previa y lo que se guarda coinciden.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LIMITES_PUBLICAR,
  copySumaHitos,
  montosDeHitos,
  publicarSchema,
  sumaPct,
  type BorradorPublicacion,
  type ParaQuien,
} from "@/lib/agora-publicar";
import { tipoDesdeEtiqueta } from "@/lib/agora-labels";
import { StateBadge, Tag } from "@/components/ui";

interface HitoEditable {
  nombre: string;
  semana: string;
  pct: string;
}

const L = LIMITES_PUBLICAR;

function aNumero(v: string): number {
  const t = v.trim();
  return t === "" ? Number.NaN : Number(t);
}

export default function PublicarAgoraForm({ inicial }: { inicial: BorradorPublicacion }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<ParaQuien>(inicial.tipo);
  const [campana, setCampana] = useState(inicial.campana);
  const [titulo, setTitulo] = useState(inicial.titulo);
  const [resumen, setResumen] = useState(inicial.resumen);
  const [descripcion, setDescripcion] = useState(inicial.descripcionPublica);
  const [criterio, setCriterio] = useState(inicial.criterioPublico);
  const [presupuesto, setPresupuesto] = useState(inicial.presupuestoUsd === null ? "" : String(inicial.presupuestoUsd));
  const [semanas, setSemanas] = useState(String(inicial.semanas));
  const [hitos, setHitos] = useState<HitoEditable[]>(
    inicial.hitos.map((h) => ({ nombre: h.nombre, semana: h.semana, pct: String(h.pct) }))
  );
  const [vista, setVista] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");

  const cuerpo = useMemo(
    () => ({
      assignmentId: inicial.assignmentId,
      tipo,
      presupuestoUsd: aNumero(presupuesto),
      semanas: aNumero(semanas),
      campana,
      titulo,
      resumen,
      descripcionPublica: descripcion,
      criterioPublico: criterio,
      hitos: hitos.map((h) => ({ nombre: h.nombre, semana: h.semana, pct: aNumero(h.pct) })),
    }),
    [inicial.assignmentId, tipo, presupuesto, semanas, campana, titulo, resumen, descripcion, criterio, hitos]
  );

  const suma = sumaPct(cuerpo.hitos);
  const montos = Number.isInteger(cuerpo.presupuestoUsd)
    ? montosDeHitos(cuerpo.presupuestoUsd, cuerpo.hitos.map((h) => (Number.isFinite(h.pct) ? h.pct : 0)))
    : cuerpo.hitos.map(() => 0);

  function cambiarHito(i: number, campo: keyof HitoEditable, valor: string) {
    setHitos((hs) => hs.map((h, j) => (j === i ? { ...h, [campo]: valor } : h)));
    setVista(false);
  }

  function verComoQueda() {
    const parsed = publicarSchema.safeParse(cuerpo);
    if (!parsed.success) {
      setMsg(parsed.error.issues[0]?.message ?? "Revisa los campos.");
      setVista(false);
      return;
    }
    setMsg("");
    setVista(true);
  }

  async function publicar() {
    const parsed = publicarSchema.safeParse(cuerpo);
    if (!parsed.success) {
      setMsg(parsed.error.issues[0]?.message ?? "Revisa los campos.");
      setVista(false);
      return;
    }
    setEnviando(true);
    setMsg("");
    try {
      const res = await fetch("/api/equipo/publicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo publicar.");
        return;
      }
      router.push(`/agora/${data.projectId}`);
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setEnviando(false);
    }
  }

  const campo = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-faint";
  const editar = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setVista(false);
  };

  return (
    <div className="space-y-6">
      <form
        className="card space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          verComoQueda();
        }}
      >
        <fieldset>
          <legend className="block text-xs text-muted">Para quién</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-white">
            {(
              [
                ["cliente", "Un cliente"],
                ["comunidad", "La comunidad"],
              ] as const
            ).map(([valor, label]) => (
              <label key={valor} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="para-quien"
                  value={valor}
                  checked={tipo === valor}
                  onChange={() => editar(setTipo)(valor)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-muted" htmlFor="pub-campana">
              Campaña
            </label>
            <input
              id="pub-campana"
              value={campana}
              onChange={(e) => editar(setCampana)(e.target.value)}
              maxLength={L.campanaMax}
              className={`mt-1 ${campo}`}
            />
          </div>
          <div>
            <label className="block text-xs text-muted" htmlFor="pub-titulo">
              Título
            </label>
            <input
              id="pub-titulo"
              value={titulo}
              onChange={(e) => editar(setTitulo)(e.target.value)}
              maxLength={L.tituloMax}
              className={`mt-1 ${campo}`}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted" htmlFor="pub-resumen">
            Resumen (10–400)
          </label>
          <textarea
            id="pub-resumen"
            value={resumen}
            onChange={(e) => editar(setResumen)(e.target.value)}
            maxLength={L.resumenMax}
            rows={2}
            className={`mt-1 ${campo}`}
          />
          <p className="mt-1 text-xs text-faint">{resumen.trim().length} de 400</p>
        </div>

        <div>
          <label className="block text-xs text-muted" htmlFor="pub-descripcion">
            Qué hay que entregar
          </label>
          <textarea
            id="pub-descripcion"
            value={descripcion}
            onChange={(e) => editar(setDescripcion)(e.target.value)}
            maxLength={L.textoMax}
            rows={4}
            className={`mt-1 ${campo}`}
          />
        </div>

        <div>
          <label className="block text-xs text-muted" htmlFor="pub-criterio">
            Cómo se va a evaluar
          </label>
          <textarea
            id="pub-criterio"
            value={criterio}
            onChange={(e) => editar(setCriterio)(e.target.value)}
            maxLength={L.textoMax}
            rows={3}
            className={`mt-1 ${campo}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-muted" htmlFor="pub-presupuesto">
              Presupuesto (USD, red de pruebas)
            </label>
            <input
              id="pub-presupuesto"
              type="number"
              inputMode="numeric"
              min={L.presupuestoMin}
              max={L.presupuestoMax}
              step={1}
              value={presupuesto}
              onChange={(e) => editar(setPresupuesto)(e.target.value)}
              className={`mt-1 ${campo}`}
            />
          </div>
          <div>
            <label className="block text-xs text-muted" htmlFor="pub-semanas">
              Semanas
            </label>
            <input
              id="pub-semanas"
              type="number"
              inputMode="numeric"
              min={L.semanasMin}
              max={L.semanasMax}
              step={1}
              value={semanas}
              onChange={(e) => editar(setSemanas)(e.target.value)}
              className={`mt-1 ${campo}`}
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="block text-xs text-muted">Hitos</legend>
          <div className="space-y-2">
            {hitos.map((h, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_4.5rem_auto] items-center gap-2">
                <input
                  aria-label={`Nombre del hito ${i + 1}`}
                  value={h.nombre}
                  onChange={(e) => cambiarHito(i, "nombre", e.target.value)}
                  maxLength={L.hitoNombreMax}
                  className={campo}
                />
                <input
                  aria-label={`Semana del hito ${i + 1}`}
                  value={h.semana}
                  onChange={(e) => cambiarHito(i, "semana", e.target.value)}
                  maxLength={L.hitoSemanaMax}
                  className={campo}
                />
                <input
                  aria-label={`Porcentaje del hito ${i + 1}`}
                  type="number"
                  inputMode="numeric"
                  min={L.pctMin}
                  max={L.pctMax}
                  step={1}
                  value={h.pct}
                  onChange={(e) => cambiarHito(i, "pct", e.target.value)}
                  className={campo}
                />
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-1 text-xs"
                  disabled={hitos.length <= L.hitosMin}
                  onClick={() => {
                    setHitos((hs) => hs.filter((_, j) => j !== i));
                    setVista(false);
                  }}
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs ${suma === 100 ? "text-faint" : "text-amber-300"}`}>{copySumaHitos(suma)}</p>
            <button
              type="button"
              className="btn btn-ghost px-2 py-1 text-xs"
              disabled={hitos.length >= L.hitosMax}
              onClick={() => {
                setHitos((hs) => [...hs, { nombre: "", semana: "", pct: "" }]);
                setVista(false);
              }}
            >
              Añadir hito
            </button>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-ghost">
            Ver cómo quedará
          </button>
          <p className="text-xs text-faint">Los pagos dentro de la plataforma corren en la red de pruebas de Stellar.</p>
        </div>
        {msg && !vista ? <p className="text-sm text-red-400">{msg}</p> : null}
      </form>

      {vista ? (
        <section className="space-y-4" aria-labelledby="asi-se-vera">
          <h2 id="asi-se-vera" className="font-head text-2xl font-bold text-white">
            Así se verá
          </h2>
          <div className="card space-y-5 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-faint">{campana.trim()}</span>
              <Tag type={tipoDesdeEtiqueta(tipo)} />
              <StateBadge state="Open" />
            </div>
            <h3 className="font-serif text-3xl font-normal leading-[1.15] text-paper">{titulo.trim()}</h3>
            <p className="text-sm leading-6 text-muted">{resumen.trim()}</p>
            <p className="whitespace-pre-line text-sm leading-6 text-muted">{descripcion.trim()}</p>

            <div>
              <p className="text-sm font-semibold text-white">Pagos por hitos</p>
              <p className="mt-1 text-xs text-faint">
                Presupuesto total: USD {cuerpo.presupuestoUsd.toLocaleString("es")} · {cuerpo.semanas} semanas · Red de
                pruebas
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-2 py-2">Hito</th>
                      <th className="px-2 py-2">Semana</th>
                      <th className="px-2 py-2 text-right">%</th>
                      <th className="px-2 py-2 text-right">Pago · Red de pruebas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuerpo.hitos.map((h, i) => (
                      <tr key={i} className="border-b border-line/40">
                        <td className="px-2 py-2">
                          <span className="font-semibold text-white">H{i + 1}</span>{" "}
                          <span className="text-muted">{h.nombre.trim()}</span>
                        </td>
                        <td className="px-2 py-2 text-faint">{h.semana.trim()}</td>
                        <td className="px-2 py-2 text-right text-muted">{h.pct}%</td>
                        <td className="px-2 py-2 text-right text-white">${montos[i]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-white">Cómo se va a evaluar</p>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted">{criterio.trim()}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" onClick={publicar} disabled={enviando}>
              {enviando ? "Publicando…" : "Publicar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setVista(false)} disabled={enviando}>
              Seguir editando
            </button>
          </div>
          {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
