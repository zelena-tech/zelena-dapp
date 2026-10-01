/**
 * WP14: roles del roster y regla ÚNICA de visibilidad (`puedeVerTodoElEquipo`),
 * que WP15 (dashboard) y WP19 (bot) deben consumir tal cual.
 *
 * El punto fino que este test protege: supervisor NO es un valor de `role`.
 * Plano 07 §5 — John `founder`; Vale, Juan, David, Fausto y Angela `core`;
 * supervisores del dashboard = John + Vale. Vale es `core` Y supervisora.
 */
import { describe, it, expect } from "vitest";
import {
  ROLES,
  ROLE_LABEL,
  TEAM_ROSTER,
  effectiveIsSupervisor,
  effectiveRole,
  findRosterMember,
  isPendingPrincipal,
  isRole,
  pendingPrincipal,
  puedeVerTodoElEquipo,
  rosterByPrincipal,
  MOTIVO_TRANSICION,
  ROLES_PROYECTO,
  ROL_PROYECTO_LABEL,
  SIN_PERMISOS,
  isRolProyecto,
  permisosEnProyecto,
  puedeTransicionar,
  rolesQuePuedeConceder,
  type PermisosProyecto,
  type RolProyecto,
  type TransicionInput,
} from "./roles";
import { TEAM_ACTIONS } from "./team-state-machine";

describe("roles y roster del equipo (WP14 / plano 07)", () => {
  it("los roles son exactamente los de WP13 y 'supervisor' NO es uno de ellos", () => {
    expect([...ROLES]).toEqual(["founder", "core", "contributor"]);
    expect(isRole("supervisor")).toBe(false);
    expect(Object.keys(ROLE_LABEL).sort()).toEqual(["contributor", "core", "founder"]);
  });

  it("el roster es el del plano 07 §5: 6 personas, John founder, el resto core", () => {
    expect(TEAM_ROSTER).toHaveLength(6);
    expect(TEAM_ROSTER.map((m) => m.slug)).toEqual(["john", "vale", "juan", "david", "fausto", "angela"]);
    const john = TEAM_ROSTER.find((m) => m.slug === "john")!;
    expect(john.role).toBe("founder");
    for (const slug of ["vale", "juan", "david", "fausto", "angela"]) {
      expect(TEAM_ROSTER.find((m) => m.slug === slug)!.role).toBe("core");
    }
  });

  it("los supervisores del dashboard son John y Vale — y Vale sigue siendo `core`", () => {
    const supervisores = TEAM_ROSTER.filter((m) => m.isSupervisor).map((m) => m.slug);
    expect(supervisores).toEqual(["john", "vale"]);
    const vale = TEAM_ROSTER.find((m) => m.slug === "vale")!;
    expect(vale.role).toBe("core");
    expect(vale.isSupervisor).toBe(true);
  });

  it("el principal placeholder es determinista y no contiene datos personales", () => {
    expect(pendingPrincipal("fausto")).toBe("pending:fausto");
    expect(pendingPrincipal("fausto")).toBe(pendingPrincipal("fausto"));
    expect(isPendingPrincipal("pending:fausto")).toBe(true);
    expect(isPendingPrincipal("GA7ZELENAFOUNDER")).toBe(false);
    expect(isPendingPrincipal(null)).toBe(false);
    // Ni correos ni apellidos en ningún campo del roster.
    const dump = JSON.stringify(TEAM_ROSTER);
    expect(dump).not.toMatch(/@/);
  });

  it("resuelve los Assignee de los CSV reales (incluido 'Ángela' con acento)", () => {
    expect(findRosterMember("Fausto")!.slug).toBe("fausto");
    expect(findRosterMember("  john  ")!.slug).toBe("john");
    expect(findRosterMember("DAVID")!.slug).toBe("david");
    expect(findRosterMember("Ángela")!.slug).toBe("angela");
    expect(findRosterMember("Angela")!.slug).toBe("angela");
    expect(findRosterMember("Delina")).toBeUndefined(); // cohorte demo, no es del equipo
    expect(findRosterMember("")).toBeUndefined();
  });

  it("rosterByPrincipal invierte el mapeo", () => {
    expect(rosterByPrincipal("pending:vale")!.name).toBe("Vale");
    expect(rosterByPrincipal("pending:nadie")).toBeUndefined();
    expect(rosterByPrincipal("GWALLET")).toBeUndefined();
  });

  it("fallback retrocompatible: una sesión sin `role` se deriva de isFounder", () => {
    expect(effectiveRole({ isFounder: true })).toBe("founder");
    expect(effectiveRole({ isFounder: false })).toBe("contributor");
    expect(effectiveRole({})).toBe("contributor");
    expect(effectiveRole({ role: "core", isFounder: false })).toBe("core");
    // Un valor basura en la cookie no concede nada: cae al fallback.
    expect(effectiveRole({ role: "supervisor", isFounder: false })).toBe("contributor");
    expect(effectiveIsSupervisor({ isFounder: true })).toBe(true);
    expect(effectiveIsSupervisor({ isFounder: false })).toBe(false);
    expect(effectiveIsSupervisor({ isSupervisor: true, isFounder: false })).toBe(true);
  });

  it("puedeVerTodoElEquipo: founder y supervisores sí; core y contributor no", () => {
    expect(puedeVerTodoElEquipo({ role: "founder", isSupervisor: false })).toBe(true);
    expect(puedeVerTodoElEquipo({ role: "core", isSupervisor: true })).toBe(true); // Vale
    expect(puedeVerTodoElEquipo({ role: "core", isSupervisor: false })).toBe(false); // Fausto
    expect(puedeVerTodoElEquipo({ role: "contributor", isSupervisor: false })).toBe(false);
    // Sesión vieja sin claims: solo el founder ve todo.
    expect(puedeVerTodoElEquipo({ isFounder: true })).toBe(true);
    expect(puedeVerTodoElEquipo({ isFounder: false })).toBe(false);
    expect(puedeVerTodoElEquipo({})).toBe(false);
  });

  it("el roster completo se clasifica correctamente por la regla de visibilidad", () => {
    const veTodo = TEAM_ROSTER.filter((m) => puedeVerTodoElEquipo(m)).map((m) => m.slug);
    expect(veTodo).toEqual(["john", "vale"]);
  });
});

// ---------------------------------------------------------------------------
// WP31 · criterio A2 — roles por proyecto, cuatro ojos y quién concede qué
// ---------------------------------------------------------------------------

const P = (ver: boolean, crear: boolean, planificar: boolean, revisar: boolean, tomar: boolean): PermisosProyecto => ({
  ver,
  crear,
  planificar,
  revisar,
  tomar,
});
const TODO = P(true, true, true, true, true);
const NADA = P(false, false, false, false, false);

describe("WP31 · permisosEnProyecto (tabla completa de §5.A.1)", () => {
  const FOUNDER = { role: "founder" as const, isSupervisor: false };
  const SUPERVISORA = { role: "core" as const, isSupervisor: true };
  const CORE = { role: "core" as const, isSupervisor: false };
  const CONTRIB = { role: "contributor" as const, isSupervisor: false };

  it("los roles de proyecto son exactamente cuatro, con su etiqueta", () => {
    expect([...ROLES_PROYECTO]).toEqual(["estructura", "ejecuta", "revisa", "vende"]);
    expect(ROL_PROYECTO_LABEL).toEqual({ estructura: "Estructura", ejecuta: "Ejecuta", revisa: "Revisa", vende: "Vende" });
    expect(isRolProyecto("revisa")).toBe(true);
    expect(isRolProyecto("supervisor")).toBe(false);
    expect(isRolProyecto(null)).toBe(false);
  });

  it("founder o supervisor: todo, con o sin roles", () => {
    expect(permisosEnProyecto(FOUNDER, [])).toEqual(TODO);
    expect(permisosEnProyecto(SUPERVISORA, [])).toEqual(TODO);
    expect(permisosEnProyecto({ role: "contributor", isSupervisor: true }, [])).toEqual(TODO);
  });

  it("core sin roles: ver, crear y tomar; ni planifica ni revisa", () => {
    expect(permisosEnProyecto(CORE, [])).toEqual(P(true, true, false, false, true));
  });

  it("contributor sin roles: nada", () => {
    expect(permisosEnProyecto(CONTRIB, [])).toEqual(NADA);
    expect(SIN_PERMISOS).toEqual(NADA);
  });

  it("cada rol da su fila (contributor, para aislarla)", () => {
    expect(permisosEnProyecto(CONTRIB, ["estructura"])).toEqual(TODO);
    expect(permisosEnProyecto(CONTRIB, ["ejecuta"])).toEqual(P(true, true, false, false, true));
    expect(permisosEnProyecto(CONTRIB, ["revisa"])).toEqual(P(true, false, false, true, false));
    expect(permisosEnProyecto(CONTRIB, ["vende"])).toEqual(P(true, false, false, false, false));
  });

  it("varias filas se suman (OR): ejecuta + revisa, core + revisa", () => {
    expect(permisosEnProyecto(CONTRIB, ["ejecuta", "revisa"])).toEqual(P(true, true, false, true, true));
    expect(permisosEnProyecto(CORE, ["revisa"])).toEqual(P(true, true, false, true, true));
    expect(permisosEnProyecto(CORE, ["vende"])).toEqual(P(true, true, false, false, true));
  });

  it("un valor basura en la lista de roles no concede nada", () => {
    expect(permisosEnProyecto(CONTRIB, ["supervisor" as RolProyecto])).toEqual(NADA);
  });
});

describe("WP31 · puedeTransicionar (flags y orden de los motivos)", () => {
  const revisor = P(true, false, false, true, false);
  const planificador = TODO;
  const ejecutor = P(true, true, false, false, true);
  const base = (o: Partial<TransicionInput>): TransicionInput => ({
    accion: "aprobar",
    esDueno: false,
    sinDueno: false,
    permisos: revisor,
    ...o,
  });

  for (const accion of ["aprobar", "devolver"] as const) {
    describe(accion, () => {
      it("otra persona con permiso de revisar puede", () => {
        expect(puedeTransicionar(base({ accion }))).toEqual({ ok: true });
      });

      it("el dueño nunca, aunque planifique (el motivo del dueño va primero)", () => {
        expect(puedeTransicionar(base({ accion, esDueno: true, permisos: planificador, esGlobal: true }))).toEqual({
          ok: false,
          motivo: MOTIVO_TRANSICION.dueno,
        });
        // Con TODOS los flags activos, gana el motivo del dueño.
        expect(
          puedeTransicionar(
            base({
              accion,
              esDueno: true,
              esQuienEnvio: true,
              vinculoInvitacion: true,
              duenoPendiente: true,
              permisos: NADA,
            })
          )
        ).toEqual({ ok: false, motivo: MOTIVO_TRANSICION.dueno });
      });

      it("quien la envió a revisión tampoco (segundo motivo), aunque sea global", () => {
        expect(
          puedeTransicionar(base({ accion, esQuienEnvio: true, vinculoInvitacion: true, duenoPendiente: true, permisos: NADA }))
        ).toEqual({ ok: false, motivo: MOTIVO_TRANSICION.envio });
        expect(puedeTransicionar(base({ accion, esQuienEnvio: true, permisos: planificador, esGlobal: true }))).toEqual({
          ok: false,
          motivo: MOTIVO_TRANSICION.envio,
        });
      });

      it("B8: con relación de invitación tampoco (tercer motivo)", () => {
        expect(puedeTransicionar(base({ accion, vinculoInvitacion: true, duenoPendiente: true, permisos: NADA }))).toEqual({
          ok: false,
          motivo: MOTIVO_TRANSICION.invitacion,
        });
      });

      it("dueño pending sin vincular: solo founder o supervisor (cuarto motivo)", () => {
        expect(puedeTransicionar(base({ accion, duenoPendiente: true, permisos: NADA }))).toEqual({
          ok: false,
          motivo: MOTIVO_TRANSICION.pendiente,
        });
        expect(puedeTransicionar(base({ accion, duenoPendiente: true }))).toEqual({
          ok: false,
          motivo: MOTIVO_TRANSICION.pendiente,
        });
        expect(puedeTransicionar(base({ accion, duenoPendiente: true, esGlobal: true, permisos: planificador }))).toEqual({
          ok: true,
        });
      });

      it("sin permiso de revisar: la revisión es de quien revisa o estructura (último motivo)", () => {
        expect(puedeTransicionar(base({ accion, permisos: ejecutor }))).toEqual({
          ok: false,
          motivo: MOTIVO_TRANSICION.revision,
        });
      });
    });
  }

  describe("asignar", () => {
    it("pieza sin dueño: con tomar o planificar", () => {
      expect(puedeTransicionar({ accion: "asignar", esDueno: false, sinDueno: true, permisos: ejecutor })).toEqual({ ok: true });
      expect(
        puedeTransicionar({ accion: "asignar", esDueno: false, sinDueno: true, permisos: P(true, false, true, false, false) })
      ).toEqual({ ok: true });
      expect(puedeTransicionar({ accion: "asignar", esDueno: false, sinDueno: true, permisos: revisor })).toEqual({
        ok: false,
        motivo: MOTIVO_TRANSICION.tomar,
      });
      expect(puedeTransicionar({ accion: "asignar", esDueno: false, sinDueno: true, permisos: NADA })).toEqual({
        ok: false,
        motivo: MOTIVO_TRANSICION.tomar,
      });
    });

    it("pieza con responsable: nadie más la toma (el dueño o quien planifica la pasa a Asignada)", () => {
      expect(puedeTransicionar({ accion: "asignar", esDueno: false, sinDueno: false, permisos: ejecutor })).toEqual({
        ok: false,
        motivo: MOTIVO_TRANSICION.conDueno,
      });
      expect(puedeTransicionar({ accion: "asignar", esDueno: true, sinDueno: false, permisos: NADA })).toEqual({ ok: true });
      expect(puedeTransicionar({ accion: "asignar", esDueno: false, sinDueno: false, permisos: planificador })).toEqual({
        ok: true,
      });
    });
  });

  for (const accion of ["empezar", "enviar_a_revision", "bloquear", "desbloquear"] as const) {
    it(accion + ": el dueño o quien planifica", () => {
      expect(puedeTransicionar({ accion, esDueno: true, sinDueno: false, permisos: NADA })).toEqual({ ok: true });
      expect(puedeTransicionar({ accion, esDueno: false, sinDueno: false, permisos: planificador })).toEqual({ ok: true });
      expect(puedeTransicionar({ accion, esDueno: false, sinDueno: false, permisos: ejecutor })).toEqual({
        ok: false,
        motivo: MOTIVO_TRANSICION.mover,
      });
      expect(puedeTransicionar({ accion, esDueno: false, sinDueno: false, permisos: revisor })).toEqual({
        ok: false,
        motivo: MOTIVO_TRANSICION.mover,
      });
    });
  }

  it("cubre todas las acciones de la máquina de estados: sin permisos, ninguna pasa", () => {
    for (const accion of TEAM_ACTIONS) {
      const r = puedeTransicionar({ accion, esDueno: false, sinDueno: false, permisos: NADA });
      expect(r.ok, accion).toBe(false);
    }
  });

  it("los motivos hablan de la entrega, nunca juzgan a la persona", () => {
    const texto = Object.values(MOTIVO_TRANSICION).join(" ").toLowerCase();
    for (const prohibido of ["desempeño", "ranking", "castigo", "atrasad", "jornada"]) {
      expect(texto).not.toContain(prohibido);
    }
  });
});

describe("WP31 · rolesQuePuedeConceder", () => {
  it("founder y supervisor: los cuatro", () => {
    expect(rolesQuePuedeConceder({ role: "founder", isSupervisor: false }, [])).toEqual([...ROLES_PROYECTO]);
    expect(rolesQuePuedeConceder({ role: "core", isSupervisor: true }, [])).toEqual([...ROLES_PROYECTO]);
  });

  it("estructura sin supervisión: solo ejecuta y vende (los que dan revisión, nunca)", () => {
    expect(rolesQuePuedeConceder({ role: "contributor", isSupervisor: false }, ["estructura"])).toEqual(["ejecuta", "vende"]);
    expect(rolesQuePuedeConceder({ role: "core", isSupervisor: false }, ["estructura", "revisa"])).toEqual([
      "ejecuta",
      "vende",
    ]);
  });

  it("sin estructura: ninguno (ni un core ni un revisa)", () => {
    expect(rolesQuePuedeConceder({ role: "core", isSupervisor: false }, [])).toEqual([]);
    expect(rolesQuePuedeConceder({ role: "contributor", isSupervisor: false }, ["revisa", "ejecuta", "vende"])).toEqual([]);
  });
});
