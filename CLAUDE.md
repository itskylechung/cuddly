# Cuddly — @matchacuddlybot
## Claude Code Project Briefing

> Instagram-native AI dating discovery via Telegram. People opt in by adding @cuddly to their Instagram bio. Seekers search in natural language. AI agents match based on authentic Instagram signals.

---

## Stack
- **Bot**: grammY (Telegram, Node.js)
- **AI Agents**: Vercel AI SDK + Anthropic `claude-3-5-sonnet-20241022`
- **Database**: Supabase (Insforge) with pgvector extension
- **Sessions**: Redis (conversation state per Telegram user)
- **Language**: TypeScript, Node.js ESM

## Project Structure
```
src/
  bot.ts                  ← Main entry point. All Telegram commands + callback handlers
  lib/
    ai.ts                 ← Anthropic AI SDK client
    db.ts                 ← Supabase client
    redis.ts              ← Redis client + session/cache helpers
  agents/
    searchAgent.ts        ← Natural language → vector search → Match Card summaries
    vibeCheckAgent.ts     ← Full personality read on profile unlock (costs 1 credit)
    wingmanAgent.ts       ← Real-time conversation coaching (3 suggestions per message)
    dateNudgeAgent.ts     ← Taipei venue suggestion for IRL meeting
  types/
    index.ts              ← All TypeScript types matching DB schema
supabase/
  schema.sql              ← Full DB schema — run once in Supabase SQL editor
```

## Environment Variables (see .env.example)
```
TELEGRAM_BOT_TOKEN        ← From @BotFather — KEEP SECRET
ANTHROPIC_API_KEY         ← From console.anthropic.com
SUPABASE_URL              ← Insforge/Supabase project URL
SUPABASE_SERVICE_ROLE_KEY ← Service role key (bypasses RLS)
REDIS_URL                 ← Redis connection string
```

## Bot Commands
| Command | Handler | Notes |
|---------|---------|-------|
| `/start` | `bot.command('start')` | Onboarding, creates user row |
| `/search` | `bot.command('search')` | Sets session step to 'searching' |
| `/matches` | `bot.command('matches')` | Lists saved matches with action buttons |
| `/credits` | `bot.command('credits')` | Shows balance + purchase options |
| `/wingman` | `bot.command('wingman')` | Activates coaching mode for active match |

## Session State (Redis)
Each Telegram user has a session with shape `SessionData`:
```typescript
{
  step: 'idle' | 'searching' | 'viewing_results' | 'wingman' | 'onboarding'
  searchQuery?: string
  searchResults?: SearchResult[]
  resultIndex?: number
  activeMatchId?: string
  activeProfileId?: string
}
```
Free text messages are routed based on `session.step`.

## Agents — How They Work

### Search Agent (`searchAgent.ts`)
1. Parse natural language query → structured intent (via `generateObject`)
2. Convert intent to text → embed (via Supabase Edge Function `embed`)
3. Run `search_profiles()` Supabase RPC (HNSW vector search)
4. Generate Match Card summaries per result (via `generateText`)
5. Return `SearchResult[]`

### Vibe Check Agent (`vibeCheckAgent.ts`)
- Called on unlock (costs 1 credit)
- Reads profile + all posts from DB
- Returns: aesthetic, personality, lifestyle reads + 3 conversation sparks
- Output cached in Redis + saved to `unlocks` table

### Wingman Agent (`wingmanAgent.ts`)
- Called with match context + message pasted by seeker
- Returns 3 reply suggestions (warm / playful / substantive)
- Tracks message count in `wingman_sessions`
- Sets `should_nudge_date: true` after ~10 messages

### Date Nudge Agent (`dateNudgeAgent.ts`)
- Returns a specific Taipei venue + suggested message
- All venues in Taipei (Da'an, Zhongshan, Xinyi, Zhongzheng focus)
- Marks `date_nudge_sent_at` in `matches` table after running

## Database Key Tables
- `users` — Telegram users, credits, plan
- `profiles` — opted-in Instagram profiles
- `profile_analyses` — NLP outputs + vector embeddings (1536-dim)
- `posts` — raw posts (last 50 per profile)
- `unlocks` — seeker × profile Vibe Check cache
- `matches` — saved/mutual matches
- `wingman_sessions` — Wingman Agent context per match

## ⚠️ Pending / Not Yet Built
- [ ] **Embedding function**: `searchAgent.ts` calls `db.functions.invoke('embed', ...)` — needs a Supabase Edge Function or direct API call to generate embeddings. Decide: use `@anthropic/vertex-ai` or OpenAI `text-embedding-ada-002`.
- [ ] **Crawler integration**: Schema is ready. Crawler inserts into `profiles` + `posts`, runs NLP pipeline, populates `profile_analyses` with embeddings, sets `is_discoverable: true`.
- [ ] **NLP pipeline**: After crawler, need a pipeline that processes raw posts → `profile_analyses` columns (personality_summary, geo_clusters, aesthetic_tags, etc.)
- [ ] **Telegram Payments**: `/credits` shows the buy buttons but payment flow not wired up yet.
- [ ] **Webhook mode**: Currently using long polling (`bot.start()`). For production, switch to webhook with `bot.api.setWebhook(url)`.
- [ ] **Profile opt-out**: When @cuddly is removed from bio, set `opted_out_at` and `is_discoverable: false`.
- [ ] **Notification system**: Telegram push for profile indexed, mutual match, weekly digest, date nudge.
- [ ] **Rate limiting**: `/search` checks monthly count but no request-level rate limiting yet.

## Development Commands
```bash
npm run dev     # Start bot with hot reload (tsx watch)
npm run build   # Compile TypeScript
npm start       # Run compiled bot
```

## Coding Conventions
- All agents are pure async functions — no classes, no shared state
- Session state lives in Redis only — never in memory
- DB calls go through `src/lib/db.ts` Supabase client (service role)
- Agent outputs are Zod-validated via AI SDK `generateObject`
- Cache expensive agent calls: `getCached()` / `setCached()` from `redis.ts`
- Never log credentials or user message content

## Target Market
Taipei-first. Geo logic defaults to `city_filter: 'Taipei'`. Neighborhoods of interest: Da'an, Zhongshan, Xinyi, Zhongzheng.
