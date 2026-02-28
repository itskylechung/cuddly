import 'dotenv/config'
import { Bot, InlineKeyboard, session } from 'grammy'
import { db } from './lib/db.js'
import { getSession, setSession } from './lib/redis.js'
import { searchAgent } from './agents/searchAgent.js'
import { vibeCheckAgent } from './agents/vibeCheckAgent.js'
import { wingmanAgent } from './agents/wingmanAgent.js'
import { dateNudgeAgent } from './agents/dateNudgeAgent.js'
import type { SessionData, SearchResult } from './types/index.js'

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

// ─── HELPERS ────────────────────────────────────────────────────────────────

async function getOrCreateUser(telegramId: number, username?: string) {
  const { data: existing } = await db
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (existing) return existing

  const { data: created, error } = await db
    .from('users')
    .insert({ telegram_id: telegramId, telegram_username: username || null })
    .select()
    .single()

  if (error) throw error
  return created
}

async function spendCredit(userId: string, reason: string, reference?: string): Promise<boolean> {
  const { data: user } = await db.from('users').select('credits').eq('id', userId).single()
  if (!user || user.credits <= 0) return false

  await db.from('users').update({ credits: user.credits - 1 }).eq('id', userId)
  await db.from('credit_transactions').insert({
    user_id: userId,
    amount: -1,
    reason,
    reference,
  })
  return true
}

function formatMatchCard(result: SearchResult, index: number, total: number): string {
  const tags = result.aesthetic_tags?.slice(0, 3).map(t => `#${t.replace(/\s/g, '')}`).join(' ') || ''
  const city = result.geo_clusters?.[0]?.area || result.primary_city || 'Taipei'

  return `*${result.display_name || result.instagram_handle}* · 📍 ${city}
  
${result.ai_summary}

${tags}

_${index + 1} of ${total}_`
}

function matchCardKeyboard(profileId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔓 Unlock Full Profile', `unlock:${profileId}`)
    .text('❤️ Save', `save:${profileId}`)
    .row()
    .text('⏭️ Skip', 'next')
    .text('📋 More like this', 'more')
}

// ─── /start ─────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const telegramId = ctx.from!.id
  const username = ctx.from!.username

  await getOrCreateUser(telegramId, username)
  await setSession<SessionData>(telegramId, { step: 'idle' })

  await ctx.reply(
    `💝 *Welcome to Cuddly*\n\nFind people who match your actual life — not their dating app persona.\n\nI discover people through their Instagram presence, so matches are based on who they actually are.\n\n*How it works:*\n• People opt in by adding @cuddly to their Instagram bio\n• You search in natural language\n• I find people who genuinely match your vibe\n\nYou start with *3 free unlocks*. Want to be discoverable too? Add @cuddly to your Instagram bio.\n\n*Commands:*\n/search — find someone\n/matches — your saved matches\n/credits — check balance\n/profile — your settings`,
    { parse_mode: 'Markdown' }
  )
})

// ─── /search ─────────────────────────────────────────────────────────────────

bot.command('search', async (ctx) => {
  const telegramId = ctx.from!.id
  await setSession<SessionData>(telegramId, { step: 'searching' })

  await ctx.reply(
    `🔍 *Who are you looking for?*\n\nJust describe them naturally — personality, lifestyle, interests, where they hang out. The more specific, the better.\n\n_Example: "Someone in Da'an who's into specialty coffee and film photography, seems introspective but has a dry sense of humor"_`,
    { parse_mode: 'Markdown' }
  )
})

// ─── /matches ────────────────────────────────────────────────────────────────

bot.command('matches', async (ctx) => {
  const telegramId = ctx.from!.id
  const user = await getOrCreateUser(telegramId)

  const { data: matches } = await db
    .from('matches')
    .select('*, profile:profiles!profile_id(instagram_handle, display_name, profile_photo_url)')
    .eq('seeker_id', user.id)
    .neq('seeker_status', 'passed')
    .order('created_at', { ascending: false })
    .limit(10)

  if (!matches || matches.length === 0) {
    await ctx.reply('You have no saved matches yet. Use /search to find someone! 💝')
    return
  }

  await ctx.reply(`*Your Matches* (${matches.length})\n\nTap one to open:`, { parse_mode: 'Markdown' })

  for (const match of matches) {
    const profile = match.profile as any
    const kb = new InlineKeyboard()
      .text('🤝 Wingman', `wingman:${match.id}`)
      .text('📍 Date Idea', `datenudge:${match.id}`)

    await ctx.reply(
      `@${profile.instagram_handle}${match.is_mutual ? ' 💝 Mutual match!' : ''}`,
      { reply_markup: kb }
    )
  }
})

// ─── /credits ────────────────────────────────────────────────────────────────

bot.command('credits', async (ctx) => {
  const user = await getOrCreateUser(ctx.from!.id)

  const kb = new InlineKeyboard()
    .text('💳 Buy 25 credits — $9.99', 'buy:credits25')
    .row()
    .text('⭐ Spark Plan $9.99/mo', 'buy:spark')
    .text('🔥 Flame Plan $24.99/mo', 'buy:flame')

  await ctx.reply(
    `💳 *Your Credits*\n\nBalance: *${user.credits} unlocks*\nPlan: ${user.plan}\n\nTop up:`,
    { parse_mode: 'Markdown', reply_markup: kb }
  )
})

// ─── /wingman ────────────────────────────────────────────────────────────────

bot.command('wingman', async (ctx) => {
  const telegramId = ctx.from!.id
  const session = await getSession<SessionData>(telegramId)

  if (!session?.activeMatchId) {
    await ctx.reply('Select a match first from /matches, then use Wingman from there.')
    return
  }

  await setSession<SessionData>(telegramId, { ...session, step: 'wingman' })
  await ctx.reply(
    `🤝 *Wingman mode active*\n\nPaste what they just said and I'll give you 3 reply options.\n\nOr ask me anything: "is this going well?", "should I suggest meeting?"`,
    { parse_mode: 'Markdown' }
  )
})

// ─── MESSAGE HANDLER (free text) ─────────────────────────────────────────────

bot.on('message:text', async (ctx) => {
  const telegramId = ctx.from!.id
  const session = await getSession<SessionData>(telegramId) || { step: 'idle' as const }
  const text = ctx.message.text

  // Searching mode
  if (session.step === 'searching') {
    const user = await getOrCreateUser(telegramId)

    // Check monthly search limit for free plan
    if (user.plan === 'free' && user.searches_this_month >= 3) {
      await ctx.reply('You\'ve used your 3 free searches this month. Upgrade to Spark for 20 searches: /credits')
      return
    }

    const loadingMsg = await ctx.reply('🔍 Searching...')

    try {
      const results = await searchAgent(text, telegramId)

      // Update search count
      await db.from('users').update({
        searches_this_month: user.searches_this_month + 1
      }).eq('id', user.id)

      if (results.length === 0) {
        await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)
        await ctx.reply('No matches found for that search. Try different words or be less specific.')
        return
      }

      // Save results to session
      await setSession<SessionData>(telegramId, {
        step: 'viewing_results',
        searchQuery: text,
        searchResults: results,
        resultIndex: 0,
      })

      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)

      // Send first card
      const first = results[0]
      await sendMatchCard(ctx, first, 0, results.length)
    } catch (err) {
      console.error('[Search error]', err)
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)
      await ctx.reply('Something went wrong with that search. Try again?')
    }
    return
  }

  // Wingman mode
  if (session.step === 'wingman' && session.activeMatchId) {
    const loadingMsg = await ctx.reply('🤝 Thinking...')

    try {
      const response = await wingmanAgent(session.activeMatchId, text)
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)

      const kb = new InlineKeyboard()
        .text('1️⃣ Send', `copy:${encodeURIComponent(response.suggestions[0])}`)
        .row()
        .text('2️⃣ Send', `copy:${encodeURIComponent(response.suggestions[1])}`)
        .row()
        .text('3️⃣ Send', `copy:${encodeURIComponent(response.suggestions[2])}`)

      let reply = `*3 options for you:*\n\n`
      reply += `1️⃣ ${response.suggestions[0]}\n\n`
      reply += `2️⃣ ${response.suggestions[1]}\n\n`
      reply += `3️⃣ ${response.suggestions[2]}`

      if (response.coaching_note) {
        reply += `\n\n💡 _${response.coaching_note}_`
      }

      if (response.should_nudge_date) {
        reply += `\n\n📍 _Feeling like it might be time to suggest meeting IRL? Use /matches → Date Idea_`
      }

      await ctx.reply(reply, { parse_mode: 'Markdown', reply_markup: kb })
    } catch (err) {
      console.error('[Wingman error]', err)
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)
      await ctx.reply('Hmm, couldn\'t generate suggestions. Try again.')
    }
    return
  }

  // Default fallback
  await ctx.reply('Use /search to find someone, or /help for all commands.')
})

// ─── CALLBACK QUERIES (inline button taps) ───────────────────────────────────

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data
  const telegramId = ctx.from!.id
  const session = await getSession<SessionData>(telegramId) || { step: 'idle' as const }

  await ctx.answerCallbackQuery()

  // Next result
  if (data === 'next' || data === 'more') {
    if (!session.searchResults) return
    const nextIndex = (session.resultIndex || 0) + 1

    if (nextIndex >= session.searchResults.length) {
      await ctx.reply('No more results for this search. Try /search with different words.')
      return
    }

    await setSession<SessionData>(telegramId, { ...session, resultIndex: nextIndex })
    await sendMatchCard(ctx, session.searchResults[nextIndex], nextIndex, session.searchResults.length)
    return
  }

  // Unlock
  if (data.startsWith('unlock:')) {
    const profileId = data.replace('unlock:', '')
    const user = await getOrCreateUser(telegramId)

    // Check existing unlock
    const { data: existing } = await db
      .from('unlocks')
      .select('vibe_check, sparks')
      .eq('seeker_id', user.id)
      .eq('profile_id', profileId)
      .maybeSingle()

    if (existing?.vibe_check) {
      // Already unlocked - show cached
      await sendVibeCheck(ctx, existing.vibe_check as any, existing.sparks || [], profileId, user.id)
      return
    }

    // Spend credit
    const success = await spendCredit(user.id, 'unlock', profileId)
    if (!success) {
      await ctx.reply('You\'re out of unlock credits! Top up at /credits 💳')
      return
    }

    const loadingMsg = await ctx.reply('✨ Running Vibe Check...')

    try {
      const vibeCheck = await vibeCheckAgent(profileId)

      // Save unlock to DB
      await db.from('unlocks').upsert({
        seeker_id: user.id,
        profile_id: profileId,
        vibe_check: vibeCheck,
        sparks: vibeCheck.sparks,
        credits_spent: 1,
      }, { onConflict: 'seeker_id,profile_id' })

      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)
      await sendVibeCheck(ctx, vibeCheck, vibeCheck.sparks, profileId, user.id)
    } catch (err) {
      console.error('[Vibe Check error]', err)
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)
      await ctx.reply('Couldn\'t generate Vibe Check. Your credit has been refunded.')
      // Refund
      await db.from('users').update({ credits: (await db.from('users').select('credits').eq('id', user.id).single()).data!.credits + 1 }).eq('id', user.id)
    }
    return
  }

  // Save match
  if (data.startsWith('save:')) {
    const profileId = data.replace('save:', '')
    const user = await getOrCreateUser(telegramId)

    await db.from('matches').upsert({
      seeker_id: user.id,
      profile_id: profileId,
      seeker_status: 'saved',
    }, { onConflict: 'seeker_id,profile_id' })

    await ctx.reply('❤️ Saved! Find them in /matches')
    return
  }

  // Open Wingman
  if (data.startsWith('wingman:')) {
    const matchId = data.replace('wingman:', '')
    await setSession<SessionData>(telegramId, { ...session, step: 'wingman', activeMatchId: matchId })
    await ctx.reply(
      `🤝 *Wingman active!*\n\nPaste what they just said and I'll suggest 3 replies.\n\nOr ask: "is this going well?" / "should I suggest meeting?"`,
      { parse_mode: 'Markdown' }
    )
    return
  }

  // Date nudge
  if (data.startsWith('datenudge:')) {
    const matchId = data.replace('datenudge:', '')
    const loadingMsg = await ctx.reply('📍 Finding the perfect spot...')

    try {
      const nudge = await dateNudgeAgent(matchId)
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)

      if (!nudge) {
        await ctx.reply('No date suggestion available yet. Keep the conversation going!')
        return
      }

      await ctx.reply(
        `📍 *Date Idea*\n\n*${nudge.venue_name}*\n${nudge.venue_type} · ${nudge.neighborhood}\n\n${nudge.why_them}\n\n*Suggested message:*\n_"${nudge.suggested_message}"_`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id)
      await ctx.reply('Couldn\'t generate a date idea. Try again later.')
    }
    return
  }
})

// ─── HELPER: send match card ─────────────────────────────────────────────────

async function sendMatchCard(ctx: any, result: SearchResult, index: number, total: number) {
  const text = formatMatchCard(result, index, total)
  const kb = matchCardKeyboard(result.profile_id)

  if (result.profile_photo_url) {
    try {
      await ctx.replyWithPhoto(result.profile_photo_url, {
        caption: text,
        parse_mode: 'Markdown',
        reply_markup: kb,
      })
      return
    } catch {
      // Fall through to text-only if photo fails
    }
  }

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb })
}

// ─── HELPER: send vibe check ─────────────────────────────────────────────────

async function sendVibeCheck(ctx: any, vibeCheck: any, sparks: string[], profileId: string, userId: string) {
  const text = `✨ *Vibe Check*\n\n*Aesthetic*\n${vibeCheck.aesthetic}\n\n*Personality*\n${vibeCheck.personality}\n\n*Lifestyle*\n${vibeCheck.lifestyle}\n\n*Interests*\n${vibeCheck.interests?.map((i: string) => `#${i.replace(/\s/g, '')}`).join(' ')}`

  const kb = new InlineKeyboard()
    .text('💬 Spark 1', `spark:0:${profileId}`)
    .row()
    .text('💬 Spark 2', `spark:1:${profileId}`)
    .row()
    .text('💬 Spark 3', `spark:2:${profileId}`)
    .row()
    .text('❤️ Save Match', `save:${profileId}`)
    .text('🤝 Open Wingman', `wingman_setup:${profileId}`)

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb })

  // Show sparks inline
  await ctx.reply(
    `*Conversation Sparks:*\n\n1. _${sparks[0]}_\n\n2. _${sparks[1]}_\n\n3. _${sparks[2]}_`,
    { parse_mode: 'Markdown' }
  )
}

// ─── START BOT ───────────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error('Bot error:', err)
})

console.log('🤖 @matchacuddlybot starting...')
bot.start()
