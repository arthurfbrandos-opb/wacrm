import { describe, it, expect } from 'vitest'
import { resolveCreative, UNATTRIBUTED } from './ads-attribution'

describe('resolveCreative', () => {
  it('usa last_touch.utm_content quando presente', () => {
    const r = resolveCreative({
      attribution: {
        last_touch: { utm: { utm_content: 'criativo-A', utm_campaign: 'NS-frio' } },
        first_touch: { utm: { utm_content: 'criativo-Z', utm_campaign: 'velho' } },
      },
    })
    expect(r).toEqual({ creative: 'criativo-A', campaign: 'NS-frio' })
  })

  it('cai pro first_touch quando last_touch não tem content', () => {
    const r = resolveCreative({
      attribution: { first_touch: { utm: { utm_content: 'criativo-B', utm_campaign: 'NS-quente' } } },
    })
    expect(r).toEqual({ creative: 'criativo-B', campaign: 'NS-quente' })
  })

  it('campanha cai pro source_utm_campaign flat se não houver no attribution', () => {
    const r = resolveCreative({
      attribution: { last_touch: { utm: { utm_content: 'criativo-C' } } },
      source_utm_campaign: 'flat-camp',
    })
    expect(r).toEqual({ creative: 'criativo-C', campaign: 'flat-camp' })
  })

  it('sem utm_content em lugar nenhum → Sem atribuição, campanha null', () => {
    expect(resolveCreative({ attribution: {} })).toEqual({ creative: UNATTRIBUTED, campaign: null })
    expect(resolveCreative(null)).toEqual({ creative: UNATTRIBUTED, campaign: null })
    expect(resolveCreative(undefined)).toEqual({ creative: UNATTRIBUTED, campaign: null })
  })
})
