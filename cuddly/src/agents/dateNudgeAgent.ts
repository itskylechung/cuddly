import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic } from '../lib/ai.js'
import { db } from '../lib/db.js'

const DateNudgeSchema = z.object({
  venue_name: z.string().describe('Specific venue name in Taipei'),
  venue_type: z.string().describe('e.g. "specialty coffee shop", "jazz bar", "hiking trail"'),
  neighborhood: z.string().describe('Taipei neighborhood, e.g. "Da\'an", "Zhongshan"'),
  why_them: z.string().describe('1-2 sentences explaining why this venue fits both people specifically'),
  suggested_message: z.string().describe('A natural message the seeker could send to suggest meeting here — under 40 words'),
})

export type DateNudge = z.infer<typeof DateNudgeSchema>

export async function dateNudgeAgent(matchId: string): Promise<DateNudge | null> {
  const { data: match } = await db
    .from('matches')
    .select(`
      *,
      profile:profiles!profile_id(*, profile_analyses(*))
    `)
    .eq('id', matchId)
    .single()

  if (!match) return null

  // Don't nudge again if already sent
  if (match.date_nudge_sent_at) return null

  const profile = match.profile as any
  const analysis = profile.profile_analyses as any

  const { object } = await generateObject({
    model: anthropic('claude-3-5-sonnet-20241022'),
    schema: DateNudgeSchema,
    system: `You suggest specific, real venues in Taipei for a first date. 
You pick places that match both people's aesthetic and interests based on their Instagram signals.
All venues must be in Taipei. Prefer Da'an, Zhongshan, Xinyi, or Zhongzheng districts.
Be specific — real venue names, not generic descriptions.`,
    prompt: `Match profile:
- Instagram: @${profile.instagram_handle}
- Aesthetic: ${analysis?.aesthetic_tags?.join(', ')}
- Interests: ${analysis?.topics_corpus?.join(', ')}
- Neighborhoods they frequent: ${analysis?.neighborhoods?.join(', ')}
- Humor: ${analysis?.humor_type}

Suggest a specific Taipei venue and a natural message for suggesting the date.`,
  })

  // Mark nudge as sent
  await db
    .from('matches')
    .update({
      date_nudge_sent_at: new Date().toISOString(),
      date_nudge_venue: `${object.venue_name}, ${object.neighborhood}`,
    })
    .eq('id', matchId)

  return object as DateNudge
}
