/**
 * WP31-C2 · puente al Ágora (base en memoria).
 *
 * Criterios del spec §11: C2-4 (permisos; solo Backlog sin responsable; criterio
 * público obligatorio; hitos por defecto del genoma; 4..10 hitos que suman 100 y
 * cada uno ≤ 25; montos que suman el presupuesto; `published_as_project_id`; segunda
 * vez → 409; evento `publicar`) y C2-4b (nada interno llega a `projects` si no se dejó
 * tal cual en el formulario; `campaign` = `campana`). Personas y clientes ficticios.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, type TeamActor } from "./roles";
import { instanteDb } from "./zona-horaria";
import { GENOME_DEFAULTS } from "./genome";
import { createAssignment, crearProyecto, getAssignment, seedTeam, TeamError } from "./team";
import { createClient } from "./clients";
import { emitirPorAprobacion } from "./gamificacion";
import { etiquetaTipo } from "./agora-labels";
import {
  CAMPANA_POR_DEFECTO,
  COPY_PUBLICAR,
  borradorPublicacion,
  copySumaHitos,
  hitosPorDefecto,
  montosDeHitos,
  motivoNoPublicable,
  publicarEnAgora,
  publicarSchema,
  validarHitos,
  type HitoPublicar,
  type PublicarInput,
} from "./agora-publicar";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const DAVID = pendingPrincipal("david");

const F: TeamActor = { wallet: JOHN, name: "John", role: "founder", isSupervisor: true };
const S: TeamActor = { wallet: VALE, name: "Vale", role: "core", isSupervisor: true };
const C: TeamActor = { wallet: DAVID, name: "David", role: "core", isSupervisor: false };
const X: TeamActor = { wallet: "GEXTERNOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", name: "Ext", role: "contributor", isSupervisor: false };

const AHORA = new Date("2026-10-01T15:00:00.000Z");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

const HITOS_5: HitoPublicar[] = [
  { nombre: "Anticipo", semana: "1", pct: 20 },
  { nombre: "Primera entrega", semana: "2", pct: 25 },
  { nombre: "Segunda entrega", semana: "4", pct: 25 },
  { nombre: "Entrega final", semana: "6", pct: 20 },
  { nombre: "Retención de calidad", semana: "8", pct: 10 },
];

function entrada(assignmentId: number, o: Partial<PublicarInput> = {}): PublicarInput {
  return {
    assignmentId,
    tipo: "comunidad",
    presupuestoUsd: 1000,
    semanas: 8,
    campana: "Zelena",
    titulo: "Panel de entregas abierto",
    resumen: "Un panel público que muestra las entregas aprobadas.",
    descripcionPublica: "Construir el panel con filtros por estado y por fecha.",
    criterioPublico: "El panel carga en menos de dos segundos y pasa las pruebas.",
    hitos: HITOS_5.map((h) => ({ ...h })),
    ...o,
  };
}

function contar(db: DB, tabla: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;
}

describe("hitos: reparto por defecto, validación y montos", () => {
  it("los hitos por defecto salen del genoma (AGORA_HITOS_DEFAULT) y son válidos", () => {
    const db = freshDb();
    expect(hitosPorDefecto(db)).toEqual(GENOME_DEFAULTS.AGORA_HITOS_DEFAULT);
    expect(validarHitos(hitosPorDefecto(db))).toEqual({ ok: true });
    // Copias: editar el resultado no toca el genoma en caché.
    hitosPorDefecto(db)[0].pct = 99;
    expect(hitosPorDefecto(db)[0].pct).toBe(GENOME_DEFAULTS.AGORA_HITOS_DEFAULT[0].pct);
  });

  it("de 4 a 10 hitos, enteros de 1 a 25 %, que suman 100", () => {
    const cuatro = [25, 25, 25, 25].map((pct, i) => ({ nombre: `H${i}`, semana: String(i + 1), pct }));
    expect(validarHitos(cuatro)).toEqual({ ok: true });
    expect(validarHitos(cuatro.slice(0, 3))).toEqual({ ok: false, error: COPY_PUBLICAR.hitosCantidad });
    const once = Array.from({ length: 11 }, (_, i) => ({ nombre: `H${i}`, semana: "1", pct: i < 10 ? 9 : 10 }));
    expect(validarHitos(once)).toEqual({ ok: false, error: COPY_PUBLICAR.hitosCantidad });
    // Uno pasa de 25.
    const grande = [40, 20, 20, 20].map((pct, i) => ({ nombre: `H${i}`, semana: "1", pct }));
    expect(validarHitos(grande)).toEqual({ ok: false, error: COPY_PUBLICAR.hitoPct });
    // No enteros o en cero.
    expect(validarHitos([25, 25, 25, 24.5].map((pct) => ({ nombre: "H", semana: "1", pct })))).toMatchObject({ ok: false });
    expect(validarHitos([25, 25, 25, 0].map((pct) => ({ nombre: "H", semana: "1", pct })))).toMatchObject({ ok: false });
    // No suman 100.
    const noventa = [25, 25, 20, 20].map((pct, i) => ({ nombre: `H${i}`, semana: "1", pct }));
    expect(validarHitos(noventa)).toEqual({ ok: false, error: copySumaHitos(90) });
    // Sin nombre.
    expect(validarHitos(cuatro.map((h, i) => (i === 0 ? { ...h, nombre: "  " } : h)))).toEqual({
      ok: false,
      error: COPY_PUBLICAR.hitoNombre,
    });
  });

  it("los montos suman exactamente el presupuesto; el último absorbe el redondeo", () => {
    expect(montosDeHitos(1000, [20, 25, 25, 20, 10])).toEqual([200, 250, 250, 200, 100]);
    const raros = montosDeHitos(997, [20, 25, 25, 20, 10]);
    expect(raros.reduce((t, m) => t + m, 0)).toBe(997);
    expect(raros).toEqual([199, 249, 249, 199, 101]);
    for (const p of [1, 7, 333, 12_345, 999_999]) {
      const m = montosDeHitos(p, [13, 13, 13, 13, 12, 12, 12, 12]);
      expect(m.reduce((t, x) => t + x, 0), String(p)).toBe(p);
      expect(m.every((x) => x >= 0)).toBe(true);
    }
    expect(montosDeHitos(100, [])).toEqual([]);
  });

  it("el esquema pone 'Zelena' como campaña por defecto y exige el criterio público", () => {
    const sinCampana = { ...entrada(1) } as Record<string, unknown>;
    delete sinCampana.campana;
    const ok = publicarSchema.safeParse(sinCampana);
    expect(ok.success && ok.data.campana).toBe(CAMPANA_POR_DEFECTO);
    expect(publicarSchema.safeParse({ ...entrada(1), criterioPublico: "" }).success).toBe(false);
    expect(publicarSchema.safeParse({ ...entrada(1), presupuestoUsd: 0 }).success).toBe(false);
    expect(publicarSchema.safeParse({ ...entrada(1), presupuestoUsd: 1_000_001 }).success).toBe(false);
    expect(publicarSchema.safeParse({ ...entrada(1), semanas: 53 }).success).toBe(false);
    expect(publicarSchema.safeParse({ ...entrada(1), resumen: "corto" }).success).toBe(false);
    const malSuma = publicarSchema.safeParse({ ...entrada(1), hitos: HITOS_5.map((h, i) => (i === 4 ? { ...h, pct: 5 } : h)) });
    expect(malSuma.success).toBe(false);
    if (!malSuma.success) expect(malSuma.error.issues[0].message).toBe(copySumaHitos(95));
  });
});

describe("C2-4 · publicarEnAgora", () => {
  let db: DB;
  let id: number;
  beforeEach(() => {
    db = freshDb();
    id = createAssignment(db, { title: "Panel de entregas", status: "Backlog" });
  });

  it("founder o supervisor: crea el proyecto Open con sus hitos, enlaza la pieza y deja el evento", () => {
    const { projectId } = publicarEnAgora(db, S, entrada(id), AHORA);
    const p = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<string, unknown>;
    expect(p).toMatchObject({
      campaign: "Zelena",
      title: "Panel de entregas abierto",
      budget_usd: 1000,
      weeks: 8,
      state: "Open",
      supervisor_wallet: VALE,
      assignee_wallet: null,
      summary: "Un panel público que muestra las entregas aprobadas.",
      description: "Construir el panel con filtros por estado y por fecha.",
      acceptance: "El panel carga en menos de dos segundos y pasa las pruebas.",
    });
    expect(etiquetaTipo(String(p.type))).toBe("Comunidad");

    const hitos = db
      .prepare(`SELECT ord, code, name, week, pct, amount_usd, approved FROM milestones WHERE project_id = ? ORDER BY ord`)
      .all(projectId) as Array<{ ord: number; code: string; name: string; week: string; pct: number; amount_usd: number; approved: number }>;
    expect(hitos.map((h) => h.code)).toEqual(["H1", "H2", "H3", "H4", "H5"]);
    expect(hitos.map((h) => h.name)).toEqual(HITOS_5.map((h) => h.nombre));
    expect(hitos.map((h) => h.week)).toEqual(HITOS_5.map((h) => h.semana));
    expect(hitos.reduce((t, h) => t + h.amount_usd, 0)).toBe(1000);
    expect(hitos.every((h) => h.approved === 0)).toBe(true);

    const row = getAssignment(db, id)!;
    expect(row.published_as_project_id).toBe(projectId);
    expect(row.status).toBe("Backlog");
    expect(row.owner_wallet).toBeNull();

    const ev = db.prepare(`SELECT * FROM assignment_events WHERE assignment_id = ? AND action = 'publicar'`).all(id) as Array<
      Record<string, unknown>
    >;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      from_status: "Backlog",
      to_status: "Backlog",
      actor_wallet: VALE,
      created_at: instanteDb(AHORA),
      day: "2026-10-01",
    });
  });

  it("'cliente' se guarda con la etiqueta Cliente (el valor interno vive en agora-labels.ts)", () => {
    const { projectId } = publicarEnAgora(db, F, entrada(id, { tipo: "cliente" }), AHORA);
    const p = db.prepare(`SELECT type FROM projects WHERE id = ?`).get(projectId) as { type: string };
    expect(etiquetaTipo(p.type)).toBe("Cliente");
  });

  it("solo founder o supervisor: un core o un contributor reciben 403 y no queda nada", () => {
    for (const a of [C, X]) {
      expect(() => publicarEnAgora(db, a, entrada(id), AHORA)).toThrow(TeamError);
      try {
        publicarEnAgora(db, a, entrada(id), AHORA);
      } catch (e) {
        expect((e as TeamError).status).toBe(403);
        expect((e as TeamError).message).toBe(COPY_PUBLICAR.sinPermiso);
      }
    }
    expect(contar(db, "projects")).toBe(0);
    expect(contar(db, "milestones")).toBe(0);
  });

  it("solo Backlog sin responsable: con dueño o fuera de Backlog → 409", () => {
    const conDueno = createAssignment(db, { title: "Con dueño", ownerWallet: DAVID, status: "Asignada" });
    const sinDuenoEnCurso = createAssignment(db, { title: "Sin dueño en curso", status: "En curso" });
    for (const pieza of [conDueno, sinDuenoEnCurso]) {
      try {
        publicarEnAgora(db, F, entrada(pieza), AHORA);
        throw new Error("debía fallar");
      } catch (e) {
        expect((e as TeamError).status).toBe(409);
        expect((e as TeamError).message).toBe(COPY_PUBLICAR.soloSinResponsable);
      }
    }
    expect(contar(db, "projects")).toBe(0);
  });

  it("una segunda vez → 409 «ya está publicada», sin un segundo proyecto", () => {
    publicarEnAgora(db, F, entrada(id), AHORA);
    try {
      publicarEnAgora(db, S, entrada(id), AHORA);
      throw new Error("debía fallar");
    } catch (e) {
      expect((e as TeamError).status).toBe(409);
      expect((e as TeamError).message).toBe(COPY_PUBLICAR.yaPublicada);
    }
    expect(contar(db, "projects")).toBe(1);
    expect(motivoNoPublicable(getAssignment(db, id)!)).toBe(COPY_PUBLICAR.yaPublicada);
  });

  it("criterio público obligatorio y hitos inválidos → 400 sin escribir nada", () => {
    const casos: Array<Partial<PublicarInput>> = [
      { criterioPublico: "" },
      { criterioPublico: "corto" },
      { hitos: HITOS_5.slice(0, 3) },
      { hitos: HITOS_5.map((h, i) => (i === 0 ? { ...h, pct: 30 } : i === 4 ? { ...h, pct: 0 } : h)) },
      { hitos: HITOS_5.map((h, i) => (i === 4 ? { ...h, pct: 15 } : h)) },
    ];
    for (const c of casos) {
      try {
        publicarEnAgora(db, F, entrada(id, c), AHORA);
        throw new Error(`debía fallar: ${JSON.stringify(c).slice(0, 60)}`);
      } catch (e) {
        expect((e as TeamError).status, JSON.stringify(c).slice(0, 60)).toBe(400);
      }
    }
    expect(contar(db, "projects")).toBe(0);
    expect(getAssignment(db, id)!.published_as_project_id).toBeNull();
  });

  it("un presupuesto que no alcanza para un pago en cada hito se rechaza", () => {
    try {
      publicarEnAgora(db, F, entrada(id, { presupuestoUsd: 3 }), AHORA);
      throw new Error("debía fallar");
    } catch (e) {
      expect((e as TeamError).status).toBe(400);
      expect((e as TeamError).message).toBe(COPY_PUBLICAR.presupuestoCorto);
    }
  });

  it("una pieza que no existe → 404", () => {
    try {
      publicarEnAgora(db, F, entrada(9999), AHORA);
      throw new Error("debía fallar");
    } catch (e) {
      expect((e as TeamError).status).toBe(404);
    }
  });

  it("una pieza de un proyecto de cliente que el supervisor no ve no existe para él (404)", () => {
    const cliente = createClient(db, { name: "Cliente Demo" });
    const ini = crearProyecto(db, F, { name: "Proyecto Cliente Demo", clientId: cliente });
    const pieza = createAssignment(db, { title: "Pieza del cliente", initiativeId: ini.id, status: "Backlog" });
    try {
      publicarEnAgora(db, S, entrada(pieza), AHORA);
      throw new Error("debía fallar");
    } catch (e) {
      expect((e as TeamError).status).toBe(404);
    }
    // El founder sí la ve y la publica.
    expect(publicarEnAgora(db, F, entrada(pieza, { tipo: "cliente" }), AHORA).projectId).toBeGreaterThan(0);
  });

  it("desde que se publica, la pieza se paga por sus hitos: la aprobación interna no emite", () => {
    publicarEnAgora(db, F, entrada(id), AHORA);
    const em = emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DAVID, aprobadorWallet: VALE, size: "M", aTiempo: true });
    expect(em).toMatchObject({ emitido: false, motivo: "publicada_en_agora", puntos: 0 });
    expect(contar(db, "points_ledger")).toBe(0);
    expect(contar(db, "reputation_events")).toBe(0);
  });
});

describe("C2-4b · nada interno se copia sin confirmación", () => {
  const NOTAS = "Notas internas: precio acordado y contacto del cliente";
  const DESCRIPCION_INTERNA = "Detalle interno: credenciales en el gestor y deuda técnica";
  const NOMBRE_INICIATIVA = "Iniciativa Interna Demo";

  function preparar(db: DB): number {
    const ini = crearProyecto(db, F, { name: NOMBRE_INICIATIVA, notes: NOTAS });
    return createAssignment(db, {
      title: "Panel de entregas",
      description: DESCRIPCION_INTERNA,
      acceptanceCriteria: "Pasa la revisión interna con el equipo",
      initiativeId: ini.id,
      status: "Backlog",
    });
  }

  it("el borrador prellena desde la TAREA y la campaña con 'Zelena', nunca con la iniciativa ni sus notas", () => {
    const db = freshDb();
    const id = preparar(db);
    const b = borradorPublicacion(db, getAssignment(db, id)!);
    expect(b.campana).toBe(CAMPANA_POR_DEFECTO);
    expect(b.titulo).toBe("Panel de entregas");
    expect(b.descripcionPublica).toBe(DESCRIPCION_INTERNA);
    expect(b.criterioPublico).toBe("Pasa la revisión interna con el equipo");
    expect(b.resumen).toBe("");
    expect(b.presupuestoUsd).toBeNull();
    expect(b.tipo).toBe("comunidad");
    expect(b.hitos).toEqual(hitosPorDefecto(db));
    expect(JSON.stringify(b)).not.toContain(NOTAS);
    expect(JSON.stringify(b)).not.toContain(NOMBRE_INICIATIVA);
  });

  it("si el formulario cambió los textos, projects no lleva notas, descripción interna ni nombre de la iniciativa", () => {
    const db = freshDb();
    const id = preparar(db);
    const { projectId } = publicarEnAgora(db, F, entrada(id, { campana: "Comunidad abierta" }), AHORA);
    const p = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<string, unknown>;
    const volcado = JSON.stringify(p);
    expect(p.campaign).toBe("Comunidad abierta");
    expect(volcado).not.toContain(NOTAS);
    expect(volcado).not.toContain(DESCRIPCION_INTERNA);
    expect(volcado).not.toContain(NOMBRE_INICIATIVA);
    const hitos = JSON.stringify(db.prepare(`SELECT * FROM milestones WHERE project_id = ?`).all(projectId));
    expect(hitos).not.toContain(NOMBRE_INICIATIVA);
  });

  it("lo que se deja tal cual en el formulario es lo único que viaja (y es decisión de quien publica)", () => {
    const db = freshDb();
    const id = preparar(db);
    const b = borradorPublicacion(db, getAssignment(db, id)!);
    const { projectId } = publicarEnAgora(
      db,
      F,
      entrada(id, {
        campana: b.campana,
        titulo: b.titulo,
        descripcionPublica: b.descripcionPublica,
        criterioPublico: b.criterioPublico,
      }),
      AHORA
    );
    const p = db.prepare(`SELECT campaign, description FROM projects WHERE id = ?`).get(projectId) as {
      campaign: string;
      description: string;
    };
    expect(p.campaign).toBe("Zelena");
    expect(p.description).toBe(DESCRIPCION_INTERNA);
    expect(JSON.stringify(p)).not.toContain(NOMBRE_INICIATIVA);
  });

  it("una pieza de un proyecto de cliente se propone 'para un cliente'", () => {
    const db = freshDb();
    const cliente = createClient(db, { name: "Cliente Demo" });
    const ini = crearProyecto(db, F, { name: "Otro Proyecto Demo", clientId: cliente });
    const id = createAssignment(db, { title: "Pieza", initiativeId: ini.id, status: "Backlog" });
    expect(borradorPublicacion(db, getAssignment(db, id)!).tipo).toBe("cliente");
  });
});

describe("estático: el puente no lee lo interno ni escribe el valor crudo del tipo", () => {
  const fuente = fs.readFileSync(path.join(process.cwd(), "src", "lib", "agora-publicar.ts"), "utf8");
  it("no lee `notes` de la iniciativa ni escribe los literales del tipo de proyecto", () => {
    expect(fuente).not.toMatch(/SELECT[^`]*\bnotes\b/i);
    expect(fuente).not.toMatch(/["'`](SAS|DAO)["'`]/);
    expect(fuente).toContain("tipoDesdeEtiqueta(");
  });
  it("sin await dentro de la transacción ni dependencias de servidor", () => {
    expect(fuente).not.toMatch(/\bawait\b/);
    expect(fuente).not.toMatch(/^import (?!type )[^;]*from "\.\/db(\.ts)?";/m);
    expect(fuente).not.toMatch(/from "node:|from "\.\/crypto|from "\.\/session/);
    expect(fuente).toMatch(/import type \{ DB \} from "\.\/db"/);
  });
});
