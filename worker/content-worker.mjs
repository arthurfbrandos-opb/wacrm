#!/usr/bin/env node
// worker/content-worker.mjs — worker de produção da Squad Content.
//
// Drena a fila content_jobs (Supabase REST · service_role), roda o Claude headless
// DENTRO do repo-cérebro (conteudo-rodolfo: skills construtor-copy/editor-carrossel/
// editor-estatico + fundação real), grava a peça em content_pieces (kanban "Pra
// aprovar"), responde no chat e lança o custo no os_cost_ledger do tenant.
//
// Zero dependência (Node ≥18: fetch nativo). Mesmo espírito do painel do validador.
//
// Env obrigatório:
//   SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · CONTEUDO_REPO_DIR
// Env opcional:
//   WORKER_FAKE=1 (pluming test, sem claude) · GERADOR_MODEL (default: opus da conta)
//   POLL_MS (default 5000) · STORAGE_BUCKET (default content-previews)
//   ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY — herdados pelo claude CLI (hudapi via cofre)
//
// ⚠️ Aprendizados HARD embutidos:
//   - `--setting-sources project,local` no spawn — senão hooks GLOBAIS do usuário
//     matam o job headless (exit 1). Lição do gerador do painel (21/06).
//   - claude com `--output-format json` → { result, total_cost_usd, ... }.

import { spawn } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Funções puras (testadas em content-worker.test.mjs) ─────────────────────

/**
 * Monta o prompt do job de chat pro Claude operar o repo-cérebro.
 * `historico` = mensagens recentes da conversa (mais antiga → mais nova),
 * SEM a mensagem nova — o chat é uma sessão contínua, não pedidos soltos.
 */
export function montarPrompt(payload, historico = []) {
  const pedido = String(payload?.message ?? '').trim();
  const conversa = (Array.isArray(historico) ? historico : [])
    .map((m) => `[${m?.author === 'squad' ? 'squad' : 'cliente'}] ${String(m?.body ?? '').trim()}`)
    .join('\n');
  return [
    'Você é a SQUAD CONTENT do cliente (Dr. Rodolfo · HMR) operando ESTE repositório de conteúdo.',
    'LEIA e SIGA o orquestrador do repo: .claude/commands/conteudo.md — é o flow oficial da produção',
    'semanal (descobrir o estado → pauta da linha editorial → copy → arte), com as regras-mãe:',
    'UMA ação por vez · zero jargão técnico · flow flexível (ele pode pular/reordenar) · NUNCA inventar',
    '(tudo vem da fundação ou da boca dele; lacuna = perguntar) · humanize sempre (SEM travessão · máx 5 hashtags).',
    '',
    'TRADUÇÃO PRO CHAT DA FERRAMENTA (ele NÃO está no computador — só vê este chat):',
    '- Os gates de revisão visual (🚦) do command viram: a peça sobe pra ferramenta e cai em "Pra aprovar";',
    '  diga no reply que ela está lá pra ele aprovar ou pedir ajuste. NUNCA mande abrir HTML/painel/arquivo.',
    '- Nunca cite caminho de arquivo, script ou comando no reply — isso é bastidor seu.',
    '- Foto/fundo: use referencia/fundos-cliente/ (imagens dele) ou referencia/; NÃO pergunte caminho de foto.',
    '- Fundação: referencia/fundacao-workspace/ é a versão MAIS RECENTE (editada por ele na tela Marca)',
    '  e PREVALECE sobre marca/*.md.',
    '- Publicação: a ferramenta agenda via Metricool depois que ele aprova — não oriente publicação manual.',
    '- A pauta vem de linha-editorial/calendario.md (ou fundacao-workspace/linha-editorial.md se existir).',
    '',
    ...(conversa ? ['CONVERSA RECENTE (mais antiga → mais nova):', conversa, ''] : []),
    `MENSAGEM NOVA DO CLIENTE: ${pedido}`,
    '',
    'AÇÃO:',
    '- Planejamento/conversa (pauta da semana, escolher tema, dúvida): conduza no "reply" (uma pergunta/',
    '  ação por vez, como o command manda) e devolva "peca": null.',
    '- Pedido de produção: produza UMA peça ponta a ponta pelas skills do repo (copy: construtor-copy ·',
    '  arte: editor-carrossel/render_carrossel.py ou editor-estatico/render_estatico.py · producao/<slug>/).',
    '',
    'FORMATO DA SUA ÚLTIMA MENSAGEM — SOMENTE este JSON, sem texto em volta:',
    '{"reply": "<resposta curta pro chat>", "peca": {"slug": "<pasta em producao/>", "titulo": "<título>", "tipo": "carrossel|estatico", "legenda": "<legenda completa>", "arquivo_preview": "producao/<slug>/<primeiro-png>"} }',
    'Quando não houver peça: {"reply": "...", "peca": null}',
  ].join('\n');
}

/** Extrai o JSON do contrato da resposta do agente (tolera cerca/texto em volta). */
export function parseResultado(texto) {
  const s = String(texto ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (typeof obj?.reply !== 'string' || !obj.reply.trim()) return null;
    let peca = null;
    if (obj.peca && typeof obj.peca === 'object') {
      const { slug, titulo, tipo, legenda, arquivo_preview } = obj.peca;
      if (
        typeof slug === 'string' && slug.trim() &&
        typeof titulo === 'string' && titulo.trim() &&
        (tipo === 'carrossel' || tipo === 'estatico')
      ) {
        peca = {
          slug: slug.trim(),
          titulo: titulo.trim(),
          tipo,
          legenda: typeof legenda === 'string' ? legenda : '',
          arquivo_preview: typeof arquivo_preview === 'string' ? arquivo_preview : null,
        };
      }
    }
    return { reply: obj.reply.trim(), peca };
  } catch {
    return null;
  }
}

/** Prompt do job GERAR_SEMANA — montar a linha editorial com os parâmetros do cliente. */
export function montarPromptLinhaEditorial(payload) {
  const inicio = String(payload?.start_date ?? '');
  const fim = String(payload?.end_date ?? '');
  const mix = payload?.mix ?? {};
  const temas = String(payload?.themes ?? '').trim();
  return [
    'Você é a SQUAD CONTENT do cliente (Dr. Rodolfo · HMR) operando ESTE repositório de conteúdo.',
    'Monte a LINHA EDITORIAL do período abaixo usando a skill linha-editorial do repo',
    '(.claude/skills/linha-editorial). Fundação: referencia/fundacao-workspace/ PREVALECE sobre marca/*.md.',
    '',
    `PERÍODO: ${inicio} a ${fim} (máximo 1 conteúdo por dia)`,
    `MIX PEDIDO: ${mix.carrossel ?? 0} carrossel(éis) · ${mix.estatico ?? 0} estático(s) · ${mix.video ?? 0} vídeo(s)`,
    temas
      ? `TEMAS QUE O CLIENTE QUER PUXAR: ${temas}`
      : 'TEMAS: livres — puxe da fundação e da proporção da skill.',
    '',
    'REGRAS:',
    '- Distribua as peças pelas datas do período (1 por dia no máximo · datas YYYY-MM-DD dentro do período).',
    '- Respeite o mix pedido EXATAMENTE. Temas do cliente entram primeiro; complete com a proporção da skill.',
    '- ATUALIZE linha-editorial/calendario.md com a pauta nova (é o que a produção lê depois).',
    '- NUNCA invente fatos, leis ou números nos temas — use a base de conhecimento da fundação.',
    '',
    'FORMATO DA SUA ÚLTIMA MENSAGEM — SOMENTE este JSON, sem texto em volta:',
    '{"reply": "<resumo curto da pauta pro chat>", "pecas": [{"titulo": "<título>", "tipo": "carrossel|estatico", "data": "YYYY-MM-DD", "tema": "<ângulo em 1 linha>"}]}',
  ].join('\n');
}

/** Extrai/valida o contrato da linha editorial ({"reply","pecas":[...]}). */
export function parseLinhaEditorial(texto) {
  const s = String(texto ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (typeof obj?.reply !== 'string' || !obj.reply.trim()) return null;
    if (!Array.isArray(obj.pecas)) return null;
    const pecas = obj.pecas
      .filter(
        (p) =>
          p && typeof p.titulo === 'string' && p.titulo.trim() &&
          (p.tipo === 'carrossel' || p.tipo === 'estatico' || p.tipo === 'video') &&
          typeof p.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.data),
      )
      .map((p) => ({
        titulo: p.titulo.trim(),
        tipo: p.tipo,
        data: p.data,
        tema: typeof p.tema === 'string' ? p.tema.trim() : null,
      }));
    if (!pecas.length) return null;
    return { reply: obj.reply.trim(), pecas };
  } catch {
    return null;
  }
}

/** Pura: linhas de content_pieces a partir da pauta gerada (status Pauta · data em meta). */
export function pecasDaLinha(accountId, lineId, pecas) {
  return (Array.isArray(pecas) ? pecas : []).map((p) => ({
    account_id: accountId,
    title: p.titulo,
    kind: p.tipo,
    status: 'pauta',
    channel: 'instagram',
    meta: { line_id: lineId, planned_date: p.data, ...(p.tema ? { tema: p.tema } : {}) },
  }));
}

/** URL pública de um objeto no bucket público. */
export function publicUrl(supabaseUrl, bucket, path) {
  const base = String(supabaseUrl).replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Descriptografa o formato do encryption.ts do wacrm: `<iv>:<ct>:<tag>` hex,
 * AES-256-GCM, IV 12 bytes, tag 16 bytes, chave hex (ENCRYPTION_KEY).
 */
export function decryptGcm(encryptedText, keyHex) {
  const parts = String(encryptedText ?? '').split(':');
  if (parts.length !== 3) throw new Error('credencial em formato inesperado');
  const [ivHex, ctHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('credencial GCM inválida');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  let out = decipher.update(ctHex, 'hex', 'utf8');
  out += decipher.final('utf8');
  return out;
}

/** Prompt do job de GERAÇÃO direta (tela "Usar agente" — sem chat). */
export function montarPromptGeracao(payload) {
  const tema = String(payload?.tema ?? '').trim();
  const tipo = payload?.tipo === 'estatico' ? 'estatico' : 'carrossel';
  return [
    'Você é a SQUAD CONTENT operando ESTE repositório de conteúdo do cliente (Dr. Rodolfo · HMR).',
    `Produza UMA peça do tipo ${tipo.toUpperCase()} sobre o tema abaixo, ponta a ponta.`,
    '',
    `TEMA: ${tema}`,
    '',
    'REGRAS:',
    '- Copy pela skill construtor-copy (voz da fundação em marca/ · humanize · SEM travessão · máx 5 hashtags).',
    `- Arte pelo script da skill ${tipo === 'carrossel' ? 'editor-carrossel/render_carrossel.py' : 'editor-estatico/render_estatico.py'}, salvando em producao/<slug>/.`,
    '- Fundo/foto: se existir referencia/fundos-cliente/ com imagens, PREFIRA essas (são do cliente).',
    '- Fundação: se existir referencia/fundacao-workspace/, é a versão MAIS RECENTE editada pelo',
    '  cliente na ferramenta (tom de voz/ICP/base/linha editorial) e PREVALECE sobre marca/*.md.',
    '- NUNCA invente fatos, leis, números ou resultados.',
    '',
    'FORMATO DA SUA ÚLTIMA MENSAGEM — SOMENTE este JSON, sem texto em volta:',
    '{"reply": "<resumo curto do que produziu>", "peca": {"slug": "<pasta em producao/>", "titulo": "<título>", "tipo": "' + tipo + '", "legenda": "<legenda completa>", "arquivo_preview": "producao/<slug>/<primeiro-png>"}}',
  ].join('\n');
}

/** Prompt do job de AJUSTE — refazer a peça existente com a observação do cliente. */
export function montarPromptAjuste(payload) {
  const nota = String(payload?.note ?? '').trim();
  const slug = String(payload?.slug ?? '').trim();
  const titulo = String(payload?.title ?? '').trim();
  return [
    'Você é a SQUAD CONTENT operando ESTE repositório de conteúdo do cliente (Dr. Rodolfo · HMR).',
    `O cliente pediu AJUSTE na peça já produzida "${titulo}" (pasta producao/${slug || '<ache pelo título>'}).`,
    '',
    `AJUSTE PEDIDO: ${nota}`,
    '',
    'REGRAS:',
    '- Ajuste a copy e/ou a arte conforme o pedido (skills do repo · humanize · SEM travessão · máx 5 hashtags).',
    '- Re-renderize a arte com os scripts das skills e sobrescreva os arquivos na MESMA pasta producao/<slug>/.',
    '- Fundação: se existir referencia/fundacao-workspace/, é a versão MAIS RECENTE editada pelo',
    '  cliente na ferramenta e PREVALECE sobre marca/*.md.',
    '- NUNCA invente fatos, leis ou números. Na dúvida, pergunte no "reply".',
    '',
    'FORMATO DA SUA ÚLTIMA MENSAGEM — SOMENTE este JSON, sem texto em volta:',
    '{"reply": "<o que mudou, curto>", "peca": {"slug": "<slug>", "titulo": "<título>", "tipo": "carrossel|estatico", "legenda": "<legenda completa atualizada>", "arquivo_preview": "producao/<slug>/<primeiro-png>"}}',
  ].join('\n');
}

/** Prompt do PUBLISHER — agendar a peça aprovada via Metricool (tools MCP). */
export function montarPromptPublisher(payload, peca) {
  return [
    'Você é o PUBLISHER da Squad Content. Sua única tarefa: AGENDAR a publicação abaixo',
    'no Metricool do cliente usando as tools MCP do Metricool disponíveis nesta sessão.',
    '',
    `QUANDO (ISO · converter pro fuso do cliente se a tool exigir): ${payload?.when ?? ''}`,
    `REDE: ${peca?.channel || 'instagram'}`,
    `LEGENDA:\n${peca?.caption ?? ''}`,
    `IMAGEM (URL pública): ${peca?.preview_url ?? '(sem imagem — use só a legenda ou aborte com ok=false)'}`,
    '',
    'REGRAS:',
    '- Use SOMENTE as tools do Metricool. Não invente confirmação: só diga ok=true se a tool confirmou.',
    '- Se algo impedir (sem conta conectada na rede, tool falhou), devolva ok=false com o motivo claro.',
    '',
    'FORMATO DA SUA ÚLTIMA MENSAGEM — SOMENTE este JSON, sem texto em volta:',
    '{"ok": true|false, "detalhe": "<confirmação ou motivo da falha>"}',
  ].join('\n');
}

/**
 * Pura: converte as seções da fundação (content_brand_profile) nos arquivos
 * que o agente lê no repo (referencia/fundacao-workspace/<key>.md).
 * Seções vazias ficam de fora — não sobrescrever marca/ com nada.
 */
export function fundacaoParaArquivos(sections) {
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => s?.section_key && typeof s.content === 'string' && s.content.trim() !== '')
    .map((s) => ({
      rel: `referencia/fundacao-workspace/${String(s.section_key).replace(/[^\w.\-]+/g, '_')}.md`,
      body: `# ${s.title || s.section_key}\n\n${s.content}\n`,
    }));
}

/** Extrai o id da pasta de um link do Google Drive (folders/<id> ou ?id=). */
export function extractDriveFolderId(url) {
  const s = String(url ?? '');
  const byPath = s.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (byPath) return byPath[1];
  const byQuery = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return byQuery ? byQuery[1] : null;
}

/** URL da listagem de imagens da pasta pública (Drive API v3 + API key). */
export function driveListUrl(folderId, apiKey) {
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
  return `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=100&key=${apiKey}`;
}

/** Extrai o contrato do Publisher ({ok, detalhe}) da resposta do agente. */
export function parsePublisher(texto) {
  const s = String(texto ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (typeof obj?.ok !== 'boolean') return null;
    return { ok: obj.ok, detalhe: typeof obj.detalhe === 'string' ? obj.detalhe : '' };
  } catch {
    return null;
  }
}

// ── Config / REST helpers ────────────────────────────────────────────────────

const ENV = process.env;
const POLL_MS = Number(ENV.POLL_MS || 5000);
const BUCKET = ENV.STORAGE_BUCKET || 'content-previews';
const FAKE = ENV.WORKER_FAKE === '1';

function cfg() {
  const url = ENV.SUPABASE_URL;
  const key = ENV.SUPABASE_SERVICE_ROLE_KEY;
  const repo = ENV.CONTEUDO_REPO_DIR;
  if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  if (!FAKE && !repo) throw new Error('CONTEUDO_REPO_DIR é obrigatório (repo-cérebro do conteúdo)');
  return { url: url.replace(/\/+$/, ''), key, repo };
}

async function rest(method, path, body, extraHeaders = {}) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? '' : 'return=representation',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`REST ${method} ${path} → HTTP ${res.status} ${txt.slice(0, 300)}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ── Fila ─────────────────────────────────────────────────────────────────────

async function proximoJob() {
  const rows = await rest(
    'GET',
    'content_jobs?status=eq.pending&order=created_at.asc&limit=1&select=*',
  );
  return rows?.[0] ?? null;
}

/** Claim otimista: só vira running se AINDA estiver pending (single worker, mas seguro). */
async function claim(job) {
  const rows = await rest(
    'PATCH',
    `content_jobs?id=eq.${job.id}&status=eq.pending`,
    { status: 'running', claimed_at: new Date().toISOString() },
  );
  return (rows ?? []).length > 0;
}

async function finalizarJob(id, patch) {
  await rest('PATCH', `content_jobs?id=eq.${id}`, {
    ...patch,
    finished_at: new Date().toISOString(),
  });
}

// ── Produção ────────────────────────────────────────────────────────────────

function rodarClaude(prompt, repoDir, { mcpConfigPath } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      // HARD: sem isso, hooks globais do usuário matam o headless (lição 21/06).
      '--setting-sources', 'project,local',
    ];
    if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
    if (ENV.GERADOR_MODEL) args.push('--model', ENV.GERADOR_MODEL);
    const child = spawn('claude', args, {
      cwd: repoDir,
      shell: process.platform === 'win32',
      env: { ...process.env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${err.slice(0, 400)}`));
      try {
        const parsed = JSON.parse(out);
        resolve({ result: parsed.result ?? '', costUsd: parsed.total_cost_usd ?? null, model: parsed.model ?? ENV.GERADOR_MODEL ?? null });
      } catch {
        // Sem JSON de envelope — usa stdout cru como resultado.
        resolve({ result: out, costUsd: null, model: ENV.GERADOR_MODEL ?? null });
      }
    });
  });
}

async function uploadPreview(accountId, slug, absPath) {
  const { url, key } = cfg();
  const bytes = readFileSync(absPath);
  const objectPath = `${accountId}/${slug}-${Date.now()}.png`;
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`storage upload HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  return publicUrl(url, BUCKET, objectPath);
}

// ── Fundos do cliente (Google Drive · pasta por link · fatia ⑥) ─────────────
// Best-effort ANTES de produzir: baixa imagens novas da pasta conectada pra
// referencia/fundos-cliente/ do repo-cérebro. Falha NUNCA bloqueia a produção.
async function sincronizarFundos(accountId) {
  const apiKey = ENV.GOOGLE_API_KEY;
  if (!apiKey) return; // sem API key da NS → agente usa referencia/ padrão
  const rows = await rest(
    'GET',
    `integration_connections?account_id=eq.${accountId}&provider=eq.google_drive&status=eq.connected&select=config`,
  );
  const folderUrl = rows?.[0]?.config?.folder_url;
  const folderId = extractDriveFolderId(folderUrl);
  if (!folderId) return;

  const listRes = await fetch(driveListUrl(folderId, apiKey));
  if (!listRes.ok) throw new Error(`drive list HTTP ${listRes.status}`);
  const { files = [] } = await listRes.json();

  const destDir = join(cfg().repo, 'referencia', 'fundos-cliente');
  mkdirSync(destDir, { recursive: true });
  let baixadas = 0;
  for (const f of files) {
    const safeName = String(f.name || f.id).replace(/[^\w.\-]+/g, '_');
    const dest = join(destDir, safeName);
    if (existsSync(dest)) continue; // já sincronizada
    const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${apiKey}`);
    if (!dl.ok) continue;
    writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
    baixadas++;
  }
  if (baixadas) console.log(`[worker] fundos do cliente: ${baixadas} imagem(ns) nova(s) sincronizada(s)`);
}

/** Baixa a fundação editada na ferramenta e grava em referencia/fundacao-workspace/. */
async function sincronizarFundacao(accountId) {
  const rows = await rest(
    'GET',
    `content_brand_profile?account_id=eq.${accountId}&select=section_key,title,content&order=sort_order`,
  );
  const arquivos = fundacaoParaArquivos(rows);
  if (!arquivos.length) return;
  const { repo } = cfg();
  mkdirSync(join(repo, 'referencia', 'fundacao-workspace'), { recursive: true });
  for (const a of arquivos) writeFileSync(join(repo, a.rel), a.body);
  console.log(`[worker] fundação do workspace: ${arquivos.length} seção(ões) sincronizada(s)`);
}

/** Produz (chat OU geração direta) e persiste: peça + mensagem + ledger + job. */
async function produzirEPersistir(job, prompt, tituloFake) {
  const { repo } = cfg();

  if (!FAKE) {
    await sincronizarFundos(job.account_id).catch((e) =>
      console.error(`[worker] sync de fundos falhou (segue sem): ${e instanceof Error ? e.message : e}`),
    );
    await sincronizarFundacao(job.account_id).catch((e) =>
      console.error(`[worker] sync da fundação falhou (segue sem): ${e instanceof Error ? e.message : e}`),
    );
  }

  let resultado;
  let costUsd = null;
  let model = ENV.GERADOR_MODEL ?? null;

  if (FAKE) {
    // Plumbing test: prova fila→peça→chat→ledger sem gastar token.
    resultado = {
      reply: '[FAKE] Peça de teste produzida — confere no kanban em "Pra aprovar".',
      peca: {
        slug: 'peca-fake',
        titulo: `[FAKE] ${String(tituloFake ?? 'peça de teste').slice(0, 60)}`,
        tipo: 'carrossel',
        legenda: 'Legenda de teste do worker (modo FAKE).',
        arquivo_preview: null,
      },
    };
  } else {
    const saida = await rodarClaude(prompt, repo);
    costUsd = saida.costUsd;
    model = saida.model;
    resultado = parseResultado(saida.result);
    if (!resultado) {
      throw new Error(`agente respondeu fora do contrato: ${String(saida.result).slice(0, 300)}`);
    }
  }

  let pieceId = null;
  if (resultado.peca) {
    let previewUrl = null;
    if (!FAKE && resultado.peca.arquivo_preview) {
      const abs = join(cfg().repo, resultado.peca.arquivo_preview);
      if (existsSync(abs)) {
        previewUrl = await uploadPreview(job.account_id, resultado.peca.slug, abs);
      }
    }
    const pieceRows = await rest('POST', 'content_pieces', {
      account_id: job.account_id,
      title: resultado.peca.titulo,
      kind: resultado.peca.tipo,
      status: 'aprovacao',
      caption: resultado.peca.legenda || null,
      preview_url: previewUrl,
      channel: 'instagram',
      meta: { slug: resultado.peca.slug, job_id: job.id },
    });
    pieceId = pieceRows?.[0]?.id ?? null;
  }

  await rest('POST', 'content_chat_messages', {
    account_id: job.account_id,
    author: 'squad',
    body: resultado.reply,
    job_id: job.id,
    piece_id: pieceId,
  });

  if (costUsd !== null) {
    await rest('POST', 'os_cost_ledger', {
      account_id: job.account_id,
      agent: 'squad-content',
      model,
      date: new Date().toISOString().slice(0, 10),
      cost_usd: costUsd,
    });
  }

  await finalizarJob(job.id, { status: 'done', piece_id: pieceId, cost_usd: costUsd, model });
  console.log(`[worker] job ${job.id} done${pieceId ? ` · peça ${pieceId}` : ''}${costUsd !== null ? ` · $${costUsd}` : ''}`);
}

/** Histórico recente do chat (sem a mensagem do job atual), mais antiga → mais nova. */
async function historicoChat(accountId, jobId) {
  const rows = await rest(
    'GET',
    `content_chat_messages?account_id=eq.${accountId}&select=author,body,job_id&order=created_at.desc&limit=12`,
  );
  return (Array.isArray(rows) ? rows : []).filter((m) => m.job_id !== jobId).reverse();
}

async function processarChat(job) {
  const historico = FAKE
    ? []
    : await historicoChat(job.account_id, job.id).catch(() => []);
  await produzirEPersistir(job, montarPrompt(job.payload, historico), job.payload?.message);
}

async function processarGeracao(job) {
  await produzirEPersistir(job, montarPromptGeracao(job.payload), job.payload?.tema);
}

// ── Ajuste de peça (cliente pediu mudança na aprovação) ─────────────────────

async function processarAjuste(job) {
  const { repo } = cfg();
  const pieceId = job.payload?.piece_id;
  if (!pieceId) throw new Error('ajustar_peca sem piece_id no payload');

  if (!FAKE) {
    await sincronizarFundos(job.account_id).catch((e) =>
      console.error(`[worker] sync de fundos falhou (segue sem): ${e instanceof Error ? e.message : e}`),
    );
    await sincronizarFundacao(job.account_id).catch((e) =>
      console.error(`[worker] sync da fundação falhou (segue sem): ${e instanceof Error ? e.message : e}`),
    );
  }

  let resultado;
  let costUsd = null;
  let model = ENV.GERADOR_MODEL ?? null;

  if (FAKE) {
    resultado = {
      reply: '[FAKE] Ajuste aplicado — peça de volta em "Pra aprovar".',
      peca: { slug: job.payload?.slug ?? 'peca-fake', titulo: job.payload?.title ?? 'Peça', tipo: 'carrossel', legenda: 'Legenda ajustada (FAKE).', arquivo_preview: null },
    };
  } else {
    const saida = await rodarClaude(montarPromptAjuste(job.payload), repo);
    costUsd = saida.costUsd;
    model = saida.model;
    resultado = parseResultado(saida.result);
    if (!resultado || !resultado.peca) {
      throw new Error(`ajuste respondeu fora do contrato: ${String(saida.result).slice(0, 300)}`);
    }
  }

  let previewUrl = null;
  if (!FAKE && resultado.peca?.arquivo_preview) {
    const abs = join(cfg().repo, resultado.peca.arquivo_preview);
    if (existsSync(abs)) {
      previewUrl = await uploadPreview(job.account_id, resultado.peca.slug, abs);
    }
  }

  // Atualiza a MESMA peça e devolve pra aprovação.
  await rest('PATCH', `content_pieces?id=eq.${pieceId}&account_id=eq.${job.account_id}`, {
    status: 'aprovacao',
    caption: resultado.peca?.legenda || null,
    ...(previewUrl ? { preview_url: previewUrl } : {}),
    updated_at: new Date().toISOString(),
  });

  await rest('POST', 'content_chat_messages', {
    account_id: job.account_id,
    author: 'squad',
    body: resultado.reply,
    job_id: job.id,
    piece_id: pieceId,
  });

  if (costUsd !== null) {
    await rest('POST', 'os_cost_ledger', {
      account_id: job.account_id,
      agent: 'squad-content',
      model,
      date: new Date().toISOString().slice(0, 10),
      cost_usd: costUsd,
    });
  }

  await finalizarJob(job.id, { status: 'done', piece_id: pieceId, cost_usd: costUsd, model });
  console.log(`[worker] job ${job.id} (ajuste) done · peça ${pieceId}`);
}

// ── Publisher (agendamento via Metricool MCP) ────────────────────────────────

async function conexaoMetricool(accountId) {
  const rows = await rest(
    'GET',
    `integration_connections?account_id=eq.${accountId}&provider=eq.metricool&select=status,credentials_enc,config`,
  );
  const conn = rows?.[0];
  if (!conn || conn.status !== 'connected' || !conn.credentials_enc) {
    throw new Error('Metricool não conectado pra esta conta');
  }
  const keyHex = ENV.ENCRYPTION_KEY;
  if (!keyHex) throw new Error('ENCRYPTION_KEY ausente no env do worker');
  return { token: decryptGcm(conn.credentials_enc, keyHex), config: conn.config ?? {} };
}

/**
 * Escreve o mcp-config do Metricool num arquivo temporário, com o token do
 * tenant. Template vem de METRICOOL_MCP_TEMPLATE (JSON com "{{METRICOOL_TOKEN}}")
 * — o formato exato de auth do MCP oficial é confirmado no setup do VPS com o
 * token real (não inventamos header aqui).
 */
function escreverMcpConfig(token) {
  const templatePath = ENV.METRICOOL_MCP_TEMPLATE;
  if (!templatePath || !existsSync(templatePath)) {
    throw new Error('METRICOOL_MCP_TEMPLATE ausente — configure o template do MCP no setup do worker');
  }
  const template = readFileSync(templatePath, 'utf8');
  const filled = template.replaceAll('{{METRICOOL_TOKEN}}', token);
  const dir = mkdtempSync(join(tmpdir(), 'metricool-mcp-'));
  const p = join(dir, 'mcp-config.json');
  writeFileSync(p, filled, { mode: 0o600 });
  return p;
}

async function processarAgendamento(job) {
  const pieceId = job.payload?.piece_id;
  if (!pieceId) throw new Error('agendar_publicacao sem piece_id no payload');

  const pieces = await rest(
    'GET',
    `content_pieces?id=eq.${pieceId}&account_id=eq.${job.account_id}&select=id,title,caption,preview_url,channel,scheduled_at`,
  );
  const peca = pieces?.[0];
  if (!peca) throw new Error('peça do agendamento não encontrada');

  let veredito;
  let costUsd = null;
  let model = ENV.GERADOR_MODEL ?? null;

  if (FAKE) {
    veredito = { ok: true, detalhe: '[FAKE] agendamento simulado.' };
  } else {
    const { token } = await conexaoMetricool(job.account_id);
    const mcpConfigPath = escreverMcpConfig(token);
    // Publisher roda no diretório do worker (não precisa do repo-cérebro).
    const saida = await rodarClaude(montarPromptPublisher(job.payload, peca), process.cwd(), { mcpConfigPath });
    costUsd = saida.costUsd;
    model = saida.model;
    veredito = parsePublisher(saida.result);
    if (!veredito) throw new Error(`publisher respondeu fora do contrato: ${String(saida.result).slice(0, 300)}`);
  }

  if (veredito.ok) {
    await rest('PATCH', `content_pieces?id=eq.${pieceId}&account_id=eq.${job.account_id}`, {
      status: 'agendada',
      updated_at: new Date().toISOString(),
    });
  }

  await rest('POST', 'content_chat_messages', {
    account_id: job.account_id,
    author: 'squad',
    body: veredito.ok
      ? `Publicação agendada ✔ ${veredito.detalhe || ''}`.trim()
      : `Não consegui agendar: ${veredito.detalhe || 'motivo não informado'}. A peça continua aprovada — tente de novo ou confira a conexão do Metricool.`,
    job_id: job.id,
    piece_id: pieceId,
  });

  if (costUsd !== null) {
    await rest('POST', 'os_cost_ledger', {
      account_id: job.account_id,
      agent: 'squad-content-publisher',
      model,
      date: new Date().toISOString().slice(0, 10),
      cost_usd: costUsd,
    });
  }

  await finalizarJob(job.id, {
    status: veredito.ok ? 'done' : 'failed',
    piece_id: pieceId,
    cost_usd: costUsd,
    model,
    ...(veredito.ok ? {} : { error: veredito.detalhe?.slice(0, 800) ?? 'falha no agendamento' }),
  });
  console.log(`[worker] job ${job.id} (publisher) ${veredito.ok ? 'done' : 'FALHOU'} · peça ${pieceId}`);
}

/** GERAR_SEMANA: monta a linha editorial (skill do repo) e cria as peças em Pauta. */
async function processarLinhaEditorial(job) {
  const lineId = job.payload?.line_id;
  if (!lineId) throw new Error('gerar_semana sem line_id no payload');
  const { repo } = cfg();

  try {
    let resultado;
    let costUsd = null;
    let model = ENV.GERADOR_MODEL ?? null;

    if (FAKE) {
      resultado = {
        reply: '[FAKE] Linha editorial de teste montada.',
        pecas: [{ titulo: '[FAKE] pauta', tipo: 'carrossel', data: job.payload?.start_date, tema: null }],
      };
    } else {
      await sincronizarFundacao(job.account_id).catch((e) =>
        console.error(`[worker] sync da fundação falhou (segue sem): ${e instanceof Error ? e.message : e}`),
      );
      const saida = await rodarClaude(montarPromptLinhaEditorial(job.payload), repo);
      costUsd = saida.costUsd;
      model = saida.model;
      resultado = parseLinhaEditorial(saida.result);
      if (!resultado) {
        throw new Error(`agente respondeu fora do contrato da linha: ${String(saida.result).slice(0, 300)}`);
      }
    }

    await rest('POST', 'content_pieces', pecasDaLinha(job.account_id, lineId, resultado.pecas));
    await rest('PATCH', `content_editorial_lines?id=eq.${lineId}`, {
      status: 'ativa',
      updated_at: new Date().toISOString(),
    });
    await rest('POST', 'content_chat_messages', {
      account_id: job.account_id,
      author: 'squad',
      body: resultado.reply,
      job_id: job.id,
    });
    if (costUsd !== null) {
      await rest('POST', 'os_cost_ledger', {
        account_id: job.account_id,
        agent: 'squad-content',
        model,
        date: new Date().toISOString().slice(0, 10),
        cost_usd: costUsd,
      });
    }
    await finalizarJob(job.id, { status: 'done', cost_usd: costUsd, model });
    console.log(`[worker] job ${job.id} (linha editorial) done · ${resultado.pecas.length} peça(s) em pauta`);
  } catch (e) {
    // Marca a linha como falha antes de repassar — a tela mostra o estado real.
    await rest('PATCH', `content_editorial_lines?id=eq.${lineId}`, {
      status: 'falhou',
      error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
      updated_at: new Date().toISOString(),
    }).catch(() => {});
    throw e;
  }
}

async function processar(job) {
  try {
    if (job.kind === 'chat') {
      await processarChat(job);
    } else if (job.kind === 'gerar_peca') {
      await processarGeracao(job);
    } else if (job.kind === 'ajustar_peca') {
      await processarAjuste(job);
    } else if (job.kind === 'agendar_publicacao') {
      await processarAgendamento(job);
    } else if (job.kind === 'gerar_semana') {
      await processarLinhaEditorial(job);
    } else {
      throw new Error(`kind não suportado ainda: ${job.kind}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[worker] job ${job.id} FALHOU: ${msg}`);
    await finalizarJob(job.id, { status: 'failed', error: msg.slice(0, 800) }).catch(() => {});
    // Resposta honesta no chat — o cliente nunca fica no vácuo.
    await rest('POST', 'content_chat_messages', {
      account_id: job.account_id,
      author: 'squad',
      body: 'Tive um problema pra atender esse pedido agora. A equipe já foi avisada — pode tentar de novo em alguns minutos.',
      job_id: job.id,
    }).catch(() => {});
  }
}

async function loop() {
  cfg(); // valida env logo na subida
  console.log(`[worker] Squad Content worker no ar (${FAKE ? 'FAKE' : 'real'} · poll ${POLL_MS}ms)`);
  for (;;) {
    try {
      const job = await proximoJob();
      if (job && (await claim(job))) {
        console.log(`[worker] processando job ${job.id} (${job.kind})`);
        await processar(job);
        continue; // sem sleep — pode ter próximo na fila
      }
    } catch (e) {
      console.error(`[worker] erro no loop: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// CLI
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loop().catch((e) => {
    console.error(`[worker] fatal: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
