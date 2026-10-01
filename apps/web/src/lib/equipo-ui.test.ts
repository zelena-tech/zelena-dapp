/**
 * WP31-I2 · semáforos, progreso e insignias en la UI del equipo y en /perfil.
 *
 * Criterio I5 (estático): `/equipo/hoy`, `/equipo/proyectos/[slug]` y `/equipo/dashboard`
 * usan `SlaBadge`; `/equipo/hoy` y `/perfil` usan `Insignias`; ninguno contiene
 * "ranking" ni "posición"; `/perfil` usa `txVerificable`.
 *
 * Además: el texto del semáforo (§8.5) sale de `semaforo.ts`, puro y apto para cliente,
 * y habla de la entrega, nunca de la persona; las insignias nunca se muestran como algo
 * perdido y van con "Lo ganado no se quita."
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GENOME_DEFAULTS } from "./genome";
import { slaConfigDesdeGenoma, type SlaResultado } from "./sla";
import { instanteLocal } from "./zona-horaria";
import { FASE_LABEL, semaforo, textoQuedan } from "./semaforo";
import { insignias, textoInsignia } from "./gamificacion";

const WEB = process.cwd(); // apps/web
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

const HOY = "app/equipo/hoy/page.tsx";
const TABLERO = "app/equipo/proyectos/[slug]/page.tsx";
const PROYECTOS = "app/equipo/proyectos/page.tsx";
const DASHBOARD = "app/equipo/dashboard/page.tsx";
const PERFIL = "app/perfil/page.tsx";
const SLA_BADGE = "src/components/SlaBadge.tsx";
const INSIGNIAS = "src/components/Insignias.tsx";

/** Copy que no se escribe nunca en estas pantallas (doc 16, spec §8.8 y §5.C.1). */
const PROHIBIDO =
  /ranking|posición|atrasad|vas tarde|llegó tarde|bajo desempeño|\brojo\b|última conexión|horas trabajadas|perdiste|perdida|castigo|jornada/i;

describe("I5 · semáforos e insignias en las pantallas (estático)", () => {
  it("/equipo/hoy, el tablero y el dashboard pintan SlaBadge con el SLA de la base", () => {
    for (const r of [HOY, TABLERO, DASHBOARD]) {
      const src = leer(r);
      expect(src, r).toContain('import SlaBadge from "@/components/SlaBadge"');
      expect(src, r).toMatch(/<SlaBadge\s/);
    }
    // Hoy y el tablero evalúan sus piezas con `slaDeAsignaciones`; el dashboard, con `plazosDelEquipo`.
    expect(leer(HOY)).toContain("slaDeAsignaciones(");
    expect(leer(TABLERO)).toContain("slaDeAsignaciones(");
    expect(leer(DASHBOARD)).toContain("plazosDelEquipo(");
    expect(leer(PROYECTOS)).toContain("slaDeAsignaciones(");
  });

  it("/equipo/hoy y /perfil muestran Tu progreso con Insignias, metas del genoma y todas las identidades", () => {
    for (const r of [HOY, PERFIL]) {
      const src = leer(r);
      expect(src, r).toContain('import Insignias from "@/components/Insignias"');
      expect(src, r).toMatch(/<Insignias\s/);
      expect(src, r).toContain("senalesProgreso(");
      expect(src, r).toContain("progresoDeTareas(");
      expect(src, r).toContain(".BADGE_GOALS");
      expect(src, r).toContain("Esta temporada sumaste");
      expect(src, r).toContain("de reputación");
    }
  });

  it("ninguna de estas pantallas contiene «ranking» ni «posición», ni en comentarios (I5)", () => {
    for (const r of [HOY, TABLERO, PROYECTOS, DASHBOARD, PERFIL, SLA_BADGE, INSIGNIAS, "src/lib/semaforo.ts"]) {
      expect(leer(r), r).not.toMatch(/ranking|posición/i);
    }
  });

  // Las páginas existentes nombran lo que NO se hace ("ni última conexión"); lo nuevo de
  // este paquete (semáforo e insignias) no usa ese vocabulario en ninguna línea.
  it("el semáforo y las insignias no usan vocabulario sobre la persona", () => {
    for (const r of [SLA_BADGE, INSIGNIAS, "src/lib/semaforo.ts"]) {
      const lineas = leer(r)
        .split("\n")
        .map((l, i) => `${r}:${i + 1}: ${l.trim()}`)
        .filter((l) => PROHIBIDO.test(l));
      expect(lineas, r).toEqual([]);
    }
  });

  it("/perfil solo enlaza al explorador una transacción verificable y dice «proyecto», no «bounty»", () => {
    const src = leer(PERFIL);
    expect(src).toContain("txVerificable(");
    expect(src).toMatch(/cla\.tx_id && txVerificable\(cla\.tx_id\) \?/);
    expect(src).toContain("EXPLORADOR_TX");
    expect(src).not.toMatch(/stellar\.expert\/explorer\/testnet\/tx\/\$\{cla\.tx_id\}/);
    expect(src).not.toMatch(/bounty/i);
    expect(src).toContain("toma un proyecto del Ágora");
  });

  it("/perfil tiene el ancla #invitar del panel de miembros y el vacío de quien aún no tiene proyecto", () => {
    const src = leer(PERFIL);
    expect(src).toContain('id="invitar"');
    expect(leer("src/components/TeamMembersPanel.tsx")).toContain("/perfil#invitar");
    expect(src).toContain("equipoActor(session, db)");
    expect(src).toContain("Todavía no estás en ningún proyecto.");
    expect(src).toContain("firmar el acuerdo de contribución");
  });

  it("Publicar en el Ágora: solo founder o supervisión, en Backlog sin responsable ni publicar, y solo si la página existe", () => {
    const src = leer(TABLERO);
    expect(src).toContain("PUBLICAR_DISPONIBLE &&");
    expect(src).toMatch(/esGlobal && a\.status === "Backlog" && !a\.owner_wallet && !a\.published_as_project_id/);
    expect(src).toContain("rutaPublicar(a.id)");
  });
});

describe("límite cliente/servidor de lo nuevo", () => {
  it("semaforo.ts solo importa de sla.ts (puro); SlaBadge e Insignias no tocan base, sesión ni node:", () => {
    const sem = leer("src/lib/semaforo.ts");
    const imports = sem.match(/^import .* from "([^"]+)";$/gm) ?? [];
    expect(imports.map((l) => l.replace(/^.* from "([^"]+)";$/, "$1"))).toEqual(["./sla.ts"]);
    for (const r of [SLA_BADGE, INSIGNIAS, "src/lib/semaforo.ts"]) {
      const src = leer(r);
      expect(src, r).not.toMatch(/from "(@\/lib\/|\.\/|\.\.\/)*(db|crypto|session|jwt)(\.ts)?"/);
      expect(src, r).not.toMatch(/from "node:/);
      expect(src, r).not.toContain("getDb(");
    }
  });
});

describe("texto del semáforo (§8.5)", () => {
  const c = slaConfigDesdeGenoma(GENOME_DEFAULTS);
  // Miércoles 2026-07-29 a las 15:00 de Bogotá.
  const AHORA = instanteLocal("2026-07-29", "15:00", c.tz);
  const r = (o: Partial<SlaResultado>): SlaResultado => ({
    fase: "entrega",
    vence: null,
    estado: "a_tiempo",
    horasRestantes: null,
    respondida: true,
    ...o,
  });

  it("A tiempo · vence vie 16:00 (mañana, día de la semana o fecha)", () => {
    const s = semaforo(r({ vence: instanteLocal("2026-07-30", "14:00", c.tz), horasRestantes: 9 }), AHORA, c);
    expect(s.texto).toBe("A tiempo · vence mañana 14:00");
    const jueves = semaforo(r({ vence: instanteLocal("2026-08-06", "14:00", c.tz), horasRestantes: 50 }), AHORA, c);
    expect(jueves.texto).toBe("A tiempo · vence 6 ago 14:00");
    const enDosDias = semaforo(r({ vence: instanteLocal("2026-07-31", "16:00", c.tz), horasRestantes: 20 }), AHORA, c);
    expect(enDosDias.texto).toBe("A tiempo · vence vie 16:00");
    expect(enDosDias.estado).toBe("a_tiempo");
    expect(enDosDias.fase).toBe(FASE_LABEL.entrega);
  });

  it("Por vencer · quedan 3 h hábiles", () => {
    const s = semaforo(
      r({ estado: "por_vencer", vence: instanteLocal("2026-07-29", "18:00", c.tz), horasRestantes: 3 }),
      AHORA,
      c
    );
    expect(s.texto).toBe("Por vencer · quedan 3 h hábiles");
    expect(s.etiqueta).toBe("Por vencer");
    expect(s.detalle).toBe("quedan 3 h hábiles");
  });

  it("Vencida · desde ayer 18:00 (y la fase dice qué plazo corre)", () => {
    const s = semaforo(
      r({ estado: "vencida", fase: "revision", vence: instanteLocal("2026-07-28", "18:00", c.tz), horasRestantes: 0 }),
      AHORA,
      c
    );
    expect(s.texto).toBe("Vencida · desde ayer 18:00");
    expect(s.fase).toBe("Plazo de revisión");
  });

  it("Sin plazo, también sin resultado o sin vencimiento", () => {
    expect(semaforo(r({ estado: "sin_plazo", fase: null }), AHORA, c).texto).toBe("Sin plazo");
    expect(semaforo(undefined, AHORA, c).texto).toBe("Sin plazo");
    expect(semaforo(null, AHORA, c).estado).toBe("sin_plazo");
    expect(semaforo(r({ estado: "vencida", vence: null }), AHORA, c).texto).toBe("Sin plazo");
    expect(semaforo(r({ vence: new Date(NaN) }), AHORA, c).fase).toBeNull();
  });

  it("lo que queda nunca se exagera: horas enteras hacia abajo y minutos bajo una hora", () => {
    expect(textoQuedan(3)).toBe("quedan 3 h hábiles");
    expect(textoQuedan(3.9)).toBe("quedan 3 h hábiles");
    expect(textoQuedan(1.5)).toBe("queda 1 h hábil");
    expect(textoQuedan(0.5)).toBe("quedan 30 min hábiles");
    expect(textoQuedan(0.01)).toBe("queda 1 min hábil");
    expect(textoQuedan(0)).toBe("queda 1 min hábil");
    expect(textoQuedan(Number.NaN)).toBe("queda 1 min hábil");
  });

  it("ningún texto del semáforo habla de la persona", () => {
    const textos = [
      semaforo(r({ estado: "vencida", vence: instanteLocal("2026-07-20", "18:00", c.tz) }), AHORA, c).texto,
      semaforo(r({ estado: "por_vencer", vence: AHORA, horasRestantes: 0.2 }), AHORA, c).texto,
      semaforo(r({ vence: instanteLocal("2026-09-01", "18:00", c.tz) }), AHORA, c).texto,
    ];
    for (const t of textos) expect(t).not.toMatch(PROHIBIDO);
  });
});

describe("insignias en pantalla (§5.B.4)", () => {
  it("una no obtenida es «4 de 10», nunca perdida; Insignias.tsx lleva «Lo ganado no se quita.»", () => {
    const lista = insignias(
      { entregasAprobadas: 4, entregasATiempo: 0, entregasL: 1, revisionesHechas: 0, ritosAsistidos: 0, ritosAnfitrion: 0 },
      GENOME_DEFAULTS.BADGE_GOALS
    );
    const textos = lista.map(textoInsignia);
    expect(textos).toContain("Primera entrega · conseguida");
    expect(textos).toContain("Diez entregas · 4 de 10");
    expect(textos).toContain("Pieza grande · conseguida");
    for (const t of textos) expect(t).not.toMatch(PROHIBIDO);
    const src = leer(INSIGNIAS);
    expect(src).toContain('"Lo ganado no se quita."');
    expect(src).toContain("textoInsignia(i)");
    expect(src).not.toMatch(/sort\(/); // el orden es el del catálogo, no un ranking
  });
});
