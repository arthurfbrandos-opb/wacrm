import { describe, expect, it } from 'vitest'
import { deriveLeadOrigin } from './origin'

describe('deriveLeadOrigin', () => {
  it('no fap01_data → inbound/orgânico', () => {
    expect(deriveLeadOrigin(null)).toEqual({
      kind: 'inbound',
      label: 'orgânico',
      utm: {},
    })
    expect(deriveLeadOrigin(undefined).kind).toBe('inbound')
  })

  it('fap01_data with UTMs in the referrer query string → FAP01 + campaign label', () => {
    const origin = deriveLeadOrigin({
      contact_name: 'João',
      source_referrer:
        'https://lps.brandosystem.com/fap01/?utm_campaign=bio&utm_source=instagram',
      source_utm_source: '',
      source_utm_campaign: '',
    })
    expect(origin.kind).toBe('fap01')
    expect(origin.label).toBe('FAP01 · bio')
    expect(origin.utm).toEqual({ source: 'instagram', campaign: 'bio' })
    expect(origin.referrer).toContain('/fap01/')
  })

  it('explicit source_utm_* fields win over the referrer query', () => {
    const origin = deriveLeadOrigin({
      source_referrer: 'https://lps.brandosystem.com/fap01/?utm_campaign=bio',
      source_utm_source: 'FacebookAds',
      source_utm_medium: 'cpc',
      source_utm_campaign: 'advogados-01',
    })
    expect(origin.utm).toEqual({
      source: 'FacebookAds',
      medium: 'cpc',
      campaign: 'advogados-01',
    })
    expect(origin.label).toBe('FAP01 · advogados-01')
  })

  it('fap01-adv funnel detected from the referrer path', () => {
    const origin = deriveLeadOrigin({
      source_referrer: 'https://lps.brandosystem.com/fap01-adv/?utm_source=FacebookAds',
    })
    expect(origin.kind).toBe('fap01-adv')
    expect(origin.label).toBe('FAP01-ADV · FacebookAds')
  })

  it('fap01_data without referrer/UTMs → plain FAP01 badge', () => {
    const origin = deriveLeadOrigin({ contact_name: 'João' })
    expect(origin.kind).toBe('fap01')
    expect(origin.label).toBe('FAP01')
    expect(origin.utm).toEqual({})
  })

  it('malformed referrer URL does not throw', () => {
    const origin = deriveLeadOrigin({ source_referrer: 'not a url' })
    expect(origin.kind).toBe('fap01')
    expect(origin.label).toBe('FAP01')
  })
})
