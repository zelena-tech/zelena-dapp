import { z } from "zod";
import { SLUGS_INTERES } from "./servicios";
import { NONCE_RE } from "./login-signing";
import { MENSAJE_SIN_AUTORIZACION } from "./aviso-privacidad";

// Stellar public key: 'G' + 55 base32 chars. Aceptamos también wallets demo del seed.
const wallet = z
  .string()
  .trim()
  .min(10)
  .max(80)
  .regex(/^[A-Z0-9]+$/, "Formato de wallet inválido");

export const inviteVerifySchema = z.object({
  code: z.string().trim().min(3).max(40),
});

/**
 * Nombres reservados: sin esto, cualquiera puede registrarse como
 * "Founder (demo)" y aparecer junto al fundador en las listas públicas.
 */
const RESERVADOS = ["founder", "fundador", "zelena", "admin", "guardian", "guardián", "soporte", "oficial"];

const nombreVisible = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .refine((n) => !RESERVADOS.some((r) => n.toLowerCase().includes(r)), {
    message: "Ese nombre está reservado. Usa tu nombre o tu alias.",
  });

export const onboardSchema = z.object({
  code: z.string().trim().min(3).max(40),
  wallet,
  name: nombreVisible,
  // Ignorado por el servidor (lo decide el código de invitación, ver performOnboard).
  isDemo: z.boolean().optional(),
  claHash: z.string().trim().length(64),
  signature: z.string().trim().min(4).max(400),
});

/**
 * Reingreso de una wallet YA registrada: no consume invitación, no crea usuario.
 * La autenticación es la firma ed25519 sobre un RETO de un solo uso que emite
 * `/api/login/reto` (lib/login-reto.ts), nunca la firma fija del CLA: esa se guarda
 * en la base y quien la leyera entraría para siempre. `.strict()`: un cuerpo con
 * la forma vieja (`claHash`) se rechaza en vez de ignorar el campo.
 */
export const loginSchema = z
  .object({
    wallet,
    nonce: z.string().trim().regex(NONCE_RE, "Reto inválido."),
    signature: z.string().trim().min(4).max(400),
  })
  .strict();

/** Pedir un reto de entrada. Con `wallet`, el reto solo sirve para esa wallet. */
export const loginRetoSchema = z.object({ wallet: wallet.optional() }).strict();

export const applySchema = z.object({
  projectId: z.number().int().positive(),
  approach: z.string().trim().min(20).max(2000),
  timeline: z.string().trim().min(3).max(200),
});

export const voteSchema = z.object({
  proposalId: z.number().int().positive(),
  choice: z.enum(["favor", "contra", "abstencion"]),
});

export const inviteGenerateSchema = z.object({});

export const academiaStartSchema = z.object({
  contentId: z.number().int().positive(),
});

export const academiaHeartbeatSchema = z.object({
  token: z.string().trim().min(8).max(200),
});

export const academiaQuizSchema = z.object({
  token: z.string().trim().min(8).max(200),
  answers: z.array(z.number().int().min(0).max(10)).length(3),
  quizIds: z.array(z.number().int().positive()).length(3),
});

export const adminActionSchema = z.object({
  action: z.enum([
    "approveApplication",
    "rejectApplication",
    "advanceState",
    "approveMilestone",
    "toggleContent",
    "computeEpochFitness",
    "signEpochDecision",
    "proposeMutation",
    "revertGenome",
    "recordNoMutation",
    "createLatentAudit",
    "publishProject",
  ]),
  applicationId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  milestoneId: z.number().int().positive().optional(),
  contentId: z.number().int().positive().optional(),
  epoch: z.number().int().positive().optional(),
  epochFitnessId: z.number().int().positive().optional(),
  decision: z.enum(["keep", "revert"]).optional(),
  genes: z.array(z.object({ key: z.string(), value: z.number() })).min(1).max(2).optional(),
  justification: z.string().max(1000).optional(),
  targetVersion: z.number().int().positive().optional(),
  // Auditoría de funciones latentes (WP12)
  mechanism: z.string().max(60).optional(),
  period: z.string().max(60).optional(),
  manifestFunction: z.string().max(1000).optional(),
  latentObserved: z.string().max(1000).optional(),
  functionalFor: z.string().max(1000).optional(),
  dysfunctionalFor: z.string().max(1000).optional(),
  auditAction: z.enum(["none", "mutation_proposed", "mechanism_change"]).optional(),
  auditDecisionLogId: z.number().int().positive().optional(),
});

export type OnboardInput = z.infer<typeof onboardSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Autorización de datos personales (Ley 1581, hallazgo A3). La casilla del formulario
 * viaja como `acepto: true` y la API rechaza (400) lo que llegue sin ella: falta,
 * `false` o cualquier otro valor. `aviso` es la versión del aviso de privacidad que
 * tenía la página (`AVISO_PRIVACIDAD_VERSION`); la ruta la compara con la vigente.
 * Va al FINAL de cada esquema: si falta un dato, el error que se ve es el del dato.
 */
const autorizacionDeDatos = {
  acepto: z.literal(true, { errorMap: () => ({ message: MENSAJE_SIN_AUTORIZACION }) }),
  aviso: z.string().trim().max(40).optional(),
};

/**
 * Formulario comercial de /empresas/contacto. Es público (no hay sesión), así
 * que la ruta limita por IP. `sitio` es un campo trampa oculto para personas:
 * se acepta cualquier valor aquí y la ruta descarta en silencio lo que llegue
 * con él lleno, para no darle al bot una señal de que lo detectamos.
 */
export const leadSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  email: z.string().trim().email("Revisa el correo.").max(120),
  empresa: z.string().trim().max(120).optional().default(""),
  interes: z.enum(SLUGS_INTERES, { errorMap: () => ({ message: "Elige qué te interesa." }) }),
  mensaje: z.string().trim().max(2000).optional().default(""),
  sitio: z.string().max(500).optional().default(""),
  ...autorizacionDeDatos,
});

/**
 * Aviso de /encuentros: quien quiere enterarse de la próxima fecha. Mismo
 * patrón que leadSchema (público, límite por IP, campo trampa `sitio`); se
 * guarda en `leads` con interes = "encuentros" y la ciudad en `mensaje`.
 */
export const avisoEncuentrosSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  email: z.string().trim().email("Revisa el correo.").max(120),
  ciudad: z.string().trim().max(80).optional().default(""),
  sitio: z.string().max(500).optional().default(""),
  ...autorizacionDeDatos,
});
