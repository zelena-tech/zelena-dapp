/**
 * Seed idempotente: solo corre si la tabla users está vacía. Crea el founder,
 * 6 invitaciones GENESIS, el periodo Génesis, las 2 campañas (5 proyectos) con
 * sus hitos exactos, decision log, la votación de ratificación, la Academia y
 * una cohorte demo para que las stats y perfiles tengan vida.
 */
import type { DB } from "./db"; // solo tipo: sin ciclo en runtime
import { sha256Hex } from "./crypto";
import { FOUNDER_WALLET } from "./config";
import { GENOME_V1, seedGenomeV1 } from "./genome";
import { createCohortInvite } from "./invites";

const DELINA = "GDELINACONTRIBUTORDEMOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MARCOS = "GMARCOSDEVDEMOBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const SOFIA = "GSOFIADESIGNDEMOCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

/**
 * Código de cohorte de la especialización: un solo código para decenas de
 * personas (QR proyectado en clase → /entrar?code=ESPECIALIZACION-2026).
 */
export const COHORT_CODE = "ESPECIALIZACION-2026";
/**
 * Cupos con holgura deliberada: una cohorte de ~150 personas consume MÁS de un
 * cupo por persona (pestaña privada, cambio de teléfono, almacenamiento borrado,
 * reintentos). Igualar cupos y asistentes deja a los últimos fuera.
 */
const COHORT_MAX_USES = Number(process.env.COHORT_MAX_USES ?? 400);
const COHORT_EXPIRES_DAYS = Number(process.env.COHORT_EXPIRES_DAYS ?? 45);

/**
 * Se siembra en CADA arranque, no solo cuando la base está vacía: es
 * idempotente (INSERT OR IGNORE, no reinicia `uses` ni la expiración) y sobre
 * una base ya poblada `seed()` nunca corre, así que si viviera solo ahí dentro
 * el código de la cohorte no existiría jamás en la base de John.
 */
export function seedCohortInvite(db: DB): void {
  createCohortInvite(db, {
    code: COHORT_CODE,
    issuerWallet: FOUNDER_WALLET,
    maxUses: COHORT_MAX_USES,
    expiresDays: COHORT_EXPIRES_DAYS,
  });
}

export function seedIfEmpty(db: DB): void {
  const has = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  if (has.n > 0) {
    seedCohortInvite(db);
    return;
  }
  const tx = db.transaction(() => seed(db));
  tx();
}

function seed(db: DB): void {
  // ---- Periodo Génesis (presupuestos = genoma v1) ----
  db.prepare(
    `INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'Época Génesis', ?, ?, 'Open')`
  ).run(GENOME_V1.EPOCH_BUDGET, GENOME_V1.ACADEMIA_BUDGET);

  // ---- Usuarios ----
  const insUser = db.prepare(
    `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed)
     VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`
  );
  insUser.run(FOUNDER_WALLET, "John (Founder)", "Gold", null, 1, 1);
  insUser.run(DELINA, "Delina", "Silver", FOUNDER_WALLET, 1, 0);
  insUser.run(MARCOS, "Marcos", "Bronze", FOUNDER_WALLET, 1, 0);
  insUser.run(SOFIA, "Sofía", "Bronze", FOUNDER_WALLET, 1, 0);

  // ---- Invitaciones GENESIS (6, del founder, sin usar) ----
  const insInvite = db.prepare(
    `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES (?, ?, datetime('now','+30 days'))`
  );
  for (let i = 1; i <= 6; i++) {
    insInvite.run("GENESIS-" + String(i).padStart(4, "0"), FOUNDER_WALLET);
  }

  // ---- Código de cohorte multiuso (demo de clase). No toca el cupo del tier ----
  seedCohortInvite(db);

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
      "Cada rol cobra 20% de anticipo, 70% por hitos verificados y 10% de retención de calidad; el treasury recibe 30% de cada proyecto según el Plan Maestro.",
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
      "Se abren al Ágora las dos primeras campañas (5 bounties) etiquetadas SAS, con hitos y criterios de aceptación públicos.",
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

  addContent(
    {
      slug: "por-que-sas-dao",
      kind: "article",
      title: "Por qué SAS + DAO",
      summary: "La arquitectura de dos entidades que protege a los contribuidores y da una contraparte a los clientes.",
      points: 150,
      minSeconds: 45,
      ord: 1,
      body: `## Por qué SAS + DAO

La descentralización total desde el día uno es una fantasía costosa. Zelena separa la entidad que **sostiene el valor legal** de la comunidad que lo **coordina**.

- **Zelena SAS** — empresa formal. Dueña de la marca, la propiedad intelectual comercial, los ingresos y la relación con clientes.
- **Zelena DAO** — comunidad gobernada. Coordina el trabajo, la reputación on-chain, el token ZWORK y la gobernanza.
- **Acuerdo de servicios** — el conector: la DAO presta servicios, la SAS remunera y comercializa.

Esta separación protege a los contribuidores (la responsabilidad legal recae en la SAS), da a los clientes una contraparte con la que contratar, y permite que la comunidad crezca sin cargar con obligaciones societarias individuales.

Firmar el CLA o recibir reputación o ZWORK **no crea relación laboral ni societaria**, y esos activos **no constituyen salario**. La descentralización es la recompensa de la madurez, no el punto de partida.`,
    },
    [
      ["¿Qué entidad es dueña de la propiedad intelectual comercial?", ["La DAO", "Zelena SAS", "Los guardianes", "Los clientes"], 1],
      ["¿Qué une a la SAS y a la DAO?", ["Un token", "Un acuerdo de servicios", "Un contrato laboral", "Nada"], 1],
      ["Recibir ZWORK o reputación...", ["Es salario", "Crea relación laboral", "No crea relación laboral ni societaria", "Da acciones de la SAS"], 2],
      ["La descentralización en Zelena es...", ["El punto de partida", "La recompensa de la madurez", "Imposible", "Obligatoria desde el día 1"], 1],
      ["¿Quién coordina el trabajo y la reputación?", ["La SAS", "La DAO", "El cliente", "Un banco"], 1],
    ]
  );

  addContent(
    {
      slug: "el-triangulo-de-activos",
      kind: "article",
      title: "El triángulo de activos",
      summary: "USDC paga, la reputación da voto, ZWORK representa ownership. Ninguno sustituye a otro.",
      points: 150,
      minSeconds: 45,
      ord: 2,
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
      ord: 3,
      body: `## Cómo se mide el valor

Todo proyecto recorre un flujo de **ocho pasos** en el Ágora: Intake, Publicación, Aplicación, Asignación, Ejecución, Evaluación, Distribución y Reputación.

La asignación abre un periodo de trabajo gobernado por una **máquina de estados** estricta:

\`Open → Assigned → Delivered → Scored → Distributed\`. Sin saltos.

El supervisor cierra el periodo y genera un **score compuesto** por contribuidor: calculado, transparente y verificable, no subjetivo. El presupuesto se reparte proporcional al score.

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
