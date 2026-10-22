/** Server-only Tavus key slots. Keys never enter records, responses, or logs. */
import type { Env } from '../../worker'

export const MAX_CONVERSATIONS_PER_KEY = 5

const SLOT_NAMES = [
  'TAVUS_API_KEY_1', 'TAVUS_API_KEY_2', 'TAVUS_API_KEY_3', 'TAVUS_API_KEY_4',
  'TAVUS_API_KEY_5', 'TAVUS_API_KEY_6', 'TAVUS_API_KEY_7', 'TAVUS_API_KEY_8',
  'TAVUS_API_KEY_9', 'TAVUS_API_KEY_10',
] as const

export function configuredTavusSlots(env: Env): number[] {
  const seen = new Set<string>()
  return SLOT_NAMES.flatMap((name, index) => {
    const key = env[name]?.trim()
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [index + 1]
  })
}

export function tavusKeyForSlot(env: Env, slot: number): string {
  if (slot === 0 && env.TAVUS_API_KEY) return env.TAVUS_API_KEY
  const name = SLOT_NAMES[slot - 1]
  const key = name && env[name]?.trim()
  if (!key) throw new Error(`Tavus key slot ${slot} is no longer configured`)
  return key
}

export interface SlotUsage {
  slot: number
  used: number
  pending: number
  disabled: boolean
  cooldownUntil?: number
}

/** Lowest usage first: each configured key gets one call before any gets two. */
export function chooseTavusSlot(usage: SlotUsage[], limit = MAX_CONVERSATIONS_PER_KEY, now = Date.now()): number | null {
  const available = usage
    .filter(({ used, pending, disabled, cooldownUntil }) =>
      !disabled && used + pending < limit && (cooldownUntil ?? 0) <= now)
    .sort((a, b) =>
      (a.used + a.pending) - (b.used + b.pending) ||
      a.used - b.used ||
      a.slot - b.slot,
    )
  return available[0]?.slot ?? null
}

export interface TavusAssignment {
  interviewId: string
  slot: number
  state: 'reserved' | 'persona-creating' | 'creating' | 'active'
  personaId?: string
  replicaId?: string
  conversationId?: string
  conversationUrl?: string
  conversationCreatedAt?: string
}

export async function tavusPoolAction<T>(
  env: Env,
  action: string,
  params: Record<string, unknown>,
): Promise<T> {
  const stub = env.TAVUS_KEY_POOL.get(env.TAVUS_KEY_POOL.idFromName('global'))
  const response = await stub.fetch(new Request('https://internal/tavus-key-pool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  }))
  const result = await response.json() as { data?: T; error?: string }
  if (!response.ok || !result.data) throw new Error(result.error || 'Tavus key pool unavailable')
  return result.data
}

export async function tavusKeyForConversation(env: Env, conversationId: string): Promise<string> {
  const assignment = await tavusPoolAction<TavusAssignment | { found: false }>(
    env, 'by-conversation', { conversationId },
  )
  if ('found' in assignment) {
    // Conversations created before the pool rollout belong to the old key.
    if (!env.TAVUS_API_KEY) throw new Error('Legacy Tavus key is unavailable')
    return env.TAVUS_API_KEY
  }
  return tavusKeyForSlot(env, assignment.slot)
}
