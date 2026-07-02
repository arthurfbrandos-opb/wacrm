import { randomBytes, createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptGcm,
  driveListUrl,
  extractDriveFolderId,
  montarPrompt,
  montarPromptAjuste,
  montarPromptPublisher,
  parsePublisher,
  parseResultado,
  publicUrl,
} from './content-worker.mjs'

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

describe('decryptGcm', () => {
  // Espelha o encrypt() do src/lib/whatsapp/encryption.ts: iv12:ct:tag16 hex.
  function encryptLikeApp(text, keyHex) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv)
    let ct = cipher.update(text, 'utf8', 'hex')
    ct += cipher.final('hex')
    return `${iv.toString('hex')}:${ct}:${cipher.getAuthTag().toString('hex')}`
  }
  const KEY = '00'.repeat(32)

  it('roundtrip com o formato do app', () => {
    const enc = encryptLikeApp('token-metricool-secreto', KEY)
    expect(decryptGcm(enc, KEY)).toBe('token-metricool-secreto')
  })

  it('explode em ciphertext adulterado (GCM autentica)', () => {
    const enc = encryptLikeApp('abc', KEY)
    const [iv, ct, tag] = enc.split(':')
    const flipped = ct.slice(0, -1) + (ct.endsWith('0') ? '1' : '0')
    expect(() => decryptGcm(`${iv}:${flipped}:${tag}`, KEY)).toThrow()
  })

  it('explode em formato inesperado', () => {
    expect(() => decryptGcm('so-uma-parte', KEY)).toThrow()
  })
})

describe('prompts de ajuste e publisher', () => {
  it('ajuste carrega a nota e o slug', () => {
    const p = montarPromptAjuste({ note: 'troca o gancho', slug: 'juros', title: 'Juros' })
    expect(p).toContain('troca o gancho')
    expect(p).toContain('producao/juros')
  })
  it('publisher carrega quando/legenda/imagem e proíbe confirmação inventada', () => {
    const p = montarPromptPublisher(
      { when: '2026-07-03T12:00:00Z' },
      { caption: 'legenda x', preview_url: 'https://img/x.png', channel: 'instagram' },
    )
    expect(p).toContain('2026-07-03T12:00:00Z')
    expect(p).toContain('legenda x')
    expect(p).toContain('https://img/x.png')
    expect(p).toContain('Não invente confirmação')
  })
})

describe('extractDriveFolderId + driveListUrl', () => {
  it('extrai id de /folders/<id> com e sem query', () => {
    expect(extractDriveFolderId('https://drive.google.com/drive/folders/1AbC_d-9xYz')).toBe('1AbC_d-9xYz')
    expect(
      extractDriveFolderId('https://drive.google.com/drive/folders/1AbC_d-9xYz?usp=sharing'),
    ).toBe('1AbC_d-9xYz')
  })
  it('extrai id de ?id= (formato antigo)', () => {
    expect(extractDriveFolderId('https://drive.google.com/open?id=XyZ-123_ab')).toBe('XyZ-123_ab')
  })
  it('null pra link que não é do Drive', () => {
    expect(extractDriveFolderId('https://example.com/pasta')).toBeNull()
    expect(extractDriveFolderId('')).toBeNull()
  })
  it('lista só imagens da pasta, com a key', () => {
    const url = driveListUrl('FOLDER1', 'KEY9')
    expect(url).toContain('googleapis.com/drive/v3/files')
    expect(url).toContain(encodeURIComponent("'FOLDER1' in parents"))
    expect(url).toContain(encodeURIComponent("mimeType contains 'image/'"))
    expect(url).toContain('key=KEY9')
  })
})

describe('parsePublisher', () => {
  it('ok=true com detalhe', () => {
    expect(parsePublisher('x {"ok":true,"detalhe":"agendado 03/07 09h"} y')).toEqual({
      ok: true,
      detalhe: 'agendado 03/07 09h',
    })
  })
  it('ok=false com motivo', () => {
    expect(parsePublisher('{"ok":false,"detalhe":"instagram não conectado"}')).toEqual({
      ok: false,
      detalhe: 'instagram não conectado',
    })
  })
  it('null pra resposta sem contrato', () => {
    expect(parsePublisher('agendei sim!')).toBeNull()
    expect(parsePublisher('{"detalhe":"sem ok"}')).toBeNull()
  })
})
