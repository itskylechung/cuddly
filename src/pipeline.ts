import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

import {
  MatchRequest,
  MatchRequestSchema,
  MatchResult,
  MatchScore,
  MatchScoreSchema,
  PersonProfile
} from "./types.js";

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function overlapCount(a: string[], b: string[]): number {
  const aSet = new Set(a.map(normalize));
  return b.reduce((count, item) => count + (aSet.has(normalize(item)) ? 1 : 0), 0);
}

function checkDealBreakers(seeker: PersonProfile, candidate: PersonProfile): string[] {
  const reasons: string[] = [];
  const candidateText = [
    candidate.location ?? "",
    ...candidate.interests,
    ...candidate.values,
    ...candidate.relationshipGoals
  ]
    .map(normalize)
    .join(" ");

  for (const dealBreaker of seeker.dealBreakers) {
    const db = normalize(dealBreaker);
    if (!db) {
      continue;
    }
    if (candidateText.includes(db)) {
      reasons.push(`Matched seeker deal-breaker: "${dealBreaker}"`);
    }
  }
  return reasons;
}

function deterministicBoost(seeker: PersonProfile, candidate: PersonProfile): number {
  const sharedInterests = overlapCount(seeker.interests, candidate.interests);
  const sharedValues = overlapCount(seeker.values, candidate.values);
  const sharedGoals = overlapCount(seeker.relationshipGoals, candidate.relationshipGoals);

  const weighted = sharedInterests * 3 + sharedValues * 5 + sharedGoals * 7;
  return Math.min(weighted, 20);
}

async function scoreWithModel(seeker: PersonProfile, candidate: PersonProfile): Promise<MatchScore> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing. Add it to your environment or .env file.");
  }

  const anthropic = createAnthropic({ apiKey });
  const modelName = process.env.CLAUDE_MODEL ?? "claude-3-5-sonnet-latest";

  const { object } = await generateObject({
    model: anthropic(modelName),
    schema: MatchScoreSchema,
    temperature: 0.2,
    system:
      "You are a careful relationship compatibility evaluator. Use only provided profile data and be concise, fair, and specific.",
    prompt: [
      "Evaluate compatibility between two people for a long-term romantic relationship.",
      "",
      "Output structured JSON only through the schema.",
      "",
      `Seeker profile: ${JSON.stringify(seeker)}`,
      `Candidate profile: ${JSON.stringify(candidate)}`,
      "",
      "Scoring guidance:",
      "- Prioritize shared values and relationship goals.",
      "- Consider shared interests and lifestyle compatibility.",
      "- Account for potential concerns without being judgmental.",
      "- compatibilityScore should be from 0 to 100."
    ].join("\n")
  });

  return object;
}

export async function runLoveMatchPipeline(rawRequest: MatchRequest): Promise<MatchResult[]> {
  const request = MatchRequestSchema.parse(rawRequest);
  const results: MatchResult[] = [];

  for (const candidate of request.candidates) {
    const dealBreakerReasons = checkDealBreakers(request.seeker, candidate);
    const blockedByDealBreaker = dealBreakerReasons.length > 0;

    const modelScore = await scoreWithModel(request.seeker, candidate);
    const boost = deterministicBoost(request.seeker, candidate);

    // If a candidate trips deal-breakers, clamp score so they cannot rank highly.
    const capped = blockedByDealBreaker ? Math.min(modelScore.compatibilityScore, 25) : modelScore.compatibilityScore;
    const finalScore = Math.min(100, Math.max(0, capped + (blockedByDealBreaker ? 0 : boost)));

    results.push({
      candidate,
      score: modelScore,
      blockedByDealBreaker,
      hardFilterReasons: dealBreakerReasons,
      finalScore
    });
  }

  return results.sort((a, b) => b.finalScore - a.finalScore).slice(0, request.topK);
}
