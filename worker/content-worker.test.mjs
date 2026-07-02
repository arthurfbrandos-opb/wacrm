import { describe, expect, it } from 'vitest'
import { montarPrompt, parseResultado, publicUrl } from './content-worker.mjs'

describe('montarPrompt', () => {
  it('inclui a mensagem do cliente e o contrato JSON', () => {
    const p = montarPrompt({ message: 'gera um carrossel sobre juros abusivos' })
    expect(p).toContain('gera um carrossel sobre juros abusivos')
    expect(p).toContain('"peca"')
    expect(p).toContain('NUNCA invente')
  })
  it('não explode com payload vazio', () => {
    expect(montarPrompt({})).toContain('MENSAGEM DO CLIENTE:')
  })
})

describe('parseResultado', () => {
  it('parseia contrato com peça', () => {
    const r = parseResultado(
      'texto antes {"reply":"Pronto! Peça no kanban.","peca":{"slug":"juros-abusivos","titulo":"Juros abusivos","tipo":"carrossel","legenda":"Legenda…","arquivo_preview":"producao/juros-abusivos/slide-01.png"}} texto depois',
    )
    expect(r).not.toBeNull()
    expect(r.reply).toBe('Pronto! Peça no kanban.')
    expect(r.peca.slug).toBe('juros-abusivos')
    expect(r.peca.tipo).toBe('carrossel')
  })

  it('parseia resposta sem peça (conversa)', () => {
    const r = parseResultado('{"reply":"Qual tema você prefere?","peca":null}')
    expect(r.reply).toBe('Qual tema você prefere?')
    expect(r.peca).toBeNull()
  })

  it('rejeita tipo de peça fora do contrato', () => {
    const r = parseResultado(
      '{"reply":"ok","peca":{"slug":"x","titulo":"X","tipo":"reels","legenda":""}}',
    )
    expect(r.peca).toBeNull() // peça inválida vira null; reply sobrevive
    expect(r.reply).toBe('ok')
  })

  it('devolve null pra resposta sem JSON', () => {
    expect(parseResultado('não consegui')).toBeNull()
    expect(parseResultado('')).toBeNull()
  })

  it('devolve null pra reply vazio', () => {
    expect(parseResultado('{"reply":"","peca":null}')).toBeNull()
  })
})

describe('publicUrl', () => {
  it('monta a URL pública do bucket sem barra dupla', () => {
    expect(publicUrl('https://x.supabase.co/', 'content-previews', 'acc/slug-1.png')).toBe(
      'https://x.supabase.co/storage/v1/object/public/content-previews/acc/slug-1.png',
    )
  })
})
