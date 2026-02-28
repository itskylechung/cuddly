# 💝 Cuddly — @matchacuddlybot

Instagram-native AI dating discovery via Telegram.

## Stack
- **Bot**: grammY (Telegram Bot Framework for Node.js)
- **AI Agents**: Vercel AI SDK + Anthropic claude-3-5-sonnet
- **Database**: Supabase (Insforge) with pgvector
- **Sessions**: Redis (Upstash or local)
- **Language**: TypeScript + Node.js (ESM)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env
# Fill in: TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL

# 3. Set up database
# Run supabase/schema.sql in your Supabase SQL editor
# This creates all tables, indexes, vector search function

# 4. Run in dev mode
npm run dev
```

## Project Structure

```
src/
  bot.ts              — Main Telegram bot, all commands + callback handlers
  lib/
    ai.ts             — Anthropic AI SDK client
    db.ts             — Supabase client
    redis.ts          — Redis client + session helpers
  agents/
    searchAgent.ts    — Natural language → vector search → Match Cards
    vibeCheckAgent.ts — Full personality read on profile unlock
    wingmanAgent.ts   — Real-time conversation coaching
    dateNudgeAgent.ts — IRL meeting suggestion with Taipei venue
  types/
    index.ts          — All TypeScript types
supabase/
  schema.sql          — Full DB schema (run this once in Supabase)
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Onboarding + help |
| `/search` | Natural language profile search |
| `/matches` | View saved matches |
| `/wingman` | Activate conversation coach |
| `/credits` | Check balance + top up |
| `/profile` | Your settings |
| `/help` | Command reference |

## Adding the Crawler

When your crawler is ready, it should:
1. Insert into `profiles` table with `crawl_status: 'pending'`
2. Insert raw `posts` for that profile
3. Trigger the analysis pipeline (NLP + embeddings) → populate `profile_analyses`
4. Update `crawl_status` to `'complete'` and set `is_discoverable: true`

The `search_profiles` Supabase function handles all vector similarity queries.

## Environment Variables

```
TELEGRAM_BOT_TOKEN      — From @BotFather (keep secret!)
ANTHROPIC_API_KEY       — From console.anthropic.com
SUPABASE_URL            — Your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY — Service role key (bypasses RLS)
REDIS_URL               — Redis connection string
NODE_ENV                — development | production
```

## ⚠️ Security

- Never commit `.env` to git
- Add `.env` to `.gitignore`
- Rotate your bot token if ever exposed: /revoke in @BotFather
