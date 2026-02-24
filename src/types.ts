import { z } from "zod";

export const PersonProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  age: z.number().int().positive().optional(),
  location: z.string().min(1).optional(),
  interests: z.array(z.string()).default([]),
  values: z.array(z.string()).default([]),
  relationshipGoals: z.array(z.string()).default([]),
  dealBreakers: z.array(z.string()).default([])
});

export type PersonProfile = z.infer<typeof PersonProfileSchema>;

export const MatchRequestSchema = z.object({
  seeker: PersonProfileSchema,
  candidates: z.array(PersonProfileSchema).min(1),
  topK: z.number().int().positive().max(100).default(5)
});

export type MatchRequest = z.infer<typeof MatchRequestSchema>;

export const MatchScoreSchema = z.object({
  compatibilityScore: z.number().min(0).max(100),
  shortSummary: z.string().min(1),
  strengths: z.array(z.string()).max(5),
  concerns: z.array(z.string()).max(5),
  suggestedOpeningLine: z.string().min(1)
});

export type MatchScore = z.infer<typeof MatchScoreSchema>;

export const MatchResultSchema = z.object({
  candidate: PersonProfileSchema,
  score: MatchScoreSchema,
  blockedByDealBreaker: z.boolean(),
  hardFilterReasons: z.array(z.string()),
  finalScore: z.number().min(0).max(100)
});

export type MatchResult = z.infer<typeof MatchResultSchema>;
