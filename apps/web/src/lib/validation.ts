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
  ]),
  applicationId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  milestoneId: z.number().int().positive().optional(),
  contentId: z.number().int().positive().optional(),
});

export type OnboardInput = z.infer<typeof onboardSchema>;
