/**
 * WP14 criterio 3: "Cambio de estado inválido rechazado por la máquina de estados
 * (test de tabla)". Este test recorre la matriz COMPLETA estado × acción (6×6 = 36
 * celdas) y verifica que la máquina acepta exactamente las 8 transiciones válidas
 * y rechaza las 28 restantes. La tabla se genera del producto cartesiano, así que
 * añadir un estado o una acción sin actualizar VALID rompe el test a propósito.
 */
import { describe, it, expect } from "vitest";
import {
  TEAM_STATUSES,
  TEAM_ACTIONS,
  OPEN_STATUSES,
  availableTeamActions,
  canTeamTransition,
  isOpenStatus,
  isTeamAction,
  isTeamStatus,
  teamTransition,
  BlockReasonRequiredError,
  InvalidTeamTransitionError,
  type TeamAction,
  type TeamAssignmentState,
  type TeamStatus,
} from "./team-state-machine";

/** Las ÚNICAS transiciones válidas del módulo equipo. */
const VALID: ReadonlyArray<[TeamStatus, TeamAction]> = [
  ["Backlog", "asignar"],
  ["Asignada", "empezar"],
  ["En curso", "enviar_a_revision"],
  ["En revisión", "aprobar"],
  // Único paso hacia atrás de la cadena: revisar sin poder devolver no es revisar.
  ["En revisión", "devolver"],
  ["Asignada", "bloquear"],
  ["En curso", "bloquear"],
  ["En revisión", "bloquear"],
  ["Bloqueada", "desbloquear"],
];

function isValid(s: TeamStatus, a: TeamAction): boolean {
  return VALID.some(([vs, va]) => vs === s && va === a);
}

function state(status: TeamStatus, before: TeamStatus | null = null): TeamAssignmentState {
  return { status, statusBeforeBlock: before, blockedReason: status === "Bloqueada" ? "motivo previo" : null };
}

describe("máquina de estados de asignaciones del equipo (WP14)", () => {
  it("la matriz completa estado × acción tiene exactamente 42 celdas y 9 válidas", () => {
    expect(TEAM_STATUSES).toHaveLength(6);
    expect(TEAM_ACTIONS).toHaveLength(7);
    expect(TEAM_STATUSES.length * TEAM_ACTIONS.length).toBe(42);
    expect(VALID).toHaveLength(9);
  });

  it("tabla completa: acepta las válidas y RECHAZA todas las inválidas", () => {
    let accepted = 0;
    let rejected = 0;
    for (const s of TEAM_STATUSES) {
      for (const a of TEAM_ACTIONS) {
        const expected = isValid(s, a);
        expect(canTeamTransition(s, a), `canTeamTransition('${s}','${a}')`).toBe(expected);
        if (expected) {
          // 'bloquear' exige motivo: se le pasa uno para probar solo la transición.
          expect(() => teamTransition(state(s, "En curso"), a, "motivo")).not.toThrow();
          accepted++;
        } else {
          expect(
            () => teamTransition(state(s, "En curso"), a, "motivo"),
            `teamTransition('${s}','${a}') debería lanzar`
          ).toThrow(InvalidTeamTransitionError);
          rejected++;
        }
      }
    }
    expect(accepted).toBe(9);
    expect(rejected).toBe(33);
  });

  it("recorre la secuencia completa sin saltos", () => {
    let s = teamTransition(state("Backlog"), "asignar");
    expect(s.status).toBe("Asignada");
    s = teamTransition(s, "empezar");
    expect(s.status).toBe("En curso");
    s = teamTransition(s, "enviar_a_revision");
    expect(s.status).toBe("En revisión");
    s = teamTransition(s, "aprobar");
    expect(s.status).toBe("Hecha");
  });

  it("no hay saltos: Backlog no llega a Hecha ni a En curso de un paso", () => {
    expect(() => teamTransition(state("Backlog"), "aprobar")).toThrow(InvalidTeamTransitionError);
    expect(() => teamTransition(state("Backlog"), "empezar")).toThrow(InvalidTeamTransitionError);
    expect(() => teamTransition(state("Asignada"), "aprobar")).toThrow(InvalidTeamTransitionError);
    expect(() => teamTransition(state("En curso"), "aprobar")).toThrow(InvalidTeamTransitionError);
  });

  it("'Hecha' es terminal: ninguna acción aplica (tampoco bloquear)", () => {
    for (const a of TEAM_ACTIONS) {
      expect(canTeamTransition("Hecha", a)).toBe(false);
    }
  });

  it("bloquear SIN motivo se rechaza; con motivo guarda el motivo y el estado previo", () => {
    const enCurso = state("En curso");
    expect(() => teamTransition(enCurso, "bloquear")).toThrow(BlockReasonRequiredError);
    expect(() => teamTransition(enCurso, "bloquear", "")).toThrow(BlockReasonRequiredError);
    expect(() => teamTransition(enCurso, "bloquear", "   ")).toThrow(BlockReasonRequiredError);

    const blocked = teamTransition(enCurso, "bloquear", "  falta acceso al tenant  ");
    expect(blocked.status).toBe("Bloqueada");
    expect(blocked.blockedReason).toBe("falta acceso al tenant"); // recortado
    expect(blocked.statusBeforeBlock).toBe("En curso");
  });

  it("desbloquear devuelve al estado desde el que se bloqueó y limpia el motivo", () => {
    for (const from of ["Asignada", "En curso", "En revisión"] as TeamStatus[]) {
      const blocked = teamTransition(state(from), "bloquear", "esperando a un tercero");
      const back = teamTransition(blocked, "desbloquear");
      expect(back.status).toBe(from);
      expect(back.blockedReason).toBeNull();
      expect(back.statusBeforeBlock).toBeNull();
    }
  });

  it("desbloquear sin estado previo registrado vuelve a 'Asignada' (nunca salta adelante)", () => {
    const back = teamTransition(
      { status: "Bloqueada", statusBeforeBlock: null, blockedReason: "dato viejo" },
      "desbloquear"
    );
    expect(back.status).toBe("Asignada");
  });

  it("la función es PURA: no muta el estado que recibe", () => {
    const original: TeamAssignmentState = { status: "En curso", statusBeforeBlock: null, blockedReason: null };
    const snapshot = JSON.stringify(original);
    teamTransition(original, "bloquear", "motivo");
    teamTransition(original, "enviar_a_revision");
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("availableTeamActions ofrece solo lo válido, en orden estable", () => {
    expect(availableTeamActions("Backlog")).toEqual(["asignar"]);
    expect(availableTeamActions("Asignada")).toEqual(["empezar", "bloquear"]);
    expect(availableTeamActions("En curso")).toEqual(["enviar_a_revision", "bloquear"]);
    expect(availableTeamActions("En revisión")).toEqual(["aprobar", "devolver", "bloquear"]);
    expect(availableTeamActions("Hecha")).toEqual([]);
    expect(availableTeamActions("Bloqueada")).toEqual(["desbloquear"]);
  });

  // `devolver` — el camino de vuelta de una entrega que no cumple su criterio.
  // Antes solo se podía aprobar o bloquear, y bloquear significa otra cosa.
  it("devolver exige decir QUÉ FALTA, igual que bloquear exige motivo", () => {
    expect(() => teamTransition(state("En revisión"), "devolver")).toThrow(BlockReasonRequiredError);
    expect(() => teamTransition(state("En revisión"), "devolver", "   ")).toThrow(BlockReasonRequiredError);
    // El mensaje habla de la entrega, no de la persona (doc 16).
    try {
      teamTransition(state("En revisión"), "devolver");
    } catch (e) {
      expect((e as Error).message).toMatch(/qué falta ajustar/i);
      expect((e as Error).message).not.toMatch(/desempeñ|rendimiento|mal|culpa/i);
    }
  });

  it("devolver lleva la pieza a 'En curso' y NO la deja marcada como bloqueada", () => {
    const out = teamTransition(state("En revisión"), "devolver", "falta el caso de wallet vacía");
    expect(out.status).toBe("En curso");
    // Clave: devolver ≠ bloquear. La pieza no está trabada, está en manos de quien
    // la entrega, así que no se contamina la lista de bloqueos del dashboard.
    expect(out.blockedReason).toBeNull();
    expect(out.statusBeforeBlock).toBeNull();
  });

  it("devolver y volver a entregar es un ciclo legal, sin saltos", () => {
    let s = state("En curso");
    s = teamTransition(s, "enviar_a_revision");
    expect(s.status).toBe("En revisión");
    s = teamTransition(s, "devolver", "falta el test de la carrera");
    expect(s.status).toBe("En curso");
    s = teamTransition(s, "enviar_a_revision");
    s = teamTransition(s, "aprobar");
    expect(s.status).toBe("Hecha");
    // Y desde Hecha ya no hay vuelta: cerrada es cerrada.
    expect(() => teamTransition(s, "devolver", "algo")).toThrow(InvalidTeamTransitionError);
  });

  it("no se puede devolver algo que nadie ha entregado todavía", () => {
    for (const s of ["Backlog", "Asignada", "En curso"] as const) {
      expect(() => teamTransition(state(s), "devolver", "motivo")).toThrow(InvalidTeamTransitionError);
    }
  });

  it("guardas de tipo y conjunto de estados abiertos", () => {
    expect(isTeamStatus("En curso")).toBe(true);
    expect(isTeamStatus("En Curso")).toBe(false);
    expect(isTeamStatus("Delivered")).toBe(false); // estado del Ágora, otra máquina
    expect(isTeamAction("bloquear")).toBe(true);
    expect(isTeamAction("distribute")).toBe(false);
    expect(OPEN_STATUSES).toEqual(["Backlog", "Asignada", "En curso", "En revisión"]);
    expect(isOpenStatus("Hecha")).toBe(false);
    expect(isOpenStatus("Bloqueada")).toBe(false);
  });

  it("ningún estado ni etiqueta habla del valor de una persona (doc 16)", () => {
    const vocabulario = [...TEAM_STATUSES, ...TEAM_ACTIONS].join(" ").toLowerCase();
    for (const prohibido of ["desempeño", "rendimiento", "cumplid", "incumpl", "vago", "lento", "culpa"]) {
      expect(vocabulario).not.toContain(prohibido);
    }
  });
});
