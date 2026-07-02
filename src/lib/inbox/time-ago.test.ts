import { describe, expect, it } from 'vitest'
import { shortTimeAgo } from './time-ago'

const NOW = Date.parse('2026-07-02T12:00:00-03:00')

describe('shortTimeAgo', () => {
  it('under a minute → "agora"', () => {
    expect(shortTimeAgo('2026-07-02T11:59:40-03:00', NOW)).toBe('agora')
  })

  it('minutes → "Xm"', () => {
    expect(shortTimeAgo('2026-07-02T11:35:00-03:00', NOW)).toBe('25m')
  })

  it('hours → "Xh"', () => {
    expect(shortTimeAgo('2026-07-02T08:00:00-03:00', NOW)).toBe('4h')
  })

  it('days under a week → "Xd"', () => {
    expect(shortTimeAgo('2026-06-30T12:00:00-03:00', NOW)).toBe('2d')
  })

  it('a week or more → dd/MM', () => {
    expect(shortTimeAgo('2026-06-12T12:00:00-03:00', NOW)).toBe('12/06')
  })

  it('invalid date → empty string', () => {
    expect(shortTimeAgo('not-a-date', NOW)).toBe('')
  })
})
