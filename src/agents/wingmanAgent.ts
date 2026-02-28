import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic } from '../lib/ai.js'
import { db } from '../lib/db.js'

const WingmanResponseSchema = z.object({
  suggestions: z.tuple([z.string(), z.string(), z.string()])
    .describe('Exactly 3 reply suggestions. Each under 30 words. Varied in tone: one warm, one playful, one substantive.'),
  coaching_note: z.string().optional()
    .describe('Optional short coaching note if the seeker asks a meta question like "is this going well?"'),
  should_nudge_date: z.boolean()
    .describe('True if the conversation seems ready to transition to suggesting a meetup'),
})

export type WingmanResponse = z.infer<typeof WingmanResponseSchema>

export async function wingmanAgent(
  matchId: string,
  seekerMessage: string  // The message the OTHER person just sent (pasted by seeker)
): Promise<WingmanResponse> {
  // Get match + both profiles
  const { data: match } = await db
    .from('matches')
    .select(`
      *,
      seeker:users!seeker_id(*),
      profile:profiles!profile_id(*, profile_analyses(*))
    `)
    .eq('id', matchId)
    .single()

  if (!match) throw new Error(`Match not found: ${matchId}`)

  // Get wingman session for context
  const { data: session } = await db
    .from('wingman_sessions')
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle()

  const profile = match.profile as any
  const analysis = profile.profile_analyses as any

  const profileContext = `
Match profile: @${profile.instagram_handle}
Personality: ${analysis?.personality_summary}
Writing style: ${analysis?.writing_style}
Humor: ${analysis?.humor_type}
Interests: ${analysis?.topics_corpus?.join(', ')}
Aesthetic: ${analysis?.aesthetic_tags?.join(', ')}
Neighborhoods: ${analysis?.neighborhoods?.join(', ')}
`.trim()

  const conversationContext = session?.message_count
    ? `This is message ${session.message_count + 1} in the conversation.`
    : 'This is the start of the conversation.'

  const { object } = await generateObject({
    model: anthropic('claude-3-5-sonnet-20241022'),
    schema: WingmanResponseSchema,
    system: `You are Cuddly's Wingman Agent — a private, invisible conversation coach. 
You see the match's profile and what they just said. You suggest 3 replies the seeker could send.

Rules:
- Suggestions must feel natural and human — not scripted
- Reference specific things from the match's profile when relevant
- Varied tone: one warm/genuine, one playful/light, one substantive/curious
- Under 30 words each
- Never suggest anything cringe, desperate, or generic like "that's so cool!"
- If conversation has been going for many messages (>10), assess readiness for date nudge`,
    prompt: `Match profile context:
${profileContext}

${conversationContext}

They just said: "${seekerMessage}"

Suggest 3 replies the seeker could send.`,
  })

  // Update session
  await db.from('wingman_sessions').upsert({
    match_id: matchId,
    message_count: (session?.message_count || 0) + 1,
    last_context: seekerMessage,
    suggestions: object.suggestions,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'match_id' })

  return object as WingmanResponse
}
