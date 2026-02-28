import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic } from '../lib/ai.js'
import { db } from '../lib/db.js'
import { getCached, setCached } from '../lib/redis.js'
import type { VibeCheckOutput } from '../types/index.js'

const VibeCheckSchema = z.object({
  aesthetic: z.string().describe('2-3 sentences on visual vibe, photo style, color palette, what their feed feels like'),
  personality: z.string().describe('2-3 sentences on how they come across: writing style, humor, emotional register, energy'),
  lifestyle: z.string().describe('2-3 sentences on how they actually live: neighborhoods, routines, how they spend time'),
  interests: z.array(z.string()).max(5).describe('Top 5 specific interest tags, e.g. "specialty coffee", "film photography"'),
  sparks: z.tuple([z.string(), z.string(), z.string()]).describe('Exactly 3 specific conversation openers rooted in real profile details. Never generic. Each under 25 words.'),
})

export async function vibeCheckAgent(profileId: string): Promise<VibeCheckOutput> {
  // Check cache first
  const cacheKey = `vibe:${profileId}`
  const cached = await getCached<VibeCheckOutput>(cacheKey)
  if (cached) return cached

  // Fetch profile + analysis + posts
  const { data: profile } = await db
    .from('profiles')
    .select('*, profile_analyses(*), posts(*)')
    .eq('id', profileId)
    .single()

  if (!profile) throw new Error(`Profile not found: ${profileId}`)

  const analysis = profile.profile_analyses as any
  const posts = profile.posts as any[]

  // Build rich context for the agent
  const captions = posts
    .filter(p => p.caption)
    .slice(0, 20)
    .map(p => `"${p.caption}"`)
    .join('\n')

  const locations = posts
    .filter(p => p.tagged_location)
    .map(p => p.tagged_location)
    .join(', ')

  const context = `
Instagram Profile: @${profile.instagram_handle}
Bio: ${profile.bio_text || 'none'}
Location: ${profile.location_text || 'unknown'}

NLP Analysis:
- Personality: ${analysis?.personality_summary}
- Writing style: ${analysis?.writing_style}
- Emotional register: ${analysis?.emotional_register}
- Humor: ${analysis?.humor_type}
- Topics: ${analysis?.topics_corpus?.join(', ')}
- Top hashtags: ${JSON.stringify(analysis?.hashtag_clusters)}

Geo presence: ${analysis?.neighborhoods?.join(', ')} in ${analysis?.primary_city}
Frequently tagged locations: ${locations}

Aesthetic: ${analysis?.aesthetic_tags?.join(', ')}
Color palette: ${analysis?.color_palette}
Post style: ${JSON.stringify(analysis?.content_type_ratio)}

Recent captions:
${captions}
`.trim()

  const { object } = await generateObject({
    model: anthropic('claude-3-5-sonnet-20241022'),
    schema: VibeCheckSchema,
    system: `You are Cuddly's Vibe Check Agent. You read someone's Instagram presence and write a warm, specific, insightful profile read — like a smart mutual friend explaining who this person actually is. 

Rules:
- Never use clichés like "free spirit" or "loves to laugh"
- Every claim must be grounded in actual profile data provided
- The 3 conversation sparks must be specific to THIS person — not generic openers
- Write naturally and warmly, not like an AI report
- Conversation sparks should feel like something a thoughtful person would actually say`,
    prompt: `Write a full Vibe Check for this Instagram profile:\n\n${context}`,
  })

  const result = object as VibeCheckOutput
  await setCached(cacheKey, result)
  return result
}
