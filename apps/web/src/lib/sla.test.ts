/**
 * SLA en horas hábiles (WP31 §5.B.2): criterios B6, B7 y B8.
 *
 * Los tests corren con TZ=UTC (vitest.config.ts) y el horario hábil es el de Bogotá
 * (UTC−5, sin horario de verano): lunes 17:00 en Bogotá = lunes 22:00 UTC. Fechas de
 * referencia: lunes 2026-10-05, martes 06, miércoles 07, jueves 08, viernes 02 y 09,
 * sábado 03, domingo 04.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { GENOME_DEFAULTS, getActiveGenome } from "./genome";
import { instanteDb, instanteLocal } from "./zona-horaria";
import {
  PRIORIDAD_CORTA,
  SLA_LABEL,
  aprobadaATiempo,
  diasHabilesAntes,
  esHorarioHabil,
  evaluarSla,
  finDeDia,
  formatoVence,
  horasHabilesEntre,
  horasPorDiaHabil,
  inicioReloj,
  momentoAprobacion,
  momentoEntrega,
  parseInstanteDb,
  respondida,
  slaConfigDesdeGenoma,
  sumarHorasHabiles,
  venceEntrega,
  venceRespuesta,
  venceRevision,
  type EventoSla,
  type PiezaSla,
} from "./sla";
import { cargarPiezaSla, cargarPiezasAbiertas, slaConfig, slaDeAsignaciones } from "./sla-db";

const TZ = "America/Bogota";
const c = slaConfigDesdeGenoma(GENOME_DEFAULTS);

/** Instante de Bogotá: `bog("2026-10-05", "17:00")` = lunes 17:00 local. */
function bog(dia: string, hhmm: string): Date {
  return instanteLocal(dia, hhmm, TZ);
}

const LUN = "2026-10-05";
const MAR = "2026-10-06";
const MIE = "2026-10-07";
const JUE = "2026-10-08";
const VIE = "2026-10-02";
const SAB = "2026-10-03";

function ev(action: string, from: string, to: string, d: Date, conZ = false): EventoSla {
  return { action, from_status: from, to_status: to, created_at: conZ ? d.toISOString() : instanteDb(d) };
}

function pieza(p: Partial<PiezaSla>): PiezaSla {
  return {
    id: 1,
    priority: "Normal",
    status: "Backlog",
    due_date: null,
    created_at: instanteDb(bog(LUN, "08:00")),
    blocked_at: null,
    eventos: [],
    ...p,
  };
}

describe("configuración desde el genoma", () => {
  it("mapea las claves SLA_* según la tabla de §5.B.2 (1 día hábil = 10 h)", () => {
    expect(horasPorDiaHabil(c)).toBe(10);
    expect(c.tz).toBe(TZ);
    expect(c.diasHabiles).toEqual([1, 2, 3, 4, 5]);
    expect(c.respuestaH).toEqual({ Urgent: 2, High: 10, Normal: 20, Low: 50 });
    expect(c.entregaH).toEqual({ Urgent: 8, High: 30, Normal: 100, Low: null });
    expect(c.revisionH).toEqual({ Urgent: 4, High: 10, Normal: 10, Low: 10 });
    expect(c.bloqueoEscalaH).toBe(20);
    expect(c.bloqueoFounderH).toBe(50);
    expect(c.avisoPct).toBe(25);
    expect(c.avisoMaxH).toBe(10);
  });

  it("los rótulos hablan de la entrega", () => {
    expect(Object.values(SLA_LABEL)).toEqual(["A tiempo", "Por vencer", "Vencida", "Sin plazo"]);
    expect(PRIORIDAD_CORTA).toEqual({ Urgent: "P1", High: "P2", Normal: "P3", Low: "P4" });
  });
});

describe("horas hábiles (criterio B6)", () => {
  it("lun 17:00 + 2 h → mar 09:00", () => {
    expect(sumarHorasHabiles(bog(LUN, "17:00"), 2, c).toISOString()).toBe(bog(MAR, "09:00").toISOString());
  });

  it("vie 17:00 + 2 h → lun 09:00", () => {
    expect(sumarHorasHabiles(bog(VIE, "17:00"), 2, c).toISOString()).toBe(bog(LUN, "09:00").toISOString());
  });

  it("sáb 10:00 + 1 h → lun 09:00", () => {
    expect(sumarHorasHabiles(bog(SAB, "10:00"), 1, c).toISOString()).toBe(bog(LUN, "09:00").toISOString());
  });

  it("antes de abrir arranca a la hora de inicio y al cierre exacto devuelve el cierre", () => {
    expect(sumarHorasHabiles(bog(LUN, "06:00"), 1, c).toISOString()).toBe(bog(LUN, "09:00").toISOString());
    expect(sumarHorasHabiles(bog(LUN, "08:00"), 10, c).toISOString()).toBe(bog(LUN, "18:00").toISOString());
    expect(sumarHorasHabiles(bog(LUN, "08:00"), 30, c).toISOString()).toBe(bog(MIE, "18:00").toISOString());
    expect(sumarHorasHabiles(bog(LUN, "10:00"), 0, c).toISOString()).toBe(bog(LUN, "10:00").toISOString());
  });

  it("frontera del día: 23:30 de Bogotá (04:30 UTC del día siguiente) cuenta como ese día local", () => {
    const tarde = bog(LUN, "23:30");
    expect(tarde.toISOString()).toBe("2026-10-06T04:30:00.000Z");
    expect(esHorarioHabil(tarde, c)).toBe(false);
    expect(sumarHorasHabiles(tarde, 1, c).toISOString()).toBe(bog(MAR, "09:00").toISOString());
  });

  it("horasHabilesEntre es la inversa de sumarHorasHabiles", () => {
    const casos: Array<[Date, number]> = [
      [bog(LUN, "17:00"), 2],
      [bog(VIE, "17:00"), 2],
      [bog(SAB, "10:00"), 1],
      [bog(LUN, "09:15"), 37.5],
      [bog(JUE, "12:00"), 100],
      [bog(MAR, "08:00"), 0.25],
    ];
    for (const [desde, h] of casos) {
      expect(horasHabilesEntre(desde, sumarHorasHabiles(desde, h, c), c)).toBeCloseTo(h, 9);
    }
    expect(horasHabilesEntre(bog(LUN, "17:00"), bog(MAR, "09:00"), c)).toBe(2);
    expect(horasHabilesEntre(bog(VIE, "18:00"), bog(LUN, "08:00"), c)).toBe(0); // el fin de semana no cuenta
    // Al revés o igual: 0.
    expect(horasHabilesEntre(bog(MAR, "09:00"), bog(LUN, "17:00"), c)).toBe(0);
    expect(horasHabilesEntre(bog(MAR, "09:00"), bog(MAR, "09:00"), c)).toBe(0);
  });

  it("parseInstanteDb lee el formato de SQLite (sin Z) como UTC y el ISO tal cual", () => {
    const lunes17 = bog(LUN, "17:00");
    expect(parseInstanteDb("2026-10-05 22:00:00").getTime()).toBe(lunes17.getTime());
    expect(parseInstanteDb("2026-10-05T22:00:00.000Z").getTime()).toBe(lunes17.getTime());
    // Con o sin Z, el mismo plazo.
    const sinZ = sumarHorasHabiles(parseInstanteDb("2026-10-05 22:00:00"), 2, c);
    const conZ = sumarHorasHabiles(parseInstanteDb("2026-10-05T22:00:00Z"), 2, c);
    expect(sinZ.getTime()).toBe(conZ.getTime());
  });

  it("esHorarioHabil: de lunes a viernes, [08:00, 18:00) local", () => {
    expect(esHorarioHabil(bog(LUN, "08:00"), c)).toBe(true);
    expect(esHorarioHabil(bog(LUN, "17:59"), c)).toBe(true);
    expect(esHorarioHabil(bog(LUN, "18:00"), c)).toBe(false);
    expect(esHorarioHabil(bog(LUN, "07:59"), c)).toBe(false);
    expect(esHorarioHabil(bog(SAB, "10:00"), c)).toBe(false);
  });

  it("diasHabilesAntes salta el fin de semana y finDeDia es el cierre local", () => {
    expect(diasHabilesAntes(MAR, 2, c)).toBe(VIE);
    expect(diasHabilesAntes(LUN, 1, c)).toBe(VIE);
    expect(diasHabilesAntes(JUE, 2, c)).toBe(MAR);
    expect(diasHabilesAntes(JUE, 0, c)).toBe(JUE);
    expect(finDeDia(LUN, c).toISOString()).toBe(bog(LUN, "18:00").toISOString());
    expect(finDeDia(LUN, c).toISOString()).toBe("2026-10-05T23:00:00.000Z");
  });
});

describe("vencimientos y semáforo (criterio B7)", () => {
  const asignadaLun8 = ev("crear", "Backlog", "Asignada", bog(LUN, "08:00"));

  it("inicioReloj: primer evento que la deja Asignada; si no hay, created_at", () => {
    expect(inicioReloj(pieza({})).toISOString()).toBe(bog(LUN, "08:00").toISOString());
    const p = pieza({
      eventos: [
        ev("crear", "Backlog", "Backlog", bog(LUN, "08:00")),
        ev("asignar", "Backlog", "Asignada", bog(LUN, "11:00")),
        ev("editar", "Asignada", "Asignada", bog(LUN, "12:00")),
      ],
    });
    expect(inicioReloj(p).toISOString()).toBe(bog(LUN, "11:00").toISOString());
    expect(respondida(p)).toBe(false);
    p.eventos.push(ev("empezar", "Asignada", "En curso", bog(LUN, "13:00")));
    expect(respondida(p)).toBe(true);
  });

  it("Backlog Normal → sin_plazo; Backlog Urgent corre la respuesta desde created_at", () => {
    const ahora = bog(LUN, "09:00");
    expect(evaluarSla(pieza({}), c, ahora)).toEqual({
      fase: null,
      vence: null,
      estado: "sin_plazo",
      horasRestantes: null,
      respondida: false,
    });
    const urgente = evaluarSla(pieza({ priority: "Urgent" }), c, ahora);
    expect(urgente.fase).toBe("respuesta");
    expect(urgente.vence?.toISOString()).toBe(bog(LUN, "10:00").toISOString());
    expect(urgente.estado).toBe("a_tiempo");
  });

  it("P1 asignada sin respuesta: a 1,5 h → por_vencer; a 2,1 h → vencida", () => {
    const p = pieza({ priority: "Urgent", status: "Asignada", eventos: [asignadaLun8] });
    expect(venceRespuesta(p, c).toISOString()).toBe(bog(LUN, "10:00").toISOString());
    const a15 = evaluarSla(p, c, bog(LUN, "09:30"));
    expect(a15.fase).toBe("respuesta");
    expect(a15.estado).toBe("por_vencer");
    expect(a15.horasRestantes).toBe(0.5);
    const a21 = evaluarSla(p, c, bog(LUN, "10:06"));
    expect(a21.estado).toBe("vencida");
    expect(a21.horasRestantes).toBe(0);
    expect(evaluarSla(p, c, bog(LUN, "08:30")).estado).toBe("a_tiempo");
  });

  it("Asignada respondida y En curso → fase entrega (Normal = 10 días hábiles desde el inicio)", () => {
    const p = pieza({
      status: "En curso",
      eventos: [asignadaLun8, ev("empezar", "Asignada", "En curso", bog(LUN, "09:00"))],
    });
    const r = evaluarSla(p, c, bog(LUN, "10:00"));
    expect(r.fase).toBe("entrega");
    expect(r.respondida).toBe(true);
    expect(r.vence?.toISOString()).toBe(bog("2026-10-16", "18:00").toISOString()); // 100 h hábiles
    expect(r.estado).toBe("a_tiempo");
  });

  it("la due_date manda sobre el SLA de la prioridad", () => {
    const base = { status: "En curso" as const, eventos: [asignadaLun8, ev("empezar", "Asignada", "En curso", bog(LUN, "09:00"))] };
    expect(venceEntrega(pieza(base), c)?.toISOString()).toBe(bog("2026-10-16", "18:00").toISOString());
    const conFecha = pieza({ ...base, due_date: MAR });
    expect(venceEntrega(conFecha, c)?.toISOString()).toBe(bog(MAR, "18:00").toISOString());
    // Ventana lun 08:00 → mar 18:00 = 20 h: "por vencer" con ≤ min(25 % de 20, 10) = 5 h.
    expect(evaluarSla(conFecha, c, bog(MAR, "13:30")).estado).toBe("por_vencer"); // quedan 4,5 h
    expect(evaluarSla(conFecha, c, bog(MAR, "12:00")).estado).toBe("a_tiempo"); // quedan 6 h
    expect(evaluarSla(conFecha, c, bog(LUN, "10:00")).estado).toBe("a_tiempo");
    expect(evaluarSla(conFecha, c, bog(MAR, "18:01")).estado).toBe("vencida");
    // Una fecha ilegible no tumba el cálculo: rige el SLA de la prioridad.
    expect(venceEntrega(pieza({ ...base, due_date: "2026-02-30" }), c)?.toISOString()).toBe(
      bog("2026-10-16", "18:00").toISOString()
    );
  });

  it("Asignada sin respuesta toma la más próxima entre respuesta y entrega", () => {
    const p = pieza({ status: "Asignada", due_date: LUN, eventos: [asignadaLun8] });
    // Respuesta Normal = 20 h (mar 18:00); entrega = lun 18:00 → manda la entrega.
    const r = evaluarSla(p, c, bog(LUN, "09:00"));
    expect(r.fase).toBe("entrega");
    expect(r.vence?.toISOString()).toBe(bog(LUN, "18:00").toISOString());
    const sinFecha = evaluarSla(pieza({ status: "Asignada", eventos: [asignadaLun8] }), c, bog(LUN, "09:00"));
    expect(sinFecha.fase).toBe("respuesta");
    expect(sinFecha.vence?.toISOString()).toBe(bog(MAR, "18:00").toISOString());
  });

  it("Low sin due_date en curso → sin_plazo; con fecha, entrega", () => {
    const eventos = [asignadaLun8, ev("empezar", "Asignada", "En curso", bog(LUN, "09:00"))];
    expect(evaluarSla(pieza({ priority: "Low", status: "En curso", eventos }), c, bog(LUN, "10:00")).estado).toBe(
      "sin_plazo"
    );
    const conFecha = evaluarSla(pieza({ priority: "Low", status: "En curso", due_date: JUE, eventos }), c, bog(LUN, "10:00"));
    expect(conFecha.fase).toBe("entrega");
    expect(conFecha.estado).toBe("a_tiempo");
  });

  it("revisión de más de 1 día hábil → vencida", () => {
    const p = pieza({
      status: "En revisión",
      eventos: [
        asignadaLun8,
        ev("empezar", "Asignada", "En curso", bog(LUN, "08:30")),
        ev("enviar_a_revision", "En curso", "En revisión", bog(LUN, "09:00")),
      ],
    });
    expect(momentoEntrega(p)?.toISOString()).toBe(bog(LUN, "09:00").toISOString());
    expect(venceRevision(p, c)?.toISOString()).toBe(bog(MAR, "09:00").toISOString());
    expect(evaluarSla(p, c, bog(LUN, "12:00")).estado).toBe("a_tiempo");
    expect(evaluarSla(p, c, bog(MAR, "08:30")).estado).toBe("por_vencer");
    const r = evaluarSla(p, c, bog(MAR, "09:30"));
    expect(r.fase).toBe("revision");
    expect(r.estado).toBe("vencida");
    // En revisión sin evento de envío (importada así): sin plazo.
    expect(evaluarSla(pieza({ status: "En revisión" }), c, bog(MAR, "09:30")).estado).toBe("sin_plazo");
  });

  it("bloqueo de 2 días hábiles → vencida (blocked_at con Z)", () => {
    const p = pieza({
      status: "Bloqueada",
      blocked_at: bog(LUN, "09:00").toISOString(),
      eventos: [asignadaLun8, ev("bloquear", "Asignada", "Bloqueada", bog(LUN, "09:00"), true)],
    });
    expect(evaluarSla(p, c, bog(MAR, "09:00")).estado).toBe("a_tiempo");
    const r = evaluarSla(p, c, bog(MIE, "10:00"));
    expect(r.fase).toBe("bloqueo");
    expect(r.vence?.toISOString()).toBe(bog(MIE, "09:00").toISOString());
    expect(r.estado).toBe("vencida");
  });

  it("Hecha → sin_plazo", () => {
    const p = pieza({
      status: "Hecha",
      eventos: [asignadaLun8, ev("aprobar", "En revisión", "Hecha", bog(LUN, "15:00"))],
    });
    expect(evaluarSla(p, c, bog(MIE, "10:00")).estado).toBe("sin_plazo");
  });
});

describe("bono de puntualidad: se aprobó a tiempo (criterio B8, literal)", () => {
  function entregada(enviada: Date, aprobada: Date | null, o: Partial<PiezaSla> = {}): PiezaSla {
    const eventos = [
      ev("crear", "Backlog", "Asignada", bog(LUN, "08:00")),
      ev("empezar", "Asignada", "En curso", bog(LUN, "08:10")),
      ev("enviar_a_revision", "En curso", "En revisión", enviada),
    ];
    if (aprobada) eventos.push(ev("aprobar", "En revisión", "Hecha", aprobada));
    return pieza({ status: aprobada ? "Hecha" : "En revisión", due_date: MAR, eventos, ...o });
  }

  it("due_date mañana y aprobada hoy → true", () => {
    const p = entregada(bog(LUN, "11:00"), bog(LUN, "15:00"));
    expect(momentoAprobacion(p)?.toISOString()).toBe(bog(LUN, "15:00").toISOString());
    expect(aprobadaATiempo(p, c)).toBe(true);
  });

  it("aprobada el mismo día del vencimiento, antes del cierre → true", () => {
    expect(aprobadaATiempo(entregada(bog(LUN, "11:00"), bog(MAR, "17:59")), c)).toBe(true);
    expect(aprobadaATiempo(entregada(bog(LUN, "11:00"), bog(MAR, "18:00")), c)).toBe(true);
  });

  it("entregada hoy pero aprobada pasado mañana → false (se mide al aprobar)", () => {
    expect(aprobadaATiempo(entregada(bog(LUN, "11:00"), bog(MIE, "10:00")), c)).toBe(false);
  });

  it("sin plazo (Low sin fecha) → false", () => {
    expect(aprobadaATiempo(entregada(bog(LUN, "11:00"), bog(LUN, "15:00"), { priority: "Low", due_date: null }), c)).toBe(
      false
    );
  });

  it("sin evento aprobar → false; con aprobadaEn explícito, se usa ese instante", () => {
    const p = entregada(bog(LUN, "11:00"), null);
    expect(aprobadaATiempo(p, c)).toBe(false);
    expect(aprobadaATiempo(p, c, bog(MAR, "10:00"))).toBe(true);
    expect(aprobadaATiempo(p, c, bog(MIE, "10:00"))).toBe(false);
  });

  it("sin fecha, el plazo es el SLA de entrega de su prioridad desde el inicio del reloj", () => {
    // High = 3 días hábiles (30 h) desde lun 08:00 → mié 18:00.
    const alta = { priority: "High" as const, due_date: null };
    expect(aprobadaATiempo(entregada(bog(LUN, "11:00"), bog(MIE, "17:00"), alta), c)).toBe(true);
    expect(aprobadaATiempo(entregada(bog(LUN, "11:00"), bog(JUE, "09:00"), alta), c)).toBe(false);
  });
});

describe("formatoVence", () => {
  const ahora = bog(LUN, "10:00");
  it("hoy, mañana, ayer, día de la semana y fecha", () => {
    expect(formatoVence(bog(LUN, "14:00"), ahora, c)).toBe("hoy 14:00");
    expect(formatoVence(bog(LUN, "14:30"), ahora, c)).toBe("hoy 14:30");
    expect(formatoVence(bog(MAR, "09:00"), ahora, c)).toBe("mañana 09:00");
    expect(formatoVence(bog(JUE, "16:00"), ahora, c)).toBe("jue 16:00");
    expect(formatoVence(bog(VIE, "18:00"), bog(SAB, "10:00"), c)).toBe("ayer 18:00");
    expect(formatoVence(bog("2026-10-20", "18:00"), ahora, c)).toBe("20 oct 18:00");
    expect(formatoVence(bog("2027-01-04", "09:00"), ahora, c)).toBe("4 ene 2027 09:00");
  });
});

describe("sla-db: cargadores desde la base", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
    db.prepare(`INSERT INTO users (wallet, display_name, role) VALUES ('GDUENO', 'Dueña', 'core')`).run();
  });

  function asignacion(o: { status: string; priority?: string; due?: string | null; creada: Date }): number {
    const info = db
      .prepare(
        `INSERT INTO assignments (title, owner_wallet, status, priority, due_date, created_at) VALUES ('Pieza', 'GDUENO', ?, ?, ?, ?)`
      )
      .run(o.status, o.priority ?? "Normal", o.due ?? null, instanteDb(o.creada));
    return Number(info.lastInsertRowid);
  }

  function evento(id: number, action: string, from: string, to: string, d: Date): void {
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, actor_wallet, day, created_at)
       VALUES (?, ?, ?, ?, 'GDUENO', ?, ?)`
    ).run(id, action, from, to, instanteDb(d).slice(0, 10), instanteDb(d));
  }

  it("slaConfig = el genoma activo mezclado con los defaults", () => {
    expect(slaConfig(db)).toEqual(slaConfigDesdeGenoma(getActiveGenome(db)));
    expect(slaConfig(db)).toEqual(c);
  });

  it("cargarPiezaSla trae la pieza con sus eventos en orden de id (created_at sin Z)", () => {
    const id = asignacion({ status: "En curso", priority: "Urgent", creada: bog(LUN, "08:00") });
    evento(id, "crear", "Backlog", "Asignada", bog(LUN, "08:00"));
    evento(id, "empezar", "Asignada", "En curso", bog(LUN, "08:30"));
    const p = cargarPiezaSla(db, id);
    expect(p).toBeDefined();
    expect(p?.priority).toBe("Urgent");
    expect(p?.eventos.map((e) => e.action)).toEqual(["crear", "empezar"]);
    expect(inicioReloj(p as PiezaSla).toISOString()).toBe(bog(LUN, "08:00").toISOString());
    // P1: 8 h hábiles de restablecimiento → lun 16:00.
    expect(venceEntrega(p as PiezaSla, c)?.toISOString()).toBe(bog(LUN, "16:00").toISOString());
    expect(cargarPiezaSla(db, 9999)).toBeUndefined();
  });

  it("una fila con el default de SQLite (sin created_at explícito) se lee como UTC", () => {
    db.prepare(`INSERT INTO assignments (title, status) VALUES ('Sin fecha', 'Backlog')`).run();
    const { id, created_at } = db.prepare(`SELECT id, created_at FROM assignments WHERE title = 'Sin fecha'`).get() as {
      id: number;
      created_at: string;
    };
    expect(created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const p = cargarPiezaSla(db, id) as PiezaSla;
    expect(Math.abs(inicioReloj(p).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("cargarPiezasAbiertas excluye Hecha y slaDeAsignaciones evalúa por id", () => {
    const abierta = asignacion({ status: "Asignada", priority: "Urgent", creada: bog(LUN, "08:00") });
    evento(abierta, "crear", "Backlog", "Asignada", bog(LUN, "08:00"));
    const hecha = asignacion({ status: "Hecha", creada: bog(LUN, "08:00") });
    evento(hecha, "aprobar", "En revisión", "Hecha", bog(LUN, "09:00"));
    const bloqueada = asignacion({ status: "Bloqueada", creada: bog(LUN, "08:00") });
    db.prepare(`UPDATE assignments SET blocked_at = ? WHERE id = ?`).run(bog(LUN, "09:00").toISOString(), bloqueada);

    const abiertas = cargarPiezasAbiertas(db);
    expect(abiertas.map((p) => p.id)).toEqual([abierta, bloqueada]);
    expect(abiertas[0].eventos).toHaveLength(1);
    expect(abiertas[1].eventos).toHaveLength(0);

    const mapa = slaDeAsignaciones(db, [abierta, hecha, bloqueada, abierta, 9999], bog(LUN, "09:30"));
    expect([...mapa.keys()].sort((a, b) => a - b)).toEqual([abierta, hecha, bloqueada]);
    expect(mapa.get(abierta)?.estado).toBe("por_vencer");
    expect(mapa.get(hecha)?.estado).toBe("sin_plazo");
    expect(mapa.get(bloqueada)?.fase).toBe("bloqueo");
    expect(slaDeAsignaciones(db, []).size).toBe(0);
  });

  it("solo lee: ningún UPDATE, DELETE ni INSERT en sla.ts ni en sla-db.ts", () => {
    for (const f of ["sla.ts", "sla-db.ts"]) {
      const src = fs
        .readFileSync(path.join(process.cwd(), "src", "lib", f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// Límite cliente/servidor: sla.ts y sla-db.ts no arrastran db.ts, crypto.ts,
// session.ts ni `node:` (ni en cadena). Solo cuentan los imports de valor.
// ---------------------------------------------------------------------------

const LIB = path.join(process.cwd(), "src", "lib");
const PROHIBIDOS = ["db.ts", "crypto.ts", "session.ts"];

/** Especificadores de los imports y re-exports DE VALOR de un archivo. */
function importsDeValor(src: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    const cuerpo = m[2].trim();
    if (/^type\b/.test(cuerpo)) continue; // import type / export type
    const llaves = /^\{([\s\S]*)\}$/.exec(cuerpo);
    if (llaves && llaves[1].split(",").every((s) => !s.trim() || /^type\b/.test(s.trim()))) continue;
    out.push(m[3]);
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

function cadena(archivo: string, visto = new Set<string>()): { archivos: string[]; externos: string[] } {
  const externos: string[] = [];
  const pend = [archivo];
  while (pend.length) {
    const f = pend.pop() as string;
    if (visto.has(f)) continue;
    visto.add(f);
    for (const spec of importsDeValor(fs.readFileSync(path.join(LIB, f), "utf8"))) {
      if (!spec.startsWith("./")) {
        externos.push(spec);
        continue;
      }
      const base = spec.slice(2);
      pend.push(base.endsWith(".ts") ? base : `${base}.ts`);
    }
  }
  return { archivos: [...visto], externos };
}

describe("límite cliente/servidor de sla.ts y sla-db.ts", () => {
  it("el detector distingue imports de tipo y de valor", () => {
    expect(importsDeValor(`import type { DB } from "./db";\nimport { a, type B } from "./x.ts";`)).toEqual(["./x.ts"]);
    expect(importsDeValor(`import { type A, type B } from "./y";\nexport { c } from "./z.ts";`)).toEqual(["./z.ts"]);
  });

  for (const modulo of ["sla.ts", "sla-db.ts"]) {
    it(`${modulo}: ni db.ts, ni crypto.ts, ni session.ts, ni node: en la cadena de valor`, () => {
      const { archivos, externos } = cadena(modulo);
      expect(archivos).toContain(modulo);
      for (const p of PROHIBIDOS) expect(archivos).not.toContain(p);
      expect(externos.filter((e) => e.startsWith("node:"))).toEqual([]);
      expect(externos).toEqual([]); // ningún paquete: módulo puro
    });
  }

  it("los imports de valor relativos llevan sufijo .ts (CLI con type-stripping)", () => {
    for (const modulo of ["sla.ts", "sla-db.ts"]) {
      const rel = importsDeValor(fs.readFileSync(path.join(LIB, modulo), "utf8")).filter((s) => s.startsWith("./"));
      expect(rel.length).toBeGreaterThan(0);
      for (const s of rel) expect(s.endsWith(".ts")).toBe(true);
    }
  });
});
