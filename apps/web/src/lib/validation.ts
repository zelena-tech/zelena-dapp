import { z } from "zod";

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

export const onboardSchema = z.object({
  code: z.string().trim().min(3).max(40),
  wallet,
  name: z.string().trim().min(2).max(40),
  isDemo: z.boolean(),
  claHash: z.string().trim().length(64),
  signature: z.string().trim().min(4).max(400),
});

/**
 * Reingreso de una wallet YA registrada: no consume invitación, no crea usuario.
 * La autenticación es la firma ed25519 sobre el payload del CLA (solo el titular
 * de la llave puede producirla), así que no hay código de invitación involucrado.
 */
export const loginSchema = z.object({
  wallet,
  claHash: z.string().trim().length(64),
  signature: z.string().trim().min(4).max(400),
});

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
