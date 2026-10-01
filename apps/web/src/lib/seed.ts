/**
 * Seed idempotente: solo corre si la tabla users está vacía. Crea el founder,
 * 6 invitaciones GENESIS, el periodo Génesis, las 2 campañas (5 proyectos) con
 * sus hitos exactos, decision log, la votación de ratificación, la Academia y
 * una cohorte demo para que las stats y perfiles tengan vida.
 */
import type { DB } from "./db"; // solo tipo: sin ciclo en runtime
import { sha256Hex } from "./crypto";
import { FOUNDER_WALLET, BOOTSTRAP_CODE_MAX, BOOTSTRAP_CODE_MIN, bootstrapInviteCode } from "./config";
import { GENOME_V1, seedGenomeV1 } from "./genome";
import { seedTeam } from "./team";
import { createCohortInvite } from "./invites";
import { ACADEMIA_S1, aplicarContenidoPublico } from "./contenido-publico";

const DELINA = "GDELINACONTRIBUTORDEMOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MARCOS = "GMARCOSDEVDEMOBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const SOFIA = "GSOFIADESIGNDEMOCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

/**
 * ¿Se pueden sembrar las invitaciones de demostración?
 *
 * Los códigos `GENESIS-0001..0006` son PREDECIBLES y están publicados en el README y
 * en CLAUDE.md como credencial de demo. En una URL pública eso es una puerta abierta:
 * cualquiera con el enlace y un código sin usar se crea una cuenta. Por eso en
 * producción NO se siembran, salvo que se pida explícitamente con `SEED_DEMO=1`
 * (útil para un entorno de demostración deliberado, nunca para el interno).
 *
 * El resto del seed (época, genoma v1, founder, decision log, Academia) sí corre:
 * es el bootstrap que la app necesita para arrancar, y no concede acceso a nadie.
 */
export function demoInvitesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SEED_DEMO === "1") return true;
  return env.NODE_ENV !== "production";
}

// La función vive en config.ts (módulo hoja) porque la necesitan DOS caminos: el
// seed que siembra la invitación y `performOnboard`, que al consumirla debe dar el
// rol de founder. Se re-exporta aquí para no romper importaciones existentes.
export { bootstrapInviteCode };

/** Las 6 invitaciones demo del seed. Exactas: /admin genera códigos reales con el MISMO prefijo. */
export const DEMO_INVITE_CODES: readonly string[] = Array.from(
  { length: 6 },
  (_, i) => "GENESIS-" + String(i + 1).padStart(4, "0")
);

/**
 * Vence las invitaciones demo `GENESIS-0001..0006` que sigan sin usar cuando el
 * entorno no las permite (producción sin `SEED_DEMO=1`). Devuelve cuántas venció.
 *
 * `demoInvitesAllowed` solo evitaba SEMBRARLAS: una base que ya las tenía (la de
 * producción las tiene, sembradas antes de esa guarda) las conservaba vivas, y los
 * códigos están publicados. Se VENCEN (`expires_at = ahora`), no se borran: la
 * fila queda como historia y se puede revisar. Solo esos seis códigos exactos: un
 * `LIKE 'GENESIS-%'` vencería también las invitaciones reales emitidas desde
 * /admin, que usan el mismo prefijo. Las ya usadas no se tocan (no sirven para
 * entrar). Idempotente: corre en cada arranque desde `seedIfEmpty`.
 */
export function retirarInvitacionesDemo(db: DB, env: NodeJS.ProcessEnv = process.env): number {
  if (demoInvitesAllowed(env)) return 0;
  const marcas = DEMO_INVITE_CODES.map(() => "?").join(", ");
  const r = db
    .prepare(
      `UPDATE invites SET expires_at = datetime('now')
        WHERE code IN (${marcas}) AND used_by IS NULL AND max_uses IS NULL
          AND expires_at > datetime('now')`
    )
    .run(...DEMO_INVITE_CODES);
  const n = Number(r.changes);
  if (n > 0) console.info(`[seed] ${n} invitación(es) demo GENESIS-000x vencidas: están publicadas.`);
  return n;
}

export function seedIfEmpty(db: DB, env: NodeJS.ProcessEnv = process.env): void {
  const has = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  if (has.n === 0) {
    const tx = db.transaction(() => seed(db, env));
    tx();
  }
  // Invitaciones demo publicadas: en producción, las que existan se vencen (no
  // basta con no sembrarlas). Va fuera del `if` por la misma razón que la escotilla.
  retirarInvitacionesDemo(db, env);
  // Roster real del equipo + iniciativas (WP14). A diferencia del seed de la cohorte
  // demo, esto SÍ corre en cada arranque porque es idempotente: los 6 del plano 07
  // deben existir con su principal `pending:<slug>` aunque la base ya tenga usuarios
  // (WP13 vinculará su identidad real). No escribe correos ni datos personales.
  const txTeam = db.transaction(() => seedTeam(db));
  txTeam();

  // Escotilla de arranque. Va FUERA del `if (users vacía)` a propósito: así funciona
  // aunque configures la variable después del primer arranque. Es idempotente y no
  // resucita el código una vez consumido (la fila sigue ahí con `used_by`).
  seedBootstrapInvite(db, env);

  // Código de cohorte: también en cada arranque (idempotente), pero SOLO con
  // `SEED_COHORT=1`. Va después de todo lo demás y fuera de `seed()`.
  seedCohortInvite(db, env);

  // Contenido público (WP31-E2): lleva una base con el contenido viejo a la forma que
  // `seed()` siembra hoy. Idempotente; si falla, el arranque sigue y se reintenta.
  try { aplicarContenidoPublico(db); } catch (e) { console.error("[seed] contenido público", e); }
}

/**
 * Siembra la invitación de arranque del founder si está configurada y no existe.
 * El código se guarda normalizado (mayúsculas, ver `bootstrapInviteCode`) porque así
 * lo envía /entrar. Vence a los 7 días de sembrarse y nunca se resucita: si venció o
 * ya se usó, hace falta un valor NUEVO de FOUNDER_BOOTSTRAP_CODE y reiniciar.
 */
export function seedBootstrapInvite(db: DB, env: NodeJS.ProcessEnv = process.env): void {
  const raw = (env.FOUNDER_BOOTSTRAP_CODE ?? "").trim();
  if (!raw) return;
  const code = bootstrapInviteCode(env);
  if (!code) {
    // Ruidoso a propósito: una variable mal puesta no debe fallar en silencio.
    console.warn(
      `[seed] FOUNDER_BOOTSTRAP_CODE ignorado: necesita entre ${BOOTSTRAP_CODE_MIN} y ${BOOTSTRAP_CODE_MAX} ` +
        `caracteres (menos es adivinable; más no cabe en el campo de /entrar).`
    );
    return;
  }
  const exists = db.prepare(`SELECT code FROM invites WHERE code = ?`).get(code);
  if (exists) return; // ya sembrada (usada o no): nunca se resucita
  db.prepare(
    `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES (?, ?, datetime('now','+7 days'))`
  ).run(code, FOUNDER_WALLET);
}

/**
 * Código de cohorte de la especialización: un solo código para decenas de
 * personas (QR proyectado en clase → /entrar?code=ESPECIALIZACION-2026).
 *
 * Es PREDECIBLE y admite cientos de cupos: la misma objeción que GENESIS. Por
 * eso se conserva el código, pero SOLO se siembra si se pide explícitamente con
 * `SEED_COHORT=1` en App Settings (decisión del líder, fusión v1). Sin la
 * variable, una base nueva no tiene puerta de cohorte; una base que ya la tenga
 * la conserva tal cual (no se borra ni se reinician sus `uses`).
 */
export const COHORT_CODE = "ESPECIALIZACION-2026";
/**
 * Cupos con holgura deliberada: una cohorte de ~150 personas consume MÁS de un
 * cupo por persona (pestaña privada, cambio de teléfono, almacenamiento borrado,
 * reintentos). Igualar cupos y asistentes deja a los últimos fuera.
 */
const COHORT_MAX_USES_DEFAULT = 400;
const COHORT_EXPIRES_DAYS_DEFAULT = 45;

/** ¿Se siembra el código de cohorte? Solo con `SEED_COHORT=1`. */
export function cohortSeedAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEED_COHORT === "1";
}

/**
 * Idempotente (INSERT OR IGNORE, nunca reinicia `uses`). Corre en cada arranque
 * desde `seedIfEmpty`, detrás de `cohortSeedAllowed`. Ojo: `createCohortInvite` solo
 * puede AMPLIAR cupos y plazo, así que cada arranque con `SEED_COHORT=1` lleva el
 * vencimiento a hoy + 45 días. Sin la variable no se toca: la fila que ya exista
 * sigue valiendo hasta su `expires_at` (cerrarla es un UPDATE, ver DESPLIEGUE-V1).
 */
export function seedCohortInvite(db: DB, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!cohortSeedAllowed(env)) return false;
  createCohortInvite(db, {
    code: COHORT_CODE,
    issuerWallet: FOUNDER_WALLET,
    maxUses: Number(env.COHORT_MAX_USES ?? COHORT_MAX_USES_DEFAULT),
    expiresDays: Number(env.COHORT_EXPIRES_DAYS ?? COHORT_EXPIRES_DAYS_DEFAULT),
  });
  return true;
}

function seed(db: DB, env: NodeJS.ProcessEnv = process.env): void {
  // ---- Periodo Génesis (presupuestos = genoma v1) ----
  db.prepare(
    `INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'Época Génesis', ?, ?, 'Open')`
  ).run(GENOME_V1.EPOCH_BUDGET, GENOME_V1.ACADEMIA_BUDGET);

  // ---- Usuarios ----
  // role/is_supervisor (WP14) se derivan de is_founder: el founder es `founder` y
  // supervisor; la cohorte demo de comunidad es `contributor` (los valores default).
  const insUser = db.prepare(
    `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor)
     VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`
  );
  insUser.run(FOUNDER_WALLET, "John (Founder)", "Gold", null, 1, 1, "founder", 1);
  insUser.run(DELINA, "Delina", "Silver", FOUNDER_WALLET, 1, 0, "contributor", 0);
  insUser.run(MARCOS, "Marcos", "Bronze", FOUNDER_WALLET, 1, 0, "contributor", 0);
  insUser.run(SOFIA, "Sofía", "Bronze", FOUNDER_WALLET, 1, 0, "contributor", 0);

  // ---- Invitaciones GENESIS (6, del founder, sin usar) ----
  // Códigos PREDECIBLES y publicados en los docs: nunca en producción (ver
  // `demoInvitesAllowed`). El founder genera invitaciones reales desde /admin.
  if (demoInvitesAllowed(env)) {
    const insInvite = db.prepare(
      `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES (?, ?, datetime('now','+30 days'))`
    );
    for (const code of DEMO_INVITE_CODES) insInvite.run(code, FOUNDER_WALLET);
  }

  // ---- CLA signatures ----
  const claText = "Zelena CLA v1 canonical"; // referencia; el hash real lo calcula el cliente
  const insCla = db.prepare(
    `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature, anchor_status, tx_id)
     VALUES (?, 1, ?, ?, ?, ?)`
  );
  insCla.run(FOUNDER_WALLET, sha256Hex(claText + FOUNDER_WALLET), "seed-sig-founder", "anchored", "SEEDTX_FOUNDER_ANCHORED_0001");
  insCla.run(DELINA, sha256Hex(claText + DELINA), "seed-sig-delina", "anchored", "SEEDTX_DELINA_ANCHORED_0002");
  insCla.run(MARCOS, sha256Hex(claText + MARCOS), "seed-sig-marcos", "pending", null);
  insCla.run(SOFIA, sha256Hex(claText + SOFIA), "seed-sig-sofia", "pending", null);
  db.prepare(
    `INSERT INTO anchor_queue (kind, ref, data_key, payload_hash, status, tx_id)
     VALUES ('cla', ?, ?, ?, 'pending', NULL)`
  ).run(MARCOS, "cla:v1:" + MARCOS.slice(0, 12), sha256Hex(claText + MARCOS));

  // ---- Proyectos + hitos ----
  const insProject = db.prepare(
    `INSERT INTO projects (campaign, title, type, budget_usd, weeks, state, supervisor_wallet, summary, description, acceptance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insMs = db.prepare(
    `INSERT INTO milestones (project_id, ord, code, name, week, pct, amount_usd) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const addProject = (
    p: {
      campaign: string;
      title: string;
      type: string;
      budget: number;
      weeks: number;
      summary: string;
      description: string;
      acceptance: string;
      state?: string;
    },
    ms: Array<[string, string, string, number, number]>
  ) => {
    const info = insProject.run(
      p.campaign,
      p.title,
      p.type,
      p.budget,
      p.weeks,
      p.state ?? "Open",
      FOUNDER_WALLET,
      p.summary,
      p.description,
      p.acceptance
    );
    const pid = info.lastInsertRowid as number;
    ms.forEach((m, i) => insMs.run(pid, i, m[0], m[1], m[2], m[3], m[4]));
    return pid;
  };

  addProject(
    {
      campaign: "LUMA",
      title: "LUMA — Diseñador UX/UI",
      type: "SAS",
      budget: 500,
      weeks: 8,
      summary: "Diseño de la PWA de LUMA: login, KYC, subida de documentos, dashboard y panel admin.",
      description:
        "Responsable del sistema visual y la experiencia de la PWA de LUMA. Entrega flujos de login/KYC, subida de documentos, dashboard de usuario y panel de administración, con handoff a desarrollo. Trabajo remoto, entregas parciales visibles.",
      acceptance:
        "Prototipos navegables por hito, componentes documentados, contraste AA, handoff con specs. QA de usabilidad aprobado por el supervisor antes de cada pago.",
    },
    [
      ["ANT", "Anticipo", "Sem 0", 20, 100],
      ["H1", "UX PWA: login + KYC + subida de documentos", "Sem 3", 30, 150],
      ["H2", "Dashboard de usuario + panel admin", "Sem 6", 25, 125],
      ["H3", "Ajustes + QA de usabilidad", "Sem 8", 15, 75],
      ["RET", "Retención", "Sem 8", 10, 50],
    ]
  );

  addProject(
    {
      campaign: "LUMA",
      title: "LUMA — Desarrollador Full-Stack",
      type: "SAS",
      budget: 1000,
      weeks: 8,
      summary: "Backend + frontend de la PWA de LUMA sobre Azure: auth, KYC, QR, pagos y pantalla en vivo.",
      description:
        "Construye la PWA de LUMA de extremo a extremo: infraestructura en Azure, base de datos, autenticación con KYC y QR, módulo de usuario, panel de administración y moderación, pagos con Wompi/PSE y pantalla en vivo para el piloto.",
      acceptance:
        "Cada hito con demo funcional en ambiente de pruebas, tests básicos verdes, y checklist de seguridad. El piloto debe correr con datos reales controlados.",
    },
    [
      ["ANT", "Anticipo", "Sem 0", 20, 200],
      ["M1", "Infra Azure + base de datos", "Sem 2", 10, 100],
      ["M2", "Login + KYC + QR", "Sem 4", 10, 100],
      ["M3", "Módulo de usuario", "Sem 5", 10, 100],
      ["M4", "Panel admin + moderación", "Sem 6", 10, 100],
      ["M5", "Pagos Wompi + PSE", "Sem 7", 15, 150],
      ["M6", "Pantalla en vivo", "Sem 7", 10, 100],
      ["M7", "Piloto", "Sem 8", 5, 50],
      ["RET", "Retención", "Sem 8", 10, 100],
    ]
  );

  addProject(
    {
      campaign: "CREDIFONO",
      title: "CREDIFONO — Dev A Core financiero",
      type: "SAS",
      budget: 1000,
      weeks: 12,
      summary: "Núcleo financiero del crédito de celulares (modelo PayJoy): originación, scoring, cuotas, pagos y cobranza.",
      description:
        "Diseña y construye el core financiero de CREDIFONO: arquitectura, originación de créditos y scoring, motor de cuotas, registro de pagos, cobranza y reportes de cartera para el piloto. Modelo PayJoy: celulares a crédito con bloqueo por mora.",
      acceptance:
        "Motor de cuotas reproducible y auditado, pruebas de originación y cobranza, y reporte de cartera consistente. Cada pago requiere demo y revisión del supervisor.",
    },
    [
      ["ANT", "Anticipo", "Sem 0", 20, 200],
      ["A1", "Arquitectura", "Sem 2", 10, 100],
      ["A2", "Originación + scoring", "Sem 4", 15, 150],
      ["A3", "Motor de cuotas", "Sem 6", 10, 100],
      ["A4", "Pagos", "Sem 8", 15, 150],
      ["A5", "Cobranza", "Sem 10", 10, 100],
      ["A6", "Cartera + piloto", "Sem 12", 10, 100],
      ["RET", "Retención", "Sem 12", 10, 100],
    ]
  );

  addProject(
    {
      campaign: "CREDIFONO",
      title: "CREDIFONO — Dev B Device & cliente",
      type: "SAS",
      budget: 1000,
      weeks: 12,
      summary: "Capa de dispositivo (Device Policy Controller) y portal de cliente: bloqueo por mora y hardening.",
      description:
        "Construye la capa de dispositivo del modelo PayJoy: spike de Device Policy Controller, agente de bloqueo, flujo mora→lock, portal del cliente y hardening de seguridad para el piloto.",
      acceptance:
        "Agente de bloqueo confiable en dispositivos de prueba, flujo mora→lock verificable, portal de cliente usable y checklist de hardening cumplido.",
    },
    [
      ["ANT", "Anticipo", "Sem 0", 20, 200],
      ["B1", "Spike DPC (Device Policy Controller)", "Sem 3", 15, 150],
      ["B2", "Agente de bloqueo", "Sem 6", 20, 200],
      ["B3", "Mora → lock", "Sem 8", 10, 100],
      ["B4", "Portal de cliente", "Sem 10", 15, 150],
      ["B5", "Hardening + piloto", "Sem 12", 10, 100],
      ["RET", "Retención", "Sem 12", 10, 100],
    ]
  );

  addProject(
    {
      campaign: "CREDIFONO",
      title: "CREDIFONO — Diseñador",
      type: "SAS",
      budget: 500,
      weeks: 12,
      summary: "Identidad y experiencia de CREDIFONO: UX de originación, dashboards y pantallas del agente.",
      description:
        "Define la identidad visual y la experiencia de CREDIFONO: UX del flujo de originación, dashboards de cartera y las pantallas operativas del agente de campo.",
      acceptance:
        "Sistema visual consistente, prototipos navegables por hito y handoff documentado. Validación de usabilidad con el supervisor antes de cada pago.",
    },
    [
      ["ANT", "Anticipo", "Sem 0", 20, 100],
      ["D1", "Identidad + UX de originación", "Sem 3", 25, 125],
      ["D2", "Dashboards", "Sem 7", 25, 125],
      ["D3", "Pantallas del agente", "Sem 10", 20, 100],
      ["RET", "Retención", "Sem 12", 10, 50],
    ]
  );

  // ---- Decision log (5 fundacionales) ----
  const insDec = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (?, ?, ?, ?)`);
  const decisions: Array<[string, string, string]> = [
    [
      "2026-06-15",
      "Adopción del Reglamento Interno v1",
      "Se adopta el marco de operación de la DAO en fase Génesis: onboarding por invitación, CLA obligatorio y máquina de estados de proyectos.",
    ],
    [
      "2026-06-18",
      "Modelo de reparto 20 / 70 / 10",
      "Cada rol cobra 20% de anticipo, 70% por hitos verificados y 10% de retención de calidad; el fondo común recibe 30% de cada proyecto.",
    ],
    [
      "2026-06-20",
      "Presupuesto de época: 100.000 puntos ZWORK",
      "La época Génesis emite como máximo 100.000 puntos, distribuidos solo por score aprobado, para evitar dilución de los contribuidores tempranos.",
    ],
    [
      "2026-06-25",
      "Designación de guardianes seed",
      "Se nombran 3 guardianes seed con mandato a término para filtrar propuestas, resolver disputas y activar la revisión cruzada.",
    ],
    [
      "2026-07-01",
      "Publicación de campañas LUMA + CREDIFONO",
      "Se abren al Ágora las dos primeras campañas (5 proyectos) etiquetadas como proyectos de cliente, con hitos y criterios de aceptación públicos.",
    ],
  ];
  for (const d of decisions) insDec.run(d[0], d[1], d[2], sha256Hex(d.join("|")));

  // ---- Genoma v1 (parámetros evolutivos versionados, WP02) ----
  // Ligado a una entrada nueva del decision log; efectivo desde la época 1.
  const genomeDec: [string, string, string] = [
    "2026-07-01",
    "Genoma v1 publicado",
    "Los parámetros evolutivos del sistema (presupuesto de época, presupuesto y caps de Academia, topes de invitación por tier) se publican como genoma versionado v1, efectivo desde la época Génesis. En Zelena evolucionan las reglas, no las personas: cualquier cambio futuro será una versión nueva del genoma, ligada a una decisión y sin efecto retroactivo.",
  ];
  const genomeDecInfo = insDec.run(genomeDec[0], genomeDec[1], genomeDec[2], sha256Hex(genomeDec.join("|")));
  seedGenomeV1(db, genomeDecInfo.lastInsertRowid as number);

  // ---- Votación seeded ----
  const prop = db
    .prepare(
      `INSERT INTO proposals (title, description, status, threshold) VALUES (?, ?, 'open', 66)`
    )
    .run(
      "Ratificación del Reglamento v2 (brechas B1–B12)",
      "Ratificar la versión 2 del Reglamento Interno que cierra las brechas B1 a B12 identificadas en el análisis de sociología, teoría de juegos y tokenomics: tope de invitaciones para guardianes, revisión cruzada aleatoria, decaimiento de voto, mandatos a término, entre otras. Umbral crítico: 66%."
    );
  const pid = prop.lastInsertRowid as number;
  const insVote = db.prepare(`INSERT INTO votes (proposal_id, wallet, choice) VALUES (?, ?, ?)`);
  insVote.run(pid, DELINA, "favor");
  insVote.run(pid, MARCOS, "favor");
  insVote.run(pid, SOFIA, "abstencion");

  // ---- Reputación (append-only) ----
  const insRep = db.prepare(
    `INSERT INTO reputation_events (wallet, axis, delta, ref) VALUES (?, ?, ?, ?)`
  );
  const rep: Array<[string, string, number, string]> = [
    [DELINA, "ejecucion", 42, "LUMA H1 entregado"],
    [DELINA, "investigacion", 12, "Academia: triángulo de activos"],
    [MARCOS, "ejecucion", 28, "LUMA M1 Azure+DB"],
    [MARCOS, "comunidad", 8, "Check-in demo day"],
    [SOFIA, "ejecucion", 24, "CREDIFONO D1 identidad"],
    [SOFIA, "investigacion", 18, "Academia: cómo se mide el valor"],
    [FOUNDER_WALLET, "gobernanza", 20, "Publicación decision log"],
    [FOUNDER_WALLET, "comunidad", 10, "Facilitación demo day"],
  ];
  for (const r of rep) insRep.run(r[0], r[1], r[2], r[3]);

  // ---- Puntos ZWORK (append-only, dentro del presupuesto) ----
  const insPts = db.prepare(
    `INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, 1, ?, ?)`
  );
  insPts.run(DELINA, 1200, "ejecucion", "Score LUMA H1");
  insPts.run(MARCOS, 900, "ejecucion", "Score LUMA M1");
  insPts.run(SOFIA, 700, "ejecucion", "Score CREDIFONO D1");
  insPts.run(SOFIA, 150, "academia", "Academia: cómo se mide el valor");
  insPts.run(DELINA, 150, "academia", "Academia: triángulo de activos");

  // ---- Academia ----
  seedAcademia(db);
}

function seedAcademia(db: DB): void {
  const insC = db.prepare(
    `INSERT INTO academia_content (slug, kind, title, summary, axis, points, min_seconds, body, video_id, ord)
     VALUES (?, ?, ?, ?, 'investigacion', ?, ?, ?, ?, ?)`
  );
  const insQ = db.prepare(
    `INSERT INTO academia_quiz (content_id, question, options, correct, pool) VALUES (?, ?, ?, ?, 0)`
  );
  const addContent = (
    c: {
      slug: string;
      kind: string;
      title: string;
      summary: string;
      points: number;
      minSeconds: number;
      body?: string;
      videoId?: string;
      ord: number;
    },
    quiz: Array<[string, string[], number]>
  ) => {
    const info = insC.run(
      c.slug,
      c.kind,
      c.title,
      c.summary,
      c.points,
      c.minSeconds,
      c.body ?? null,
      c.videoId ?? null,
      c.ord
    );
    const cid = info.lastInsertRowid as number;
    for (const q of quiz) insQ.run(cid, q[0], JSON.stringify(q[1]), q[2]);
  };

  // S1 (WP31-E2): mismo texto que la migración `aplicarContenidoPublico` deja en una
  // base existente. Va primero (mismo id que en producción), pero su `ord` es 2.
  addContent(
    {
      slug: ACADEMIA_S1.slug,
      kind: "article",
      title: ACADEMIA_S1.title,
      summary: ACADEMIA_S1.summary,
      points: 150,
      minSeconds: 45,
      ord: 2,
      body: ACADEMIA_S1.body,
    },
    ACADEMIA_S1.quiz.map(([pregunta, opciones, correcta]): [string, string[], number] => [pregunta, [...opciones], correcta])
  );

  addContent(
    {
      slug: "el-triangulo-de-activos",
      kind: "article",
      title: "El triángulo de activos",
      summary: "USDC paga, la reputación da voto, ZWORK representa ownership. Ninguno sustituye a otro.",
      points: 150,
      minSeconds: 45,
      ord: 3,
      body: `## El triángulo USDC / Reputación / ZWORK

El error que este diseño evita es un token que sea "ownership de nada". Por eso se separan tres activos, cada uno con un único rol.

| Activo | Rol único | Propiedades |
|---|---|---|
| **USDC** | Pago por el trabajo | Líquido. Sale del 70% del split del proyecto. |
| **Reputación** | Voto + acceso | No transferible. Con decaimiento para el peso de gobernanza. |
| **ZWORK** | Ownership: derecho residual | Puntos **no transferibles** en la fase actual. |

### ZWORK hoy

ZWORK es, en la fase actual, un conjunto de **puntos no transferibles**. No se puede vender, comprar ni intercambiar. La transferibilidad futura es posible solo por decisión de gobernanza y previa revisión legal y tributaria — nunca por defecto.

Esto evita generar expectativa de inversión, evita dinámicas de "farm-and-dump", y permite calibrar la emisión con datos reales antes de que exista precio. La emisión sigue un **presupuesto por época** con techo duro.`,
    },
    [
      ["¿Qué activo paga el trabajo?", ["ZWORK", "Reputación", "USDC", "Ninguno"], 2],
      ["¿ZWORK es transferible en la fase actual?", ["Sí, libremente", "No, son puntos no transferibles", "Solo en mainnet", "Solo los fines de semana"], 1],
      ["¿Qué activo otorga voto?", ["USDC", "La reputación", "ZWORK", "El CLA"], 1],
      ["La emisión de ZWORK sigue...", ["Sin límite", "Un presupuesto por época con techo duro", "El precio de mercado", "La inflación"], 1],
      ["Un token que es 'ownership de nada'...", ["Es lo ideal", "Es el error que el diseño evita", "Da más voto", "Es obligatorio"], 1],
    ]
  );

  addContent(
    {
      slug: "como-se-mide-el-valor",
      kind: "article",
      title: "Cómo se mide el valor",
      summary: "La metodología de 8 pasos y la máquina de estados que hace el scoring transparente y verificable.",
      points: 150,
      minSeconds: 45,
      ord: 1,
      body: `## Cómo se mide el valor

Todo proyecto recorre un flujo de **ocho pasos** en el Ágora: Intake, Publicación, Aplicación, Asignación, Ejecución, Evaluación, Distribución y Reputación.

La asignación abre un periodo de trabajo gobernado por una **máquina de estados** estricta:

\`Open → Assigned → Delivered → Scored → Distributed\`. Sin saltos.

El supervisor cierra el periodo y genera un **score compuesto** por entrega: calculado, transparente y verificable, no subjetivo. El presupuesto se reparte proporcional al score.

### Candados de integridad

- **Revisión cruzada aleatoria** de un porcentaje de los cierres.
- Un supervisor **no evalúa a su invitado directo** (regla B8).
- La calidad de las evaluaciones alimenta el **score de supervisión** del guardián.

Cada proyecto alimenta el perfil append-only del contribuidor. Más historial habilita mejores proyectos: así gira el flywheel.`,
    },
    [
      ["¿Cuál es el orden correcto de la máquina de estados?", ["Open→Delivered→Assigned", "Open→Assigned→Delivered→Scored→Distributed", "Assigned→Open→Scored", "Scored→Open→Delivered"], 1],
      ["¿Puede un supervisor evaluar a su invitado directo?", ["Sí", "No (regla B8)", "Solo con permiso", "Siempre"], 1],
      ["El score compuesto es...", ["Subjetivo", "Calculado, transparente y verificable", "Secreto", "Aleatorio"], 1],
      ["¿Cuántos pasos tiene la metodología del Ágora?", ["4", "6", "8", "12"], 2],
      ["La revisión cruzada sirve para...", ["Acelerar pagos", "Contener la colusión supervisor–ejecutor", "Subir el presupuesto", "Eliminar el CLA"], 1],
    ]
  );

  addContent(
    {
      slug: "video-que-es-zelena-dao",
      kind: "video",
      title: "Qué es Zelena DAO (video)",
      summary: "Introducción en video: del piso a la wallet, el valor que entregas determina lo que recibes.",
      points: 100,
      minSeconds: 60,
      ord: 4,
      videoId: "aqz-KE-bpKQ",
    },
    [
      ["La tesis central de Zelena es...", ["La antigüedad manda", "El valor que entregas determina lo que recibes", "El título importa más", "Las horas registradas"], 1],
      ["Zelena se construye sobre...", ["Bitcoin", "Ethereum L2", "Stellar / Soroban", "Una base de datos central"], 2],
      ["El onboarding es...", ["Abierto a todos", "Por invitación con CLA", "Solo por pago", "Automático"], 1],
      ["¿Dónde corre todo hoy?", ["Mainnet", "Testnet", "Un servidor privado", "En papel"], 1],
      ["El tagline de Zelena es...", ["Move fast", "Real work, Real rewards", "Code is law", "To the moon"], 1],
    ]
  );
}
