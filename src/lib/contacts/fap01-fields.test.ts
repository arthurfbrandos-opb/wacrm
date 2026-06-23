import { describe, it, expect } from 'vitest'
import {
  FAP01_EDITABLE_FIELDS,
  FAP01_LOCKED_FIELDS,
  mergeFap01,
} from './fap01-fields'
import { findTagByName, normalizeTagName } from './tags'

describe('fap01 field partition', () => {
  it('treats mql as editable, not locked', () => {
    expect(FAP01_EDITABLE_FIELDS.some((f) => f.key === 'mql')).toBe(true)
    expect(FAP01_LOCKED_FIELDS.some((f) => f.key === 'mql')).toBe(false)
  })

  it('keeps UTM/attribution out of the editable set', () => {
    const editable = new Set(FAP01_EDITABLE_FIELDS.map((f) => f.key))
    for (const k of [
      'source_utm_source',
      'source_utm_medium',
      'source_utm_campaign',
      'source_referrer',
      'attribution',
      'passed_lowtier_gate',
      'funnel_stage',
    ]) {
      expect(editable.has(k)).toBe(false)
    }
  })
})

describe('mergeFap01', () => {
  const existing = {
    nicho: 'odonto',
    mql: false,
    source_utm_source: 'meta',
    source_utm_campaign: 'lead-junho',
    attribution: { first_touch: 'ig' },
  }

  it('applies edited editable fields', () => {
    const out = mergeFap01(existing, { nicho: 'estética', mql: true })
    expect(out.nicho).toBe('estética')
    expect(out.mql).toBe(true)
  })

  it('never clobbers locked keys even if present in edits', () => {
    const out = mergeFap01(existing, {
      source_utm_source: 'hacked',
      attribution: 'hacked',
      nicho: 'novo',
    })
    expect(out.source_utm_source).toBe('meta')
    expect(out.attribution).toEqual({ first_touch: 'ig' })
    expect(out.nicho).toBe('novo')
  })

  it('preserves untouched keys and tolerates null existing', () => {
    expect(mergeFap01(existing, {}).source_utm_campaign).toBe('lead-junho')
    expect(mergeFap01(null, { nicho: 'x' })).toEqual({ nicho: 'x' })
  })
})

describe('tag helpers', () => {
  const tags = [
    { id: '1', name: 'Quente', color: '#ef4444' },
    { id: '2', name: 'Frio', color: '#3b82f6' },
  ]

  it('normalizes name for comparison', () => {
    expect(normalizeTagName('  Quente ')).toBe('quente')
  })

  it('finds an existing tag case-insensitively', () => {
    expect(findTagByName(tags, ' quente')?.id).toBe('1')
  })

  it('returns undefined for a new or blank name', () => {
    expect(findTagByName(tags, 'Novo')).toBeUndefined()
    expect(findTagByName(tags, '   ')).toBeUndefined()
  })
})
