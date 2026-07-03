import { randomBytes, createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptGcm,
  driveListUrl,
  extractDriveFolderId,
  extrairLinksInstagram,
  fundacaoParaArquivos,
  montarPrompt,
  montarPromptAjuste,
  montarPromptGeracao,
  montarPromptGerarArte,
  montarPromptLinhaEditorial,
  montarPromptProduzirPauta,
  montarPromptPublisher,
  parseConteudoPauta,
  parseLinhaEditorial,
  parsePublisher,
  parseResultado,
  pecasDaLinha,
  publicUrl,
} from './content-worker.mjs'

describe('produção em dois portões (pauta → conteúdo → arte)', () => {
  it('pecasDaLinha nasce como PROPOSTA (fora do kanban até aprovar) e carrega o funil', () => {
    const rows = pecasDaLinha('acc', 'line1', [
      { titulo: 'X', tipo: 'carrossel', data: '2026-07-06', tema: 'ângulo', funil: 'topo' },
    ])
    expect(rows[0].meta.pauta).toBe('proposta')
    expect(rows[0].status).toBe('pauta')
    expect(rows[0].meta.funil).toBe('topo')
  })

  it('parseLinhaEditorial valida o funil (inválido vira null)', () => {
    const r = parseLinhaEditorial(
      JSON.stringify({
        reply: 'ok',
        pecas: [
          { titulo: 'A', tipo: 'carrossel', data: '2026-07-06', tema: 't', funil: 'meio' },
          { titulo: 'B', tipo: 'estatico', data: '2026-07-07', tema: 't', funil: 'qualquer' },
        ],
      }),
    )
    expect(r.pecas[0].funil).toBe('meio')
    expect(r.pecas[1].funil).toBeNull()
  })

  it('montarPromptProduzirPauta proíbe arte e cobra corpo sem legenda', () => {
    const p = montarPromptProduzirPauta({ titulo: 'Juros', tipo: 'carrossel', tema: 'ângulo' })
    expect(p).toContain('NÃO renderize arte')
    expect(p).toContain('SEM a legenda dentro')
  })

  it('montarPromptGerarArte não deixa reescrever a copy aprovada', () => {
    const p = montarPromptGerarArte({ titulo: 'Juros', slug: 'juros', tipo: 'carrossel' })
    expect(p).toContain('NÃO reescreva a copy')
    expect(p).toContain('producao/juros/')
  })

  it('parseConteudoPauta valida contrato e limpa legenda de dentro do corpo', () => {
    const r = parseConteudoPauta(
      JSON.stringify({
        reply: 'Conteúdo pronto.',
        peca: {
          slug: 'juros',
          legenda: 'legenda oficial',
          corpo: '## Slide 1\ntexto\n\n## Legenda\nduplicada aqui',
        },
      }),
    )
    expect(r.peca.slug).toBe('juros')
    expect(r.peca.corpo).toContain('Slide 1')
    expect(r.peca.corpo).not.toContain('duplicada')
    expect(parseConteudoPauta('{"reply":"ok","peca":{"slug":"x"}}')).toBeNull() // sem corpo
  })
})

describe('montarPrompt', () => {
  it('leva o histórico da conversa (sessão contínua) antes da mensagem nova', () => {
    const p = montarPrompt({ message: 'agora faz a versão estático' }, [
      { author: 'cliente', body: 'gera um carrossel sobre juros' },
      { author: 'squad', body: 'Feito! Tá no kanban.' },
    ])
    expect(p).toContain('CONVERSA RECENTE')
    expect(p).toContain('[cliente] gera um carrossel sobre juros')
    expect(p).toContain('[squad] Feito! Tá no kanban.')
    expect(p.indexOf('[squad]')).toBeLessThan(p.indexOf('MENSAGEM NOVA DO CLIENTE'))
  })

  it('sem histórico não imprime bloco de conversa', () => {
    const p = montarPrompt({ message: 'oi' })
    expect(p).not.toContain('CONVERSA RECENTE')
  })

  it('segue o orquestrador /conteudo traduzido pra ferramenta', () => {
    const p = montarPrompt({ message: 'monta a pauta da semana' })
    expect(p).toContain('.claude/commands/conteudo.md')
    expect(p).toContain('Pra aprovar') // gate visual vira aprovação na ferramenta
    expect(p).toContain('não oriente publicação manual')
  })

  it('inclui a mensagem do cliente e o contrato JSON', () => {
    const p = montarPrompt({ message: 'gera um carrossel sobre juros abusivos' })
    expect(p).toContain('gera um carrossel sobre juros abusivos')
    expect(p).toContain('"peca"')
    expect(p).toContain('NUNCA inventar')
  })
  it('não explode com payload vazio', () => {
    expect(montarPrompt({})).toContain('MENSAGEM NOVA DO CLIENTE:')
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

  it('parseia peça de vídeo com roteiro (sem preview)', () => {
    const r = parseResultado(
      '{"reply":"Roteiro pronto pra gravar.","peca":{"slug":"golpe-do-pix","titulo":"Golpe do PIX","tipo":"video","legenda":"Legenda…","arquivo_preview":null,"roteiro":"# Vídeo: Golpe do PIX\\n\\n## Cena 1…"}}',
    )
    expect(r.peca.tipo).toBe('video')
    expect(r.peca.arquivo_preview).toBeNull()
    expect(r.peca.roteiro).toContain('Cena 1')
  })

  it('remove a seção Legenda de dentro do roteiro (campo próprio)', () => {
    const r = parseResultado(
      JSON.stringify({
        reply: 'ok',
        peca: {
          slug: 'x',
          titulo: 'X',
          tipo: 'video',
          legenda: 'legenda oficial',
          arquivo_preview: null,
          roteiro:
            '# Vídeo: X\n\n## Cena 1\nfala\n\n## Legenda\ntexto repetido #tag\n\n## Dicas de gravação\nluz de frente',
        },
      }),
    )
    expect(r.peca.roteiro).toContain('Cena 1')
    expect(r.peca.roteiro).toContain('Dicas de gravação')
    expect(r.peca.roteiro).not.toContain('texto repetido')
  })

  it('roteiro ausente vira null (carrossel não carrega roteiro)', () => {
    const r = parseResultado(
      '{"reply":"ok","peca":{"slug":"x","titulo":"X","tipo":"carrossel","legenda":"l"}}',
    )
    expect(r.peca.roteiro).toBeNull()
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

describe('montarPromptGeracao', () => {
  it('gera prompt de estático com o tema', () => {
    const p = montarPromptGeracao({ tema: 'tarifa de cadastro indevida', tipo: 'estatico' })
    expect(p).toContain('ESTATICO')
    expect(p).toContain('tarifa de cadastro indevida')
    expect(p).toContain('render_estatico.py')
    expect(p).toContain('"tipo": "estatico"')
  })
  it('tipo desconhecido cai pra carrossel', () => {
    const p = montarPromptGeracao({ tema: 'x', tipo: 'reels' })
    expect(p).toContain('render_carrossel.py')
  })
})

describe('fundação do workspace', () => {
  it('vira arquivos referencia/fundacao-workspace/<key>.md com título como heading', () => {
    const arquivos = fundacaoParaArquivos([
      { section_key: 'tom-de-voz', title: 'Tom de voz', content: 'Direto, sem juridiquês.' },
      { section_key: 'icp', title: 'Cliente ideal', content: 'Devedor de financiamento.' },
    ])
    expect(arquivos).toHaveLength(2)
    expect(arquivos[0].rel).toBe('referencia/fundacao-workspace/tom-de-voz.md')
    expect(arquivos[0].body).toContain('# Tom de voz')
    expect(arquivos[0].body).toContain('Direto, sem juridiquês.')
  })

  it('seção vazia fica de fora e key vira nome de arquivo seguro', () => {
    const arquivos = fundacaoParaArquivos([
      { section_key: 'vazia', title: 'Vazia', content: '   ' },
      { section_key: 'a/b c', title: 'X', content: 'ok' },
      null,
    ])
    expect(arquivos).toHaveLength(1)
    expect(arquivos[0].rel).toBe('referencia/fundacao-workspace/a_b_c.md')
  })

  it('os 3 prompts de produção apontam a fundação editada como prevalecente', () => {
    for (const p of [
      montarPrompt({ message: 'x' }),
      montarPromptGeracao({ tema: 'x', tipo: 'estatico' }),
      montarPromptAjuste({ note: 'x', slug: 's', title: 't' }),
    ]) {
      expect(p).toContain('fundacao-workspace')
      expect(p).toContain('PREVALECE')
    }
  })
})

describe('linha editorial (gerar_semana)', () => {
  const PAYLOAD = {
    line_id: 'L1',
    start_date: '2026-07-06',
    end_date: '2026-07-12',
    mix: { carrossel: 2, estatico: 2, video: 0 },
    themes: 'bloqueio de conta · renegociação',
  }

  it('prompt carrega período, mix, temas e a regra 1/dia', () => {
    const p = montarPromptLinhaEditorial(PAYLOAD)
    expect(p).toContain('2026-07-06 a 2026-07-12')
    expect(p).toContain('2 carrossel(éis) · 2 estático(s)')
    expect(p).toContain('bloqueio de conta · renegociação')
    expect(p).toContain('máximo 1 conteúdo por dia')
    expect(p).toContain('linha-editorial/calendario.md')
  })

  it('parse aceita o contrato e derruba peça sem data válida', () => {
    const r = parseLinhaEditorial(
      'bla {"reply":"pauta pronta","pecas":[{"titulo":"Juros","tipo":"carrossel","data":"2026-07-07","tema":"x"},{"titulo":"ruim","tipo":"carrossel","data":"amanhã"}]} bla',
    )
    expect(r?.reply).toBe('pauta pronta')
    expect(r?.pecas).toHaveLength(1)
    expect(r?.pecas[0].data).toBe('2026-07-07')
  })

  it('parse devolve null sem pecas', () => {
    expect(parseLinhaEditorial('{"reply":"oi","pecas":[]}')).toBeNull()
    expect(parseLinhaEditorial('{"reply":"oi"}')).toBeNull()
  })

  it('pecasDaLinha vira linhas de content_pieces em Pauta com data planejada', () => {
    const rows = pecasDaLinha('ACC', 'L1', [
      { titulo: 'Juros', tipo: 'carrossel', data: '2026-07-07', tema: 'ângulo' },
    ])
    expect(rows[0]).toMatchObject({
      account_id: 'ACC',
      title: 'Juros',
      kind: 'carrossel',
      status: 'pauta',
      meta: { line_id: 'L1', planned_date: '2026-07-07', tema: 'ângulo' },
    })
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

describe('extrairLinksInstagram', () => {
  it('acha posts e reels no meio de texto livre, sem duplicar', () => {
    const t =
      'faz parecido com https://www.instagram.com/p/DAbC123xyz/ e também ' +
      'https://instagram.com/reel/XyZ_9-8/?igsh=abc … de novo https://www.instagram.com/p/DAbC123xyz/';
    const links = extrairLinksInstagram(t);
    expect(links).toHaveLength(2);
    expect(links[0]).toContain('/p/DAbC123xyz');
    expect(links[1]).toContain('/reel/XyZ_9-8');
  });
  it('texto sem link do Instagram devolve vazio (outros sites não entram)', () => {
    expect(extrairLinksInstagram('olha https://www.cnj.jus.br/sisbajud e www.google.com')).toEqual([]);
    expect(extrairLinksInstagram('')).toEqual([]);
  });
});
