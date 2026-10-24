/**
 * Prueba de caracterización · feature `proyectos-y-membresias`
 * (docs/features/proyectos-y-membresias.md).
 *
 * Recorre el flujo principal contra una base SQLite temporal (en memoria, mismo patrón
 * que src/lib/team-proyectos.test.ts) y fija el comportamiento ACTUAL, sin cambiarlo:
 *   crear proyecto (POST /api/equipo/proyectos → `crearProyecto`)
 *   → sumar personas con rol (POST /api/equipo/miembros → `agregarMiembro`)
 *   → la persona externa entra a /equipo con alcance `proyectos` (`equipoActor`)
 *   → permisos por proyecto (`permisosDe`) y lo que puede conceder cada rol
 *   → tablero `/equipo/proyectos/[slug]` (`tableroDeProyecto` + filtros)
 *   → editar el proyecto (PATCH) y quitar un rol (`quitarMiembro`).
 * Más la regla de proyectos de cliente (spec WP31 §4.A.12).
 *
 * Si una aserción "COMPORTAMIENTO ACTUAL" deja de cumplirse porque se corrigió su
 * hallazgo, se actualiza la aserción y la ficha. Personas: slugs del roster y wallets
 * ficticias de prueba.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "../db";
import { clearGenomeCache } from "../genome";
import { pendingPrincipal, rolesQuePuedeConceder, type TeamActor } from "../roles";
import { equipoActor, type EquipoActor } from "../authz";
import { addMember, createClient } from "../clients";
import { instanteDb } from "../zona-horaria";
import {
  TeamError,
  agregarMiembro,
  aplicarAccionAsignacion,
  candidatosParaProyecto,
  createAssignmentAs,
  crearProyecto,
  crearProyectoSchema,
  editarAsignacion,
  editarProyecto,
  getProyectoPorSlug,
  membresiasDe,
  miembroSchema,
  miembrosDeProyecto,
  parseFiltrosTablero,
  permisosDe,
  proyectosVisibles,
  puedeVerProyecto,
  quitarMiembro,
  rolesEnProyecto,
  seedTeam,
  tableroDeProyecto,
} from "../team";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const FAUSTO = pendingPrincipal("fausto");
const DAVID = pendingPrincipal("david");
const EXTERNA = "GEXTERNAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SIN_ACUERDO = "GSINACUERDOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VENDEDORA = "GVENDEDORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const FOUNDER: TeamActor = { wallet: JOHN, name: "John", role: "founder", isSupervisor: true };
const SUPERVISORA: TeamActor = { wallet: VALE, name: "Vale", role: "core", isSupervisor: true };
const CORE: TeamActor = { wallet: FAUSTO, name: "Fausto", role: "core", isSupervisor: false };
const ESTRUCTURA: TeamActor = { wallet: DAVID, name: "David", role: "core", isSupervisor: false };

const AHORA = new Date("2026-10-08T15:00:00.000Z"); // jueves 10:00 en Bogotá

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  clearGenomeCache(db);
  return db;
}

function contributor(db: DB, wallet: string, cla: number): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, ?, 'contributor', 'active', 0, ?)`
  ).run(wallet, wallet.slice(1, 9), cla);
}

function fallo(fn: () => unknown): { status: number; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof TeamError) return { status: e.status, message: e.message };
    throw e;
  }
}

function puerta(db: DB, wallet: string): EquipoActor {
  const a = equipoActor({ wallet }, db);
  if (!a) throw new Error(`sin acceso a /equipo: ${wallet}`);
  return a;
}

function talento(db: DB): Array<{ action: string; target_wallet: string | null; detail: string | null }> {
  return db.prepare(`SELECT action, target_wallet, detail FROM talent_events ORDER BY id`).all() as Array<{
    action: string;
    target_wallet: string | null;
    detail: string | null;
  }>;
}

describe("caracterización · proyectos y membresías (flujo principal)", () => {
  let db: DB;
  let proyecto: number;

  beforeEach(() => {
    db = freshDb();
    contributor(db, EXTERNA, 1);
    contributor(db, SIN_ACUERDO, 0);
    contributor(db, VENDEDORA, 1);
    // Lo que manda TeamProjectForm a POST /api/equipo/proyectos, validado por el mismo esquema.
    proyecto = crearProyecto(db, SUPERVISORA, crearProyectoSchema.parse({ name: "Bodega Norte", notes: "Piloto" })).id;
  });

  it("crear: founder o supervisión; slug inmutable derivado del nombre; deja huella en talent_events", () => {
    const p = getProyectoPorSlug(db, "bodega-norte")!;
    expect(p).toMatchObject({ id: proyecto, name: "Bodega Norte", horizon: "Ahora", client_id: null, notes: "Piloto" });
    expect(talento(db)).toEqual([
      { action: "proyecto_crear", target_wallet: null, detail: JSON.stringify({ slug: "bodega-norte", conCliente: false }) },
    ]);
    expect(fallo(() => crearProyecto(db, SUPERVISORA, { name: "Bodega  Norte" }))).toEqual({
      status: 409,
      message: "Ya existe un proyecto con ese nombre.",
    });
    expect(fallo(() => crearProyecto(db, CORE, { name: "Otro" }))?.status).toBe(403);
    // Editar el nombre no cambia el slug (es la URL del tablero).
    editarProyecto(db, SUPERVISORA, { initiativeId: proyecto, name: "Bodega Norte II" });
    expect(getProyectoPorSlug(db, "bodega-norte")!.name).toBe("Bodega Norte II");
  });

  it("sumar personas: vínculo por defecto, acuerdo obligatorio, nunca sobre sí, sin duplicados", () => {
    // Lo que manda TeamMembersPanel a POST /api/equipo/miembros.
    const body = miembroSchema.parse({ action: "agregar", initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" });
    agregarMiembro(db, SUPERVISORA, { initiativeId: body.initiativeId, wallet: body.wallet, rol: body.rol, vinculo: body.vinculo });
    expect(miembrosDeProyecto(db, proyecto).map((m) => [m.wallet, m.rol_proyecto, m.vinculo, m.added_by])).toEqual([
      [EXTERNA, "ejecuta", "externo", VALE],
    ]);
    expect(talento(db).at(-1)).toEqual({
      action: "miembro_alta",
      target_wallet: EXTERNA,
      detail: JSON.stringify({ rol: "ejecuta", vinculo: "externo" }),
    });

    expect(fallo(() => agregarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: SIN_ACUERDO, rol: "ejecuta" }))).toEqual({
      status: 409,
      message: "Primero tiene que firmar el acuerdo de contribución.",
    });
    expect(fallo(() => agregarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" }))?.status).toBe(409);
    expect(fallo(() => agregarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: VALE, rol: "revisa" }))).toEqual({
      status: 403,
      message: "Tus propios roles los cambia otra persona.",
    });
    expect(fallo(() => agregarMiembro(db, CORE, { initiativeId: proyecto, wallet: EXTERNA, rol: "vende" }))?.status).toBe(403);
  });

  it("la persona externa entra a /equipo con alcance 'proyectos' y solo ve y actúa en su proyecto", () => {
    expect(equipoActor({ wallet: EXTERNA }, db)).toBeNull(); // sin membresía, no entra
    agregarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" });
    const ext = puerta(db, EXTERNA);
    expect(ext).toMatchObject({ alcance: "proyectos", proyectos: [proyecto], role: "contributor" });
    expect(proyectosVisibles(db, ext).map((p) => p.id)).toEqual([proyecto]);
    expect(permisosDe(db, ext, proyecto)).toEqual({ ver: true, crear: true, planificar: false, revisar: false, tomar: true });
    expect(permisosDe(db, ext, null)).toEqual({ ver: false, crear: false, planificar: false, revisar: false, tomar: false });
    expect(membresiasDe(db, EXTERNA)).toEqual([{ initiativeId: proyecto, roles: ["ejecuta"] }]);

    // Un proyecto interno sin membresía no existe para ella (la página responde 404).
    const otro = crearProyecto(db, FOUNDER, { name: "Interno" }).id;
    expect(puedeVerProyecto(db, ext, otro)).toBe(false);
    // Para un core del equipo interno, sí (sin roles: ver, crear y tomar).
    expect(puedeVerProyecto(db, puerta(db, FAUSTO), otro)).toBe(true);
    expect(permisosDe(db, CORE, otro)).toEqual({ ver: true, crear: true, planificar: false, revisar: false, tomar: true });
  });

  it("quien estructura planifica su proyecto: concede 'ejecuta'/'vende', no 'revisa'; no cambia el cliente", () => {
    agregarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: DAVID, rol: "estructura" });
    expect(rolesEnProyecto(db, DAVID, proyecto)).toEqual(["estructura"]);
    expect(rolesQuePuedeConceder(ESTRUCTURA, ["estructura"])).toEqual(["ejecuta", "vende"]);
    expect(permisosDe(db, ESTRUCTURA, proyecto)).toEqual({ ver: true, crear: true, planificar: true, revisar: true, tomar: true });

    agregarMiembro(db, ESTRUCTURA, { initiativeId: proyecto, wallet: VENDEDORA, rol: "vende" });
    expect(fallo(() => agregarMiembro(db, ESTRUCTURA, { initiativeId: proyecto, wallet: EXTERNA, rol: "revisa" }))).toEqual({
      status: 403,
      message: "Puedes sumar a quien ejecuta o vende. Para revisar o estructurar, pídeselo a un supervisor.",
    });
    const editado = editarProyecto(db, ESTRUCTURA, { initiativeId: proyecto, notes: "Piloto con conteo cíclico" });
    expect(editado.notes).toBe("Piloto con conteo cíclico");
    const cliente = createClient(db, { name: "Cliente de prueba" });
    expect(fallo(() => editarProyecto(db, ESTRUCTURA, { initiativeId: proyecto, clientId: cliente }))?.status).toBe(403);

    // Candidatos para los selects: estructura ve al equipo interno y a los miembros; supervisión, además a externos con acuerdo.
    const deEstructura = candidatosParaProyecto(db, ESTRUCTURA, proyecto).map((c) => c.wallet);
    const deSupervision = candidatosParaProyecto(db, SUPERVISORA, proyecto).map((c) => c.wallet);
    expect(deEstructura).toContain(VENDEDORA);
    expect(deEstructura).not.toContain(EXTERNA);
    expect(deSupervision).toContain(EXTERNA);
    expect(deSupervision).not.toContain(SIN_ACUERDO);
    expect(candidatosParaProyecto(db, CORE, proyecto)).toEqual([]);
  });

  it("tablero: columnas por estado, filtros por query string y 'Hecha' de los últimos 14 días", () => {
    agregarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" });
    const libre = createAssignmentAs(db, SUPERVISORA, { title: "Etiquetar estantes", initiativeId: proyecto }, AHORA);
    const suya = createAssignmentAs(
      db,
      SUPERVISORA,
      { title: "Contar pasillo 3", initiativeId: proyecto, ownerWallet: EXTERNA, priority: "High", dueDate: "2026-10-06" },
      AHORA
    );
    const vieja = createAssignmentAs(db, SUPERVISORA, { title: "Pieza vieja", initiativeId: proyecto, ownerWallet: FAUSTO }, AHORA);
    db.prepare(`UPDATE assignments SET status = 'Hecha', closed_at = ? WHERE id = ?`).run(
      instanteDb(new Date(AHORA.getTime() - 20 * 86_400_000)),
      vieja
    );

    const t = tableroDeProyecto(db, proyecto, {}, AHORA);
    expect(t.total).toBe(2);
    expect(t.columnas.Backlog.map((a) => a.id)).toEqual([libre]);
    expect(t.columnas.Asignada.map((a) => a.id)).toEqual([suya]);
    expect(t.columnas.Hecha).toEqual([]); // cerrada hace 20 días: fuera de la ventana por defecto
    expect(tableroDeProyecto(db, proyecto, { hechasDias: 30 }, AHORA).columnas.Hecha.map((a) => a.id)).toEqual([vieja]);

    // Filtros desde la query string: lo inválido se ignora.
    const f = parseFiltrosTablero({ responsable: "sin", prioridad: "Altísima", vence: "vencidas", hechas: "0", q: "  estantes " });
    expect(f).toEqual({ owner: "sin", vence: "vencidas", q: "estantes" });
    expect(tableroDeProyecto(db, proyecto, { owner: "sin" }, AHORA).total).toBe(1);
    expect(tableroDeProyecto(db, proyecto, { vence: "vencidas" }, AHORA).columnas.Asignada.map((a) => a.id)).toEqual([suya]);
    expect(tableroDeProyecto(db, proyecto, { q: "PASILLO" }, AHORA).total).toBe(1);

    // La externa toma lo libre; quitarle el último rol con trabajo abierto → 409.
    aplicarAccionAsignacion(db, { assignmentId: libre, action: "asignar", actor: puerta(db, EXTERNA), now: AHORA });
    expect(fallo(() => quitarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" }))).toEqual({
      status: 409,
      message: "Primero reasigna sus entregas abiertas en este proyecto.",
    });
    editarAsignacion(db, SUPERVISORA, { assignmentId: libre, ownerWallet: FAUSTO }, AHORA);
    editarAsignacion(db, SUPERVISORA, { assignmentId: suya, ownerWallet: FAUSTO }, AHORA);
    quitarMiembro(db, SUPERVISORA, { initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" });
    expect(miembrosDeProyecto(db, proyecto)).toEqual([]);
    expect(talento(db).at(-1)).toEqual({ action: "miembro_baja", target_wallet: EXTERNA, detail: JSON.stringify({ rol: "ejecuta" }) });
    expect(equipoActor({ wallet: EXTERNA }, db)).toBeNull(); // sin membresías, ya no entra a /equipo
  });

  it("proyecto de cliente: lo ven el founder y quien participa (client_members o project_members)", () => {
    const cliente = createClient(db, { name: "Cliente de prueba" });
    const deCliente = crearProyecto(db, FOUNDER, { name: "Proyecto de cliente", clientId: cliente }).id;
    expect(puedeVerProyecto(db, puerta(db, JOHN), deCliente)).toBe(true);
    expect(puedeVerProyecto(db, puerta(db, FAUSTO), deCliente)).toBe(false);
    expect(puedeVerProyecto(db, puerta(db, VALE), deCliente)).toBe(false); // supervisar no basta
    expect(permisosDe(db, SUPERVISORA, deCliente)).toEqual({ ver: false, crear: false, planificar: false, revisar: false, tomar: false });
    addMember(db, cliente, FAUSTO, "colaborador");
    expect(puedeVerProyecto(db, puerta(db, FAUSTO), deCliente)).toBe(true);
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): una pieza con cliente dentro de un proyecto interno la ve todo el equipo interno", () => {
    const cliente = createClient(db, { name: "Cliente de prueba" });
    // El founder etiqueta una pieza del proyecto interno con un cliente (permitido por `clienteDeLaPieza`).
    const pieza = createAssignmentAs(db, FOUNDER, { title: "Pieza etiquetada", initiativeId: proyecto, clientId: cliente }, AHORA);
    // Un core que no participa en el cliente la ve: manda la regla del proyecto, no la del cliente.
    const deCore = tableroDeProyecto(db, proyecto, {}, AHORA).columnas.Backlog.map((a) => a.id);
    expect(puedeVerProyecto(db, puerta(db, FAUSTO), proyecto)).toBe(true);
    expect(deCore).toContain(pieza);
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): supervisión asocia un proyecto a un cliente donde no participa y deja de verlo", () => {
    const cliente = createClient(db, { name: "Cliente ajeno" });
    // `crearProyecto` solo valida que el cliente exista (no `client_members`).
    const p = crearProyecto(db, SUPERVISORA, { name: "Proyecto asociado", clientId: cliente });
    expect(p.client_id).toBe(cliente);
    expect(puedeVerProyecto(db, puerta(db, VALE), p.id)).toBe(false);
    // Y `editarProyecto` deja mover un proyecto interno con trabajo a ese cliente.
    editarProyecto(db, SUPERVISORA, { initiativeId: proyecto, clientId: cliente });
    expect(puedeVerProyecto(db, puerta(db, FAUSTO), proyecto)).toBe(false);
  });
});
