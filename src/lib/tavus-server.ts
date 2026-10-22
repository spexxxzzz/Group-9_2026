/** Server-only Tavus gateway. Never import this from browser code. */
import type { Env } from '../../worker'

const TAVUS_API_URL = 'https://tavusapi.com/v2'

export type TavusOperation =
  | 'list-replicas'
  | 'create-persona'
  | 'create-conversation'
  | 'get-conversation'
  | 'end-conversation'

export class TavusApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'TavusApiError'
  }
}

/** Only disable credentials for clear account/allowance failures, not transient 429s. */
export function tavusKeyIsUnusable(error: unknown): boolean {
  if (!(error instanceof TavusApiError)) return false
  if ([401, 402, 403].includes(error.status)) return true
  return /quota|credit|balance|allowance|monthly|billing|plan limit/i.test(error.message)
}

export async function callTavus(
  env: Pick<Env, 'TAVUS_API_KEY'>,
  operation: TavusOperation,
  params: Record<string, unknown> = {},
  apiKey?: string,
): Promise<unknown> {
  const key = apiKey || env.TAVUS_API_KEY
  if (!key) throw new Error('Tavus is not configured')

  let method = 'POST'
  let path = ''
  let body: string | undefined

  switch (operation) {
    case 'list-replicas': {
      method = 'GET'
      const query = new URLSearchParams()
      if (typeof params.replica_type === 'string') query.set('replica_type', params.replica_type)
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      path = `/replicas${query.size ? `?${query}` : ''}`
      break
    }
    case 'create-persona':
      path = '/personas'
      body = JSON.stringify(params)
      break
    case 'create-conversation':
      path = '/conversations'
      body = JSON.stringify(params)
      break
    case 'get-conversation': {
      method = 'GET'
      const id = typeof params.conversation_id === 'string' ? params.conversation_id : ''
      if (!id) throw new Error('Missing conversation_id')
      path = `/conversations/${encodeURIComponent(id)}?verbose=true`
      break
    }
    case 'end-conversation': {
      const id = typeof params.conversation_id === 'string' ? params.conversation_id : ''
      if (!id) throw new Error('Missing conversation_id')
      path = `/conversations/${encodeURIComponent(id)}/end`
      body = JSON.stringify({})
      break
    }
  }

  const response = await fetch(`${TAVUS_API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body,
  })
  const text = await response.text()
  let data: Record<string, unknown>
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {}
  } catch {
    data = { message: text.slice(0, 300) }
  }
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : `Tavus request failed (HTTP ${response.status})`
    throw new TavusApiError(message, response.status)
  }
  return data
}
