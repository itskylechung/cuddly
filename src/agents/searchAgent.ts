import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic } from '../lib/ai.js'
import { db } from '../lib/db.js'
import { getCached, setCached } from '../lib/redis.js'
import type { SearchResult, ProfileAnalysis } from '../types/index.js'

// Step 1: Parse the user's natural language query into structured intent
const ParsedQuerySchema = z.object({
  city: z.string().optional().describe('City to search in, e.g. Taipei'),
  neighborhoods: z.array(z.string()).optional().describe('Specific neighborhoods mentioned'),
  age_hint: z.string().optional().describe('Age range or descriptor like "late 20s"'),
  personality_traits: z.array(z.string()).describe('Personality descriptors extracted from query'),
  interests: z.array(z.string()).describe('Hobbies and interests mentioned'),
  lifestyle: z.array(z.string()).describe('Lifestyle signals like traveler, foodie, creative'),
  vibe_sentence: z.string().describe('A single sentence describing the overall vibe sought'),
})

type ParsedQuery = z.infer<typeof ParsedQuerySchema>

async function parseQuery(query: string): Promise<ParsedQuery> {
  const { object } = await generateObject({
    model: anthropic('claude-3-5-sonnet-20241022'),
    schema: ParsedQuerySchema,
    prompt: `Parse this dating search query into structured intent. 
    
Query: "${query}"

Extract location (default to Taipei if not specified), personality traits, interests, lifestyle signals, and write a clean vibe sentence describing what they're looking for.`,
  })
  return object
}

// Step 2: Convert parsed query to embedding for vector search
async function embedQuery(parsed: ParsedQuery): Promise<number[]> {
  // Build a rich text representation for embedding
  const embeddingText = [
    parsed.vibe_sentence,
    parsed.personality_traits.join(', '),
    parsed.interests.join(', '),
    parsed.lifestyle.join(', '),
  ].filter(Boolean).join('. ')

  // Use Supabase's built-in embedding or call OpenAI/Anthropic
  // For now, we call Supabase edge function that wraps the embedding model
  const { data, error } = await db.functions.invoke('embed', {
    body: { text: embeddingText }
  })

  if (error) throw new Error(`Embedding failed: ${error.message}`)
  return data.embedding as number[]
}

// Step 3: Run vector similarity search in Supabase
async function vectorSearch(embedding: number[], city: string, count = 10): Promise<SearchResult[]> {
  const { data, error } = await db.rpc('search_profiles', {
    query_embedding: embedding,
    city_filter: city,
    match_count: count,
    min_similarity: 0.55,
  })

  if (error) throw new Error(`Vector search failed: ${error.message}`)
  return data as SearchResult[]
}

// Step 4: Generate AI summary for each result
async function generateMatchSummary(
  result: SearchResult,
  parsed: ParsedQuery
): Promise<string> {
  const cacheKey = `summary:${result.profile_id}:${parsed.vibe_sentence.slice(0, 30)}`
  const cached = await getCached<string>(cacheKey)
  if (cached) return cached

  const { text } = await generateText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    system: `You write short, warm, specific match summaries for a dating discovery app. 
2-3 sentences max. Be specific about why this person matches what was searched.
Write in second person to the seeker ("She seems like..." / "He's the kind of person...").
Never be generic. Ground every sentence in real signal.`,
    prompt: `Seeker is looking for: "${parsed.vibe_sentence}"

Profile signals:
- Personality: ${result.personality_summary}
- Aesthetic: ${result.aesthetic_tags?.join(', ')}
- City/area: ${result.geo_clusters?.map(g => g.area).join(', ')}

Write a 2-3 sentence match summary explaining why this person matches what the seeker wants.`,
    maxTokens: 150,
  })

  await setCached(cacheKey, text)
  return text
}

// MAIN: Search Agent
export async function searchAgent(
  query: string,
  seekerTelegramId: number
): Promise<SearchResult[]> {
  console.log(`[SearchAgent] Query: "${query}"`)

  // Parse intent
  const parsed = await parseQuery(query)
  console.log(`[SearchAgent] Parsed:`, parsed)

  // Embed
  const embedding = await embedQuery(parsed)

  // Vector search — default to Taipei
  const city = parsed.city || 'Taipei'
  const rawResults = await vectorSearch(embedding, city)

  if (rawResults.length === 0) return []

  // Generate summaries in parallel
  const results = await Promise.all(
    rawResults.map(async (r) => ({
      ...r,
      ai_summary: await generateMatchSummary(r, parsed),
    }))
  )

  return results
}
