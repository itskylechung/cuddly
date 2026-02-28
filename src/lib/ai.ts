import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

// Shared model — use claude-3-5-sonnet for all agents (fast + capable)
export const MODEL = anthropic('claude-3-5-sonnet-20241022')

// Base agent runner — all agents go through this
export async function runAgent(systemPrompt: string, userPrompt: string): Promise<string> {
  const { text } = await generateText({
    model: MODEL,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 1024,
  })
  return text
}

// For streaming responses (Wingman Agent)
export { streamText } from 'ai'
export { anthropic }
