"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Alta de una tarea desde la interfaz. Solo la ve quien supervisa.
 * Vive plegada para que la pantalla de seguimiento siga siendo de lectura:
 * lo primero que se ve es qué está atrasado, no un formulario.
 */

export interface OpcionSimple {
  id: number;
  nombre: string;
}

export default function NuevaAsignacion({
  clientes,
  iniciativas,
  personas,
}: {
  clientes: OpcionSimple[];
  iniciativas: OpcionSimple[];
  personas: Array<{ wallet: string; nombre: string }>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const [titulo, setTitulo] = useState("");
  const [clientId, setClientId] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [ownerWallet, setOwnerWallet] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("media");
  const [size, setSize] = useState("M");
  const [criterios, setCriterios] = useState("");

  async function crear() {
    setGuardando(true);
    setError("");
    try {
      const res = await fetch("/api/equipo/asignacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titulo.trim(),
          clientId: clientId ? Number(clientId) : null,
          initiativeId: initiativeId ? Number(initiativeId) : null,
          ownerWallet: ownerWallet || null,
          dueDate: dueDate || null,
          priority,
          size,
          acceptanceCriteria: criterios.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo crear la tarea.");
        return;
      }
      setTitulo("");
      setDueDate("");
      setCriterios("");
      setOwnerWallet("");
      setAbierto(false);
      router.refresh();
    } catch {
      setError("Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button className="btn btn-primary py-1.5 text-sm" onClick={() => setAbierto(true)}>
        Nueva tarea
      </button>
    );
  }

  return (
    <div className="card w-full p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-head text-lg font-bold text-white">Nueva tarea</h3>
        <button className="btn btn-ghost py-1 text-xs" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label" htmlFor="t-titulo">Qué hay que hacer</label>
          <input
            id="t-titulo"
            className="input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Conteo cíclico de la zona A"
            maxLength={160}
          />
        </div>

        <div>
          <label className="label" htmlFor="t-cliente">Cliente</label>
          <select id="t-cliente" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Trabajo interno</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="t-proyecto">Proyecto</label>
          <select id="t-proyecto" className="input" value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
            <option value="">Sin proyecto</option>
            {iniciativas.map((i) => (
              <option key={i.id} value={i.id}>{i.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="t-responsable">Responsable</label>
          <select id="t-responsable" className="input" value={ownerWallet} onChange={(e) => setOwnerWallet(e.target.value)}>
            <option value="">Sin asignar (va al backlog)</option>
            {personas.map((p) => (
              <option key={p.wallet} value={p.wallet}>{p.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="t-fecha">Fecha límite</label>
          <input
            id="t-fecha"
            type="date"
            className="input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="t-prioridad">Prioridad</label>
          <select id="t-prioridad" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="alta">alta</option>
            <option value="media">media</option>
            <option value="baja">baja</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor="t-tamano">Tamaño</label>
          <select id="t-tamano" className="input" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="S">S · menos de un día</option>
            <option value="M">M · unos días</option>
            <option value="L">L · una semana o más</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="label" htmlFor="t-criterios">Cómo sabemos que está hecha</label>
          <textarea
            id="t-criterios"
            className="input min-h-[72px]"
            value={criterios}
            onChange={(e) => setCriterios(e.target.value)}
            placeholder="El criterio de aceptación, en una frase. Sin esto nadie puede evaluar la entrega."
            maxLength={2000}
          />
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" onClick={() => void crear()} disabled={guardando || titulo.trim().length < 3}>
          {guardando ? "Creando…" : "Crear tarea"}
        </button>
        {titulo.trim().length < 3 ? (
          <span className="text-xs text-faint">Escribe el título para poder crearla.</span>
        ) : null}
      </div>
    </div>
  );
}
