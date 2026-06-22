/** Thin client for the Pedro backend (POST /v6/* · HMAC X-Signature). */
import crypto from 'crypto'

export interface PedroChatMessage {
  role: 'user' | 'assistant'
  content: string
}
export interface PedroReplyResult {
  text: string
  model_used: string
  latency_ms: number
}
export interface PedroSlot {
  start_iso: string
  end_iso: string
}
export interface PedroBookResult {
  event_id: string
  meet_link: string
  synthetic: boolean
}

export class PedroClient {
  constructor(
    private baseUrl: string,
    private hmacSecret: string,
  ) {}

  private async post<T>(path: string, payload: unknown, timeoutMs: number): Promise<T> {
    const body = JSON.stringify(payload)
    const signature =
      'sha256=' + crypto.createHmac('sha256', this.hmacSecret).update(body).digest('hex')
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Signature': signature },
      body,
      signal:
        typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
    })
    if (!res.ok) throw new Error(`pedro ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  async reply(systemPrompt: string, messages: PedroChatMessage[]): Promise<PedroReplyResult> {
    return this.post('/v6/llm/reply', { system_prompt: systemPrompt, messages }, 60_000)
  }

  async calendarSlots(): Promise<{ slots: PedroSlot[] }> {
    return this.post('/v6/calendar/slots', {}, 15_000)
  }

  async calendarBook(input: {
    start_iso: string
    end_iso: string
    phone: string
    lead_name?: string | null
  }): Promise<PedroBookResult> {
    return this.post('/v6/calendar/book', input, 15_000)
  }
}

/** Singleton from env (server-only). */
export function pedroFromEnv(): PedroClient {
  const url = process.env.PEDRO_LLM_URL
  const secret = process.env.PEDRO_LLM_HMAC_SECRET
  if (!url || !secret) throw new Error('PEDRO_LLM_URL/PEDRO_LLM_HMAC_SECRET not set')
  return new PedroClient(url.replace(/\/$/, ''), secret)
}
