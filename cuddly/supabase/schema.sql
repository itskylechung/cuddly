-- ============================================================
-- CUDDLY DATABASE SCHEMA
-- Run this in Supabase SQL editor or via migration
-- Requires: pgvector extension
-- ============================================================

-- Enable pgvector for embeddings
create extension if not exists vector;

-- ============================================================
-- USERS TABLE
-- Telegram users who have interacted with @matchacuddlybot
-- ============================================================
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  telegram_id     bigint unique not null,
  telegram_username text,
  instagram_handle text,
  credits         integer not null default 3, -- free tier starts with 3
  plan            text not null default 'free' check (plan in ('free', 'spark', 'flame')),
  plan_expires_at timestamptz,
  searches_this_month integer not null default 0,
  unlocks_this_month  integer not null default 0,
  month_reset_at  timestamptz not null default date_trunc('month', now()) + interval '1 month',
  taipei_area     boolean not null default true, -- Taipei-first
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- PROFILES TABLE
-- Indexed Instagram profiles (opted in via @cuddly in bio)
-- ============================================================
create table if not exists profiles (
  id                uuid primary key default gen_random_uuid(),
  instagram_handle  text unique not null,
  instagram_url     text,
  display_name      text,
  bio_text          text,
  profile_photo_url text,
  follower_count    integer,
  following_count   integer,
  post_count        integer,
  location_text     text,               -- raw location from bio
  is_discoverable   boolean not null default true,
  opted_in_at       timestamptz not null default now(),
  opted_out_at      timestamptz,        -- set when @cuddly removed
  last_crawled_at   timestamptz,
  next_crawl_at     timestamptz,
  crawl_status      text not null default 'pending' check (crawl_status in ('pending', 'crawling', 'complete', 'error')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================
-- PROFILE ANALYSIS TABLE
-- NLP + vision pipeline outputs — separated from raw profile
-- for clean re-processing without losing raw data
-- ============================================================
create table if not exists profile_analyses (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references profiles(id) on delete cascade,
  
  -- NLP outputs
  personality_summary   text,           -- 2-3 sentence personality read
  writing_style         text,           -- analytical, poetic, dry-humour, etc.
  emotional_register    text,           -- warm, reserved, intense, playful, etc.
  humor_type            text,           -- self-deprecating, observational, absurdist, none
  topics_corpus         text[],         -- recurring topics extracted from captions
  hashtag_clusters      jsonb,          -- { "food": 12, "travel": 8, "coffee": 6 }
  
  -- Geo intelligence
  geo_clusters          jsonb,          -- [{ "area": "Da'an", "city": "Taipei", "count": 14 }]
  primary_city          text,           -- "Taipei"
  neighborhoods         text[],         -- ["Da'an", "Xinyi", "Zhongzheng"]
  
  -- Aesthetic
  aesthetic_tags        text[],         -- ["minimalist", "film photography", "cafe culture"]
  color_palette         text,           -- "warm neutrals", "muted greens", "high contrast"
  
  -- Activity
  post_frequency        text,           -- "daily", "2-3x/week", "weekly", "sporadic"
  active_hours          text,           -- "evenings", "weekends", "mornings"
  content_type_ratio    jsonb,          -- { "reels": 0.4, "photos": 0.5, "carousels": 0.1 }
  
  -- Embeddings
  personality_embedding vector(1536),  -- for semantic similarity search (OpenAI ada-002 dims)
  aesthetic_embedding   vector(1536),
  
  -- Metadata
  model_version         text not null default 'v1',
  processed_at          timestamptz not null default now(),
  
  unique(profile_id)
);

-- ============================================================
-- POSTS TABLE
-- Last 50 posts per profile — raw signal source
-- ============================================================
create table if not exists posts (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles(id) on delete cascade,
  instagram_post_id text not null,
  caption           text,
  hashtags          text[],
  tagged_location   text,
  tagged_lat        double precision,
  tagged_lng        double precision,
  post_type         text check (post_type in ('photo', 'reel', 'carousel')),
  thumbnail_url     text,
  like_count        integer,
  comment_count     integer,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique(instagram_post_id)
);

-- ============================================================
-- SEARCHES TABLE
-- Log every search query for analytics + personalization
-- ============================================================
create table if not exists searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  query_text    text not null,
  parsed_intent jsonb,           -- { location, age_range, interests, personality_traits }
  result_count  integer,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- UNLOCKS TABLE
-- Track which profiles a seeker has unlocked (Vibe Check)
-- ============================================================
create table if not exists unlocks (
  id             uuid primary key default gen_random_uuid(),
  seeker_id      uuid not null references users(id) on delete cascade,
  profile_id     uuid not null references profiles(id) on delete cascade,
  vibe_check     jsonb,          -- cached Vibe Check Agent output
  sparks         text[],         -- 3 conversation sparks
  credits_spent  integer not null default 1,
  created_at     timestamptz not null default now(),
  unique(seeker_id, profile_id)
);

-- ============================================================
-- MATCHES TABLE
-- Saved/mutual matches between seekers and profiles
-- ============================================================
create table if not exists matches (
  id              uuid primary key default gen_random_uuid(),
  seeker_id       uuid not null references users(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  seeker_status   text not null default 'saved' check (seeker_status in ('saved', 'messaging', 'met', 'passed')),
  match_brief     text,          -- Match Brief Agent output (when mutual)
  is_mutual       boolean not null default false,
  brief_sent_at   timestamptz,
  date_nudge_sent_at timestamptz,
  date_nudge_venue   text,
  met_irl         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(seeker_id, profile_id)
);

-- ============================================================
-- WINGMAN SESSIONS TABLE
-- Per-match coaching session context (cached for Wingman Agent)
-- ============================================================
create table if not exists wingman_sessions (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id) on delete cascade,
  message_count   integer not null default 0,
  last_context    text,          -- last message pasted by seeker
  suggestions     text[],        -- last 3 suggestions returned
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(match_id)
);

-- ============================================================
-- CREDIT TRANSACTIONS TABLE
-- Audit trail for all credit changes
-- ============================================================
create table if not exists credit_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  amount      integer not null,  -- positive = added, negative = spent
  reason      text not null,     -- 'unlock', 'purchase', 'refund', 'signup_bonus'
  reference   text,              -- unlock ID or Telegram payment ID
  created_at  timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Profile search
create index if not exists idx_profiles_discoverable on profiles(is_discoverable) where is_discoverable = true;
create index if not exists idx_profiles_crawl_status on profiles(crawl_status);
create index if not exists idx_profiles_handle on profiles(instagram_handle);

-- Vector similarity search (HNSW for fast ANN queries)
create index if not exists idx_personality_embedding on profile_analyses 
  using hnsw (personality_embedding vector_cosine_ops);
create index if not exists idx_aesthetic_embedding on profile_analyses 
  using hnsw (aesthetic_embedding vector_cosine_ops);

-- GEO queries
create index if not exists idx_analysis_city on profile_analyses(primary_city);

-- User lookups
create index if not exists idx_users_telegram on users(telegram_id);

-- Match queries
create index if not exists idx_matches_seeker on matches(seeker_id);
create index if not exists idx_unlocks_seeker on unlocks(seeker_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table users enable row level security;
alter table profiles enable row level security;
alter table profile_analyses enable row level security;
alter table posts enable row level security;
alter table searches enable row level security;
alter table unlocks enable row level security;
alter table matches enable row level security;
alter table wingman_sessions enable row level security;
alter table credit_transactions enable row level security;

-- Service role bypasses RLS (for our backend)
-- Anon/user role policies can be added later for direct client access

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at before update on users
  for each row execute function update_updated_at();

create trigger profiles_updated_at before update on profiles
  for each row execute function update_updated_at();

create trigger matches_updated_at before update on matches
  for each row execute function update_updated_at();

-- Reset monthly usage counters
create or replace function reset_monthly_usage()
returns void as $$
begin
  update users
  set 
    searches_this_month = 0,
    unlocks_this_month = 0,
    month_reset_at = date_trunc('month', now()) + interval '1 month'
  where month_reset_at <= now();
end;
$$ language plpgsql;

-- Semantic profile search function
-- Call this from your Search Agent instead of raw SQL
create or replace function search_profiles(
  query_embedding vector(1536),
  city_filter text default null,
  match_count int default 10,
  min_similarity float default 0.6
)
returns table (
  profile_id uuid,
  instagram_handle text,
  display_name text,
  profile_photo_url text,
  similarity float,
  personality_summary text,
  aesthetic_tags text[],
  geo_clusters jsonb,
  primary_city text
)
language sql stable
as $$
  select
    p.id as profile_id,
    p.instagram_handle,
    p.display_name,
    p.profile_photo_url,
    1 - (pa.personality_embedding <=> query_embedding) as similarity,
    pa.personality_summary,
    pa.aesthetic_tags,
    pa.geo_clusters,
    pa.primary_city
  from profiles p
  join profile_analyses pa on pa.profile_id = p.id
  where
    p.is_discoverable = true
    and p.opted_out_at is null
    and (city_filter is null or pa.primary_city ilike city_filter)
    and 1 - (pa.personality_embedding <=> query_embedding) > min_similarity
  order by pa.personality_embedding <=> query_embedding
  limit match_count;
$$;
