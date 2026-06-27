import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendUazapiText, isReachoutBlock } from './uazapi-send'

const ARGS = { baseUrl: 'https://x.uazapi.com', token: 'tok', number: '5511999999999', text: 'oi' }

// Mock a single fetch response (UazAPI /send/text reply).
function mockResponse(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

describe('sendUazapiText — error enrichment', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('attaches the HTTP status and raw body to the thrown error', async () => {
    mockResponse(463, { error: 'reachout-timelock' })
    await sendUazapiText(ARGS).then(
      () => {
        throw new Error('expected sendUazapiText to throw')
      },
      (err) => {
        expect(err).toBeInstanceOf(Error)
        expect((err as { status?: number }).status).toBe(463)
        expect((err as { body?: string }).body).toContain('reachout-timelock')
      },
    )
  })
})

describe('isReachoutBlock', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is true when UazAPI returns HTTP 463', async () => {
    mockResponse(463, { error: 'something' })
    const err = await sendUazapiText(ARGS).catch((e) => e)
    expect(isReachoutBlock(err)).toBe(true)
  })

  it('is true when the message mentions reachout/timelock even off a non-463 status', async () => {
    mockResponse(400, { message: 'cannot reachout: timelock active' })
    const err = await sendUazapiText(ARGS).catch((e) => e)
    expect(isReachoutBlock(err)).toBe(true)
  })

  it('is false for an unrelated send failure (e.g. disconnected session)', async () => {
    mockResponse(500, { error: 'instance disconnected' })
    const err = await sendUazapiText(ARGS).catch((e) => e)
    expect(isReachoutBlock(err)).toBe(false)
  })

  it('does NOT false-positive on an unrelated failure whose body merely carries "463" in a trace/request id', async () => {
    mockResponse(500, { error: 'gateway timeout', requestId: 'req-463-abc' })
    const err = await sendUazapiText(ARGS).catch((e) => e)
    expect(isReachoutBlock(err)).toBe(false)
  })

  it('is false for a plain error with no UazAPI metadata', () => {
    expect(isReachoutBlock(new Error('boom'))).toBe(false)
    expect(isReachoutBlock(null)).toBe(false)
    expect(isReachoutBlock('reachout')).toBe(false)
  })
})
