import { describe, it, expect } from "vitest";
import {
  transition,
  canTransition,
  nextAction,
  InvalidTransitionError,
  PROJECT_STATES,
  type ProjectAction,
} from "./state-machine";

describe("máquina de estados de proyectos", () => {
  it("recorre la secuencia completa sin saltos", () => {
    let s = transition("Open", "assign");
    expect(s).toBe("Assigned");
    s = transition(s, "deliver");
    expect(s).toBe("Delivered");
    s = transition(s, "score");
    expect(s).toBe("Scored");
    s = transition(s, "distribute");
    expect(s).toBe("Distributed");
  });

  const invalid: Array<[(typeof PROJECT_STATES)[number], ProjectAction]> = [
    ["Open", "deliver"],
    ["Open", "score"],
    ["Open", "distribute"],
    ["Assigned", "assign"],
    ["Assigned", "score"],
    ["Delivered", "assign"],
    ["Delivered", "distribute"],
    ["Scored", "deliver"],
    ["Distributed", "distribute"],
    ["Distributed", "assign"],
  ];

  it("rechaza el 100% de las transiciones inválidas de la tabla", () => {
    for (const [state, action] of invalid) {
      expect(canTransition(state, action)).toBe(false);
      expect(() => transition(state, action)).toThrow(InvalidTransitionError);
    }
  });

  it("nextAction devuelve la acción correcta y null en el estado final", () => {
    expect(nextAction("Open")).toBe("assign");
    expect(nextAction("Assigned")).toBe("deliver");
    expect(nextAction("Delivered")).toBe("score");
    expect(nextAction("Scored")).toBe("distribute");
    expect(nextAction("Distributed")).toBeNull();
  });
});
