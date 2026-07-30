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
} from "./roles";

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
