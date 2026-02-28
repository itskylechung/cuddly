import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

redis.on('error', (err) => console.error('Redis error:', err))

// Session helpers
export const SESSION_TTL = 60 * 60 * 24 // 24 hours

export async function getSession<T>(telegramId: number): Promise<T | null> {
  const data = await redis.get(`session:${telegramId}`)
  return data ? JSON.parse(data) : null
}

export async function setSession<T>(telegramId: number, data: T): Promise<void> {
  await redis.setex(`session:${telegramId}`, SESSION_TTL, JSON.stringify(data))
}

export async function clearSession(telegramId: number): Promise<void> {
  await redis.del(`session:${telegramId}`)
}

// Cache helpers for agent outputs (24h TTL)
export const CACHE_TTL = 60 * 60 * 24

export async function getCached<T>(key: string): Promise<T | null> {
  const data = await redis.get(`cache:${key}`)
  return data ? JSON.parse(data) : null
}

export async function setCached<T>(key: string, data: T): Promise<void> {
  await redis.setex(`cache:${key}`, CACHE_TTL, JSON.stringify(data))
}
