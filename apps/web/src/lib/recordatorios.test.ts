/**
 * Motor puro de recordatorios (WP31 §5.C.1): criterios C1-1 (tabla de tipos, Low no
 * genera nada, solo Urgent es inmediato) y C1-7 (textos sobre la entrega, sin
 * vocabulario prohibido ni el nombre del responsable), más la guarda de arranque.
 *
 * Reloj fijo y horario de Bogotá (UTC−5): lunes 2026-10-05, martes 06, miércoles 07,
 * jueves 08, viernes 09, lunes 12, martes 13, miércoles 14. Los tests corren con TZ=UTC.
 * Con el genoma por defecto: 1 día hábil = 10 h; P1 responde en 2 h, entrega en 8 h y
 * se revisa en 4 h; High entrega en 3 días; bloqueo escala a 2 días y al founder a 5.
 */
import { describe, it, expect } from "vitest";
import { GENOME_DEFAULTS } from "./genome";
import { instanteDb, instanteLocal } from "./zona-horaria";
import type { EventoSla } from "./sla";
import {
  MAX_LINEA_TELEGRAM,
  MAX_TEXTO_TELEGRAM,
  TIPOS_RECORDATORIO,
  VOCABULARIO_PROHIBIDO,
  configRecordatoriosDesdeGenoma,
  planificarRecordatorios,
  renderDigest,
  renderInmediato,
  renderInmediatos,
  type ConfigRecordatorios,
  type PiezaRecordable,
  type Recordatorio,
} from "./recordatorios";

const TZ = "America/Bogota";
const LUN = "2026-10-05";
const MAR = "2026-10-06";
const MIE = "2026-10-07";
const JUE = "2026-10-08";
const VIE = "2026-10-09";
const LUN2 = "2026-10-12";
const MIE2 = "2026-10-14";

function bog(dia: string, hhmm: string): Date {
  return instanteLocal(dia, hhmm, TZ);
}

const ANA = "GANAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Configuración activa desde mucho antes: la guarda de arranque no interviene. */
const CFG: ConfigRecordatorios = {
  ...configRecordatoriosDesdeGenoma(GENOME_DEFAULTS),
  activadoDesde: new Date("2026-09-01T13:00:00.000Z"),
};

function ev(action: string, from: string, to: string, d: Date): EventoSla {
  return { action, from_status: from, to_status: to, created_at: instanteDb(d) };
}

let sec = 0;
function pieza(p: Partial<PiezaRecordable>): PiezaRecordable {
  sec++;
  return {
    id: p.id ?? sec,
    priority: "Normal",
    status: "Asignada",
    due_date: null,
    created_at: instanteDb(bog(LUN, "08:00")),
    blocked_at: null,
    eventos: [],
    title: "Integrar el pago",
    owner_wallet: ANA,
    initiative_id: 1,
    initiative_slug: "proyecto-piloto",
    initiative_name: "Proyecto Piloto",
    blocked_reason: null,
    ...p,
  };
}

/** Asignada el lunes a las 09:00 (y, si `empieza`, en curso a las 09:15). */
function asignada(p: Partial<PiezaRecordable>, empieza = false): PiezaRecordable {
  const eventos = [ev("asignar", "Backlog", "Asignada", bog(LUN, "09:00"))];
  if (empieza) eventos.push(ev("empezar", "Asignada", "En curso", bog(LUN, "09:15")));
  return pieza({ status: empieza ? "En curso" : "Asignada", eventos, ...p });
}

function tipos(rs: Recordatorio[]): string[] {
  return rs.map((r) => r.tipo);
}
function de(rs: Recordatorio[], tipo: string): Recordatorio {
  const r = rs.find((x) => x.tipo === tipo);
  if (!r) throw new Error(`no hay ${tipo} en [${tipos(rs).join(", ")}]`);
  return r;
}

describe("configRecordatoriosDesdeGenoma: todo número sale del genoma", () => {
  it("mapea las claves REMINDER_* y ESCALATE_* sobre la configuración de SLA", () => {
    const c = configRecordatoriosDesdeGenoma(GENOME_DEFAULTS);
    expect(c.digestHora).toBe(GENOME_DEFAULTS.REMINDER_DIGEST_HOUR);
    expect(c.p1SinRespuestaH).toBe(GENOME_DEFAULTS.REMINDER_P1_NO_RESPONSE_H);
    expect(c.antesDias).toEqual(GENOME_DEFAULTS.REMINDER_BEFORE_D);
    expect(c.escalaSupervisorD).toEqual(GENOME_DEFAULTS.ESCALATE_SUPERVISOR_D);
    expect(c.escalaFounderD).toEqual(GENOME_DEFAULTS.ESCALATE_FOUNDER_D);
    expect(c.p1FounderFactor).toBe(GENOME_DEFAULTS.ESCALATE_P1_FOUNDER_FACTOR);
    expect(c.maxInmediatos).toBe(GENOME_DEFAULTS.REMINDER_MAX_INMEDIATOS);
    expect(c.activadoDesde).toBeNull();
    expect(c.tz).toBe(GENOME_DEFAULTS.BUSINESS_TZ);
    expect(c.bloqueoEscalaH).toBe(20);
  });

  it("un genoma distinto cambia el comportamiento (sin números en el motor)", () => {
    const c: ConfigRecordatorios = {
      ...configRecordatoriosDesdeGenoma({ ...GENOME_DEFAULTS, REMINDER_BEFORE_D: { High: 2, Normal: 2 } }),
      activadoDesde: CFG.activadoDesde,
    };
    const p = asignada({ priority: "High", due_date: JUE }, true);
    expect(tipos(planificarRecordatorios([p], c, bog(MAR, "10:00")))).toEqual(["vence_pronto"]);
    expect(tipos(planificarRecordatorios([p], CFG, bog(MAR, "10:00")))).toEqual([]);
  });
});

describe("C1-1 · planificarRecordatorios: tabla de §5.C.1", () => {
  it("p1_asignada: Urgent asignada sin respuesta → al dueño, al momento", () => {
    const p = asignada({ id: 11, priority: "Urgent", due_date: MAR }); // vence mañana: aísla el tipo
    const rs = planificarRecordatorios([p], CFG, bog(LUN, "09:30"));
    expect(tipos(rs)).toEqual(["p1_asignada"]);
    const r = rs[0];
    expect(r).toMatchObject({
      assignmentId: 11,
      destino: { tipo: "persona", wallet: ANA },
      clave: "p1_asignada:11",
      inmediato: true,
      enlace: "/equipo/proyectos/proyecto-piloto",
    });
    expect(r.texto).toBe("«Integrar el pago» (P1) es urgente y te espera. Primera respuesta antes de 11:00.");
  });

  it("p1_sin_respuesta: a la hora hábil sin respuesta (REMINDER_P1_NO_RESPONSE_H)", () => {
    const p = asignada({ id: 12, priority: "Urgent", due_date: MAR });
    expect(tipos(planificarRecordatorios([p], CFG, bog(LUN, "09:59")))).toEqual(["p1_asignada"]);
    const rs = planificarRecordatorios([p], CFG, bog(LUN, "10:15"));
    expect(tipos(rs)).toEqual(["p1_asignada", "p1_sin_respuesta"]);
    const r = de(rs, "p1_sin_respuesta");
    expect(r.clave).toBe("p1_sin_respuesta:12");
    expect(r.inmediato).toBe(true);
    expect(r.texto).toBe("«Integrar el pago» (P1) aún no tiene primera respuesta. Plazo: hoy 11:00.");
  });

  it("un P1 asignado que vence hoy suma vence_hoy (Asignada está en la tabla)", () => {
    const p = asignada({ priority: "Urgent" }); // entrega 8 h hábiles → lunes 17:00
    const rs = planificarRecordatorios([p], CFG, bog(LUN, "09:30"));
    expect(tipos(rs)).toEqual(["p1_asignada", "vence_hoy"]);
    expect(rs.every((r) => r.inmediato)).toBe(true);
  });

  it("con primera respuesta (en curso) ya no hay avisos de respuesta", () => {
    const p = asignada({ priority: "Urgent" }, true);
    expect(tipos(planificarRecordatorios([p], CFG, bog(LUN, "10:15")))).not.toContain("p1_asignada");
  });

  it("vence_hoy de un P1: al momento, con la hora local", () => {
    const p = asignada({ id: 13, priority: "Urgent" }, true); // entrega 8 h hábiles → lunes 17:00
    const rs = planificarRecordatorios([p], CFG, bog(LUN, "12:00"));
    expect(tipos(rs)).toEqual(["vence_hoy"]);
    expect(rs[0]).toMatchObject({ clave: `vence_hoy:13:${LUN}`, inmediato: true });
    expect(rs[0].texto).toBe("«Integrar el pago» (P1) vence hoy a las 17:00.");
  });

  it("P1 vencido: vencida al dueño y escala_supervisor, ambos al momento", () => {
    const p = asignada({ id: 14, priority: "Urgent" }, true);
    const rs = planificarRecordatorios([p], CFG, bog(MAR, "09:00"));
    expect(tipos(rs)).toEqual(["vencida", "escala_supervisor"]);
    expect(de(rs, "vencida")).toMatchObject({ clave: `vencida:14:${LUN}`, inmediato: true });
    expect(de(rs, "vencida").texto).toBe(
      "«Integrar el pago» (P1) pasó su fecha de entrega (ayer 17:00). Puedes pedir nueva fecha o bloquearla con motivo."
    );
    expect(de(rs, "escala_supervisor")).toMatchObject({
      destino: { tipo: "supervision", initiativeId: 1, incluyeRevisa: false },
      clave: `escala_supervisor:14:${LUN}`,
      inmediato: true,
    });
    expect(de(rs, "escala_supervisor").texto).toBe(
      "«Integrar el pago» (P1 · Proyecto Piloto) pasó su plazo. ¿Ayudas a destrabarla o a acordar nueva fecha?"
    );
  });

  it("P1: escala_founder al doble de la ventana de restablecimiento", () => {
    const p = asignada({ id: 15, priority: "Urgent" }, true); // 9:00 + 16 h hábiles = martes 15:00
    expect(tipos(planificarRecordatorios([p], CFG, bog(MAR, "14:59")))).not.toContain("escala_founder");
    const rs = planificarRecordatorios([p], CFG, bog(MAR, "15:00"));
    const r = de(rs, "escala_founder");
    expect(r).toMatchObject({ destino: { tipo: "founder" }, clave: `escala_founder:15:${LUN}`, inmediato: true });
    expect(r.texto).toBe("«Integrar el pago» (P1 · Proyecto Piloto) lleva el doble de su plazo sin entrega. Está en tu bandeja.");
  });

  it("High: vence_pronto el día hábil antes, vence_hoy el día, vencida después — nunca al momento", () => {
    const p = asignada({ id: 16, priority: "High", due_date: JUE }, true);
    const antes = planificarRecordatorios([p], CFG, bog(MIE, "10:00"));
    expect(tipos(antes)).toEqual(["vence_pronto"]);
    expect(antes[0]).toMatchObject({ clave: `vence_pronto:16:${JUE}`, inmediato: false });
    expect(antes[0].texto).toBe("«Integrar el pago» (P2) vence mañana 18:00.");

    const dia = planificarRecordatorios([p], CFG, bog(JUE, "10:00"));
    expect(tipos(dia)).toEqual(["vence_hoy"]);
    expect(dia[0]).toMatchObject({ clave: `vence_hoy:16:${JUE}`, inmediato: false });
    expect(dia[0].texto).toBe("«Integrar el pago» (P2) vence hoy a las 18:00.");

    const despues = planificarRecordatorios([p], CFG, bog(VIE, "10:00"));
    expect(tipos(despues)).toEqual(["vencida"]);
    expect(despues[0].inmediato).toBe(false);
  });

  it("High: los escalamientos van al resumen del día (no inmediatos)", () => {
    const p = asignada({ id: 17, priority: "High", due_date: JUE }, true);
    // + 1 día hábil (viernes 18:00) → la corrida del lunes siguiente.
    expect(tipos(planificarRecordatorios([p], CFG, bog(VIE, "17:59")))).toEqual(["vencida"]);
    const sup = planificarRecordatorios([p], CFG, bog(LUN2, "09:00"));
    expect(tipos(sup)).toEqual(["vencida", "escala_supervisor"]);
    expect(de(sup, "escala_supervisor").inmediato).toBe(false);
    // + 3 días hábiles (martes 13 a las 18:00) → la corrida del miércoles 14.
    const fou = planificarRecordatorios([p], CFG, bog(MIE2, "09:00"));
    const r = de(fou, "escala_founder");
    expect(r.inmediato).toBe(false);
    expect(r.clave).toBe(`escala_founder:17:${JUE}`);
    expect(r.texto).toBe("«Integrar el pago» (P2 · Proyecto Piloto) lleva 3 días hábiles sin entrega. Está en tu bandeja.");
    expect(rsSinInmediatos(fou)).toBe(true);
  });

  it("Normal: vence_pronto dos días hábiles antes (REMINDER_BEFORE_D.Normal)", () => {
    const p = asignada({ priority: "Normal", due_date: JUE }, true);
    expect(tipos(planificarRecordatorios([p], CFG, bog(LUN, "10:00")))).toEqual([]);
    expect(tipos(planificarRecordatorios([p], CFG, bog(MAR, "10:00")))).toEqual(["vence_pronto"]);
    expect(tipos(planificarRecordatorios([p], CFG, bog(MIE, "10:00")))).toEqual([]);
  });

  it("revision_pendiente: pasado el plazo de revisión, a quien estructura y a quien revisa", () => {
    const p = pieza({
      id: 18,
      priority: "Normal",
      status: "En revisión",
      eventos: [
        ev("asignar", "Backlog", "Asignada", bog(LUN, "09:00")),
        ev("empezar", "Asignada", "En curso", bog(LUN, "09:10")),
        ev("enviar_a_revision", "En curso", "En revisión", bog(LUN, "10:00")),
      ],
    });
    expect(tipos(planificarRecordatorios([p], CFG, bog(MAR, "09:59")))).toEqual([]);
    const rs = planificarRecordatorios([p], CFG, bog(MAR, "11:00"));
    expect(tipos(rs)).toEqual(["revision_pendiente"]);
    expect(rs[0]).toMatchObject({
      destino: { tipo: "supervision", initiativeId: 1, incluyeRevisa: true },
      clave: `revision:18:${LUN}`,
      inmediato: false,
    });
    expect(rs[0].texto).toBe("«Integrar el pago» espera revisión desde ayer 10:00.");
  });

  it("bloqueo a los 2 días hábiles y escala_founder a los 5, con el motivo", () => {
    const p = pieza({
      id: 19,
      priority: "High",
      status: "Bloqueada",
      blocked_at: instanteDb(bog(LUN, "09:00")),
      blocked_reason: "Falta el acceso al ambiente de pruebas",
      eventos: [ev("asignar", "Backlog", "Asignada", bog(LUN, "08:30"))],
    });
    expect(tipos(planificarRecordatorios([p], CFG, bog(MIE, "08:59")))).toEqual([]);
    const rs = planificarRecordatorios([p], CFG, bog(MIE, "09:00"));
    expect(tipos(rs)).toEqual(["bloqueo"]);
    expect(rs[0].destino).toEqual({ tipo: "supervision", initiativeId: 1, incluyeRevisa: false });
    expect(rs[0].inmediato).toBe(false);
    expect(rs[0].clave).toMatch(/^bloqueo:19:2026-10-05T14:00:00$/);
    expect(rs[0].texto).toBe("«Integrar el pago» lleva 2 días hábiles bloqueada: «Falta el acceso al ambiente de pruebas».");

    const tarde = planificarRecordatorios([p], CFG, bog(LUN2, "09:00"));
    expect(tipos(tarde)).toEqual(["bloqueo", "escala_founder"]);
    expect(de(tarde, "escala_founder").texto).toBe(
      "«Integrar el pago» (P2 · Proyecto Piloto) lleva 5 días hábiles bloqueada. Está en tu bandeja."
    );
  });

  it("un bloqueo urgente sí sale al momento", () => {
    const p = pieza({ priority: "Urgent", status: "Bloqueada", blocked_at: instanteDb(bog(LUN, "09:00")) });
    const rs = planificarRecordatorios([p], CFG, bog(MIE, "09:00"));
    expect(de(rs, "bloqueo").inmediato).toBe(true);
    expect(de(rs, "bloqueo").texto).toBe("«Integrar el pago» lleva 2 días hábiles bloqueada.");
  });

  it("Low no genera nada, ni vencida ni bloqueada", () => {
    const piezas = [
      asignada({ priority: "Low", due_date: "2026-09-01" }, true),
      asignada({ priority: "Low" }),
      pieza({ priority: "Low", status: "Bloqueada", blocked_at: instanteDb(bog("2026-09-01", "09:00")) }),
    ];
    expect(planificarRecordatorios(piezas, CFG, bog(LUN2, "10:00"))).toEqual([]);
  });

  it("Backlog, Hecha y piezas sin responsable no generan avisos al dueño", () => {
    const piezas = [
      pieza({ priority: "Urgent", status: "Backlog", owner_wallet: null }),
      pieza({ priority: "Urgent", status: "Hecha", due_date: "2026-09-01" }),
    ];
    expect(planificarRecordatorios(piezas, CFG, bog(LUN2, "10:00"))).toEqual([]);
    const sinDueno = asignada({ priority: "Urgent", owner_wallet: null }, true);
    const rs = planificarRecordatorios([sinDueno], CFG, bog(MAR, "09:00"));
    expect(rs.every((r) => r.destino.tipo !== "persona")).toBe(true);
  });

  it("solo Urgent es inmediato en todo el plan", () => {
    const piezas = [
      asignada({ priority: "High", due_date: "2026-09-30" }, true),
      asignada({ priority: "Normal", due_date: "2026-09-21" }, true),
      pieza({ priority: "High", status: "Bloqueada", blocked_at: instanteDb(bog("2026-09-21", "09:00")) }),
      asignada({ priority: "Urgent" }, true),
    ];
    const rs = planificarRecordatorios(piezas, CFG, bog(MAR, "10:00"));
    expect(rs.length).toBeGreaterThan(4);
    const urgentes = new Set(piezas.filter((p) => p.priority === "Urgent").map((p) => p.id));
    for (const r of rs) expect(r.inmediato).toBe(urgentes.has(r.assignmentId));
    expect(rs.some((r) => r.tipo === "escala_supervisor" && !r.inmediato)).toBe(true);
  });

  it("sin proyecto: el enlace es el día y el texto dice «sin proyecto»", () => {
    const p = asignada({ id: 20, priority: "Urgent", initiative_id: null, initiative_slug: null, initiative_name: null }, true);
    const rs = planificarRecordatorios([p], CFG, bog(MAR, "09:00"));
    expect(de(rs, "escala_supervisor").destino).toEqual({ tipo: "supervision", initiativeId: null, incluyeRevisa: false });
    expect(de(rs, "escala_supervisor").texto).toContain("(P1 · sin proyecto)");
    expect(rs.every((r) => r.enlace === "/equipo/hoy")).toBe(true);
  });

  it("es determinista: mismo reloj y mismas piezas → mismo plan", () => {
    const piezas = [asignada({ priority: "Urgent" }, true), asignada({ priority: "High", due_date: JUE }, true)];
    const a = planificarRecordatorios(piezas, CFG, bog(JUE, "11:00"));
    const b = planificarRecordatorios([...piezas].reverse(), CFG, bog(JUE, "11:00"));
    expect(b).toEqual(a);
  });
});

function rsSinInmediatos(rs: Recordatorio[]): boolean {
  return rs.every((r) => !r.inmediato);
}

describe("guarda de arranque (activadoDesde)", () => {
  const activo: ConfigRecordatorios = { ...CFG, activadoDesde: bog(MIE, "08:00") };

  it("lo vencido antes de encender no escala y su vencida va al resumen", () => {
    const p1 = asignada({ priority: "Urgent" }, true); // venció el lunes 17:00
    const rs = planificarRecordatorios([p1], activo, bog(MIE, "10:00"));
    expect(tipos(rs)).toEqual(["vencida"]);
    expect(rs[0].inmediato).toBe(false);

    const high = asignada({ priority: "High", due_date: "2026-09-21" }, true);
    expect(tipos(planificarRecordatorios([high], activo, bog(MIE, "10:00")))).toEqual(["vencida"]);
  });

  it("revisión y bloqueo vencidos antes de encender no generan nada", () => {
    const rev = pieza({
      status: "En revisión",
      eventos: [ev("enviar_a_revision", "En curso", "En revisión", bog("2026-09-21", "10:00"))],
    });
    const blo = pieza({ status: "Bloqueada", blocked_at: instanteDb(bog("2026-09-21", "10:00")) });
    expect(planificarRecordatorios([rev, blo], activo, bog(MIE, "10:00"))).toEqual([]);
  });

  it("un P1 viejo sin respuesta avisa al dueño en el resumen, no al momento", () => {
    const p = pieza({
      priority: "Urgent",
      status: "Asignada",
      eventos: [ev("asignar", "Backlog", "Asignada", bog("2026-09-21", "10:00"))],
    });
    const rs = planificarRecordatorios([p], activo, bog(MIE, "10:00"));
    expect(tipos(rs)).toEqual(expect.arrayContaining(["p1_asignada", "p1_sin_respuesta"]));
    expect(rsSinInmediatos(rs)).toBe(true);
    expect(rs.some((r) => r.tipo.startsWith("escala"))).toBe(false);
  });

  it("lo que vence después de encender sí escala y sale al momento", () => {
    const p = pieza({
      id: 30,
      priority: "Urgent",
      status: "En curso",
      eventos: [
        ev("asignar", "Backlog", "Asignada", bog(MIE, "09:00")),
        ev("empezar", "Asignada", "En curso", bog(MIE, "09:05")),
      ],
    });
    const rs = planificarRecordatorios([p], activo, bog(JUE, "10:00"));
    expect(tipos(rs)).toEqual(["vencida", "escala_supervisor"]);
    expect(rs.every((r) => r.inmediato)).toBe(true);
  });

  it("activadoDesde null equivale a ahora: nada vencido escala en la primera corrida", () => {
    const sin: ConfigRecordatorios = { ...CFG, activadoDesde: null };
    const rs = planificarRecordatorios([asignada({ priority: "Urgent" }, true)], sin, bog(MIE, "10:00"));
    expect(tipos(rs)).toEqual(["vencida"]);
    expect(rs[0].inmediato).toBe(false);
  });
});

describe("C1-7 · textos sobre la entrega", () => {
  /** Un plan con todos los tipos posibles. */
  function planCompleto(): Recordatorio[] {
    const piezas: PiezaRecordable[] = [
      asignada({ priority: "Urgent" }), // p1_asignada + p1_sin_respuesta (a las 10:15)
      asignada({ priority: "Urgent" }, true), // vence_hoy
      asignada({ priority: "High", due_date: MAR }, true), // vence_pronto
      asignada({ priority: "Urgent", due_date: "2026-09-21" }, true), // vencida + escalamientos
      asignada({ priority: "Normal", due_date: "2026-09-01" }, true),
      pieza({
        status: "En revisión",
        eventos: [ev("enviar_a_revision", "En curso", "En revisión", bog("2026-09-28", "10:00"))],
      }),
      pieza({
        status: "Bloqueada",
        blocked_at: instanteDb(bog("2026-09-21", "10:00")),
        blocked_reason: "Esperando la respuesta del proveedor",
      }),
    ];
    return planificarRecordatorios(piezas, CFG, bog(LUN, "10:15"));
  }

  it("el plan de prueba cubre todos los tipos", () => {
    const vistos = new Set(planCompleto().map((r) => r.tipo));
    for (const t of TIPOS_RECORDATORIO) expect(vistos.has(t), t).toBe(true);
  });

  it("ningún texto ni mensaje casa con VOCABULARIO_PROHIBIDO ni nombra al responsable; todos llevan «título»", () => {
    const plan = planCompleto();
    const mensajes = [
      ...plan.map((r) => r.texto),
      ...plan.map((r) => renderInmediato(r, "https://www.zelena.tech")),
      renderInmediatos(plan, "https://www.zelena.tech"),
      renderDigest(plan, "https://www.zelena.tech"),
    ];
    for (const m of mensajes) {
      for (const re of VOCABULARIO_PROHIBIDO) expect(re.test(m), `${re} en: ${m}`).toBe(false);
      expect(m).not.toContain(ANA);
      expect(m).not.toMatch(/\bAna\b/);
    }
    for (const r of plan) expect(r.texto).toMatch(/«[^»]+»/);
  });

  it("VOCABULARIO_PROHIBIDO trae al menos la lista del spec", () => {
    const frases = [
      "atrasado",
      "vas tarde",
      "llegó tarde",
      "bajo desempeño",
      "rojo",
      "ranking",
      "última conexión",
      "horas trabajadas",
      "perdiste",
      "castigo",
      "jornada",
    ];
    for (const f of frases) expect(VOCABULARIO_PROHIBIDO.some((re) => re.test(f)), f).toBe(true);
  });
});

describe("mensajes agrupados", () => {
  const plan = planificarRecordatorios(
    [
      asignada({ id: 41, priority: "Urgent", due_date: MAR }),
      asignada({ id: 42, priority: "Urgent", due_date: MAR, title: "Cerrar la conciliación" }),
    ],
    CFG,
    bog(LUN, "09:30")
  );

  it("un inmediato suelto lleva su enlace", () => {
    expect(renderInmediato(plan[0], "https://www.zelena.tech/")).toBe(
      `${plan[0].texto}\nVer en Zelena: https://www.zelena.tech/equipo/proyectos/proyecto-piloto`
    );
    expect(renderInmediatos([plan[0]], "https://www.zelena.tech")).toBe(renderInmediato(plan[0], "https://www.zelena.tech"));
  });

  it("varios inmediatos van juntos en un mensaje", () => {
    expect(renderInmediatos(plan, "https://www.zelena.tech")).toBe(
      ["Lo urgente de ahora:", `· ${plan[0].texto}`, `· ${plan[1].texto}`, "Ver en Zelena: https://www.zelena.tech/equipo/avisos"].join(
        "\n"
      )
    );
  });

  it("el resumen del día lista todo y enlaza al día", () => {
    expect(renderDigest(plan, "https://www.zelena.tech")).toBe(
      ["Esto es lo de hoy en tus entregas:", `· ${plan[0].texto}`, `· ${plan[1].texto}`, "Ver en Zelena: https://www.zelena.tech/equipo/hoy"].join(
        "\n"
      )
    );
  });
});

describe("mensajes dentro del límite de Telegram (4096)", () => {
  const APP = "https://www.zelena.tech";
  /** Un recordatorio armado a mano, con el texto que haga falta. */
  function rec(texto: string, i = 0): Recordatorio {
    return {
      tipo: "vencida",
      assignmentId: 900 + i,
      destino: { tipo: "persona", wallet: ANA },
      clave: `vencida:${900 + i}:${LUN}`,
      inmediato: false,
      texto,
      enlace: "/equipo/proyectos/proyecto-piloto",
    };
  }
  const lineas = (m: string) => m.split("\n").filter((l) => l.startsWith("· "));
  const resto = (m: string) => Number(/^Y (\d+) más\.$/m.exec(m)?.[1] ?? 0);
  /** Un par sustituto partido (medio emoji) que Telegram no sabría mostrar. */
  const SUSTITUTO_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("el límite deja margen bajo el de la Bot API", () => {
    expect(MAX_TEXTO_TELEGRAM).toBeLessThanOrEqual(4096);
    expect(MAX_LINEA_TELEGRAM).toBeLessThan(MAX_TEXTO_TELEGRAM);
  });

  it("100 items en el resumen → cabe, lista los primeros en orden y cuenta el resto antes del enlace", () => {
    const items = Array.from({ length: 100 }, (_, i) => rec(`«Entrega número ${i + 1} con un título bastante largo para llenar el mensaje» (Normal) pasó su fecha de entrega.`, i));
    const m = renderDigest(items, APP);
    expect(m.length).toBeLessThanOrEqual(MAX_TEXTO_TELEGRAM);
    expect(m.startsWith("Esto es lo de hoy en tus entregas:\n")).toBe(true);
    const vistas = lineas(m);
    expect(vistas.length).toBeGreaterThan(10);
    expect(vistas).toEqual(items.slice(0, vistas.length).map((r) => `· ${r.texto}`)); // en orden, enteras
    expect(resto(m)).toBe(100 - vistas.length);
    expect(m.endsWith(`\nY ${resto(m)} más.\nVer en Zelena: ${APP}/equipo/hoy`)).toBe(true);
  });

  it("los urgentes agrupados también caben y enlazan a la bandeja", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ ...rec(`«Urgente ${i + 1} con un título largo de verdad, como los del backlog» (P1) es urgente y te espera.`, i), inmediato: true }));
    const m = renderInmediatos(items, APP);
    expect(m.length).toBeLessThanOrEqual(MAX_TEXTO_TELEGRAM);
    expect(m.startsWith("Lo urgente de ahora:\n")).toBe(true);
    expect(lineas(m).length + resto(m)).toBe(60);
    expect(m.endsWith(`\nY ${resto(m)} más.\nVer en Zelena: ${APP}/equipo/avisos`)).toBe(true);
  });

  it("lo que cabe justo sale entero; un carácter más y el último pasa a «Y 1 más»", () => {
    const cabecera = "Esto es lo de hoy en tus entregas:";
    const pie = `Ver en Zelena: ${APP}/equipo/hoy`;
    // Líneas de 500 (con su «· » y su salto, 501) que llenan el mensaje hasta el último carácter.
    let libre = MAX_TEXTO_TELEGRAM - (cabecera.length + 1) - pie.length;
    const textos: string[] = [];
    while (libre > 0) {
      const largo = Math.min(500, libre - 1);
      textos.push("a".repeat(largo - 2));
      libre -= largo + 1;
    }
    const justo = renderDigest(textos.map((t, i) => rec(t, i)), APP);
    expect(justo.length).toBe(MAX_TEXTO_TELEGRAM);
    expect(lineas(justo)).toHaveLength(textos.length);
    expect(resto(justo)).toBe(0);

    const ultimo = textos.length - 1;
    const pasado = renderDigest(textos.map((t, i) => rec(i === ultimo ? `${t}a` : t, i)), APP);
    expect(pasado.length).toBeLessThanOrEqual(MAX_TEXTO_TELEGRAM);
    expect(lineas(pasado)).toHaveLength(ultimo);
    expect(resto(pasado)).toBe(1);
  });

  it("una línea desmesurada se recorta con «…» y no deja fuera a las demás", () => {
    const enorme = rec(`«${"Título que no termina ".repeat(500)}» (Normal) vence mañana.`, 1);
    const corta = rec("«Cerrar la conciliación» (Normal) vence mañana.", 2);
    const m = renderDigest([enorme, corta], APP);
    expect(m.length).toBeLessThanOrEqual(MAX_TEXTO_TELEGRAM);
    const vistas = lineas(m);
    expect(vistas).toHaveLength(2);
    expect(vistas[0].length).toBe(MAX_LINEA_TELEGRAM);
    expect(vistas[0].endsWith("…")).toBe(true);
    expect(vistas[1]).toBe(`· ${corta.texto}`);
    expect(resto(m)).toBe(0);
  });

  it("un inmediato suelto desmesurado sale recortado, con su enlace entero", () => {
    const m = renderInmediato(rec(`«${"x".repeat(9000)}» (P1) es urgente y te espera.`), APP);
    expect(m.length).toBeLessThanOrEqual(MAX_TEXTO_TELEGRAM);
    expect(m.endsWith(`…\nVer en Zelena: ${APP}/equipo/proyectos/proyecto-piloto`)).toBe(true);
  });

  it("el recorte nunca parte un emoji", () => {
    for (const relleno of ["😀".repeat(400), `a${"😀".repeat(400)}`]) {
      const m = renderDigest([rec(relleno), rec(`b${relleno}`, 1)], APP);
      expect(m.length).toBeLessThanOrEqual(MAX_TEXTO_TELEGRAM);
      expect(SUSTITUTO_SUELTO.test(m)).toBe(false);
    }
  });
});
