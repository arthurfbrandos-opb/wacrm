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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Funções puras (testadas em content-worker.test.mjs) ─────────────────────

/** Monta o prompt do job de chat pro Claude operar o repo-cérebro. */
export function montarPrompt(payload) {
  const pedido = String(payload?.message ?? '').trim();
  return [
    'Você é a SQUAD CONTENT operando ESTE repositório de conteúdo do cliente (Dr. Rodolfo · HMR).',
    'O cliente mandou a mensagem abaixo pelo chat da ferramenta. Atenda ao pedido.',
    '',
    `MENSAGEM DO CLIENTE: ${pedido}`,
    '',
    'REGRAS:',
    '- Se for pedido de PEÇA (carrossel/estático): produza ponta a ponta usando as skills do repo:',
    '  copy pela skill construtor-copy (voz da fundação em marca/ · humanize · SEM travessão · máx 5 hashtags),',
    '  arte pelos scripts das skills (editor-carrossel/render_carrossel.py ou editor-estatico/render_estatico.py),',
    '  salvando em producao/<slug>/. Use uma imagem de referencia/ como foto/fundo se precisar.',
    '- Se NÃO for pedido de peça (dúvida, ajuste de rota, conversa): apenas responda no campo "reply" e "peca": null.',
    '- NUNCA invente fatos, leis, números ou resultados. Na dúvida, pergunte no "reply".',
    '- Responda em PT-BR, tom direto e claro (o leitor é o cliente).',
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

/** URL pública de um objeto no bucket público. */
export function publicUrl(supabaseUrl, bucket, path) {
  const base = String(supabaseUrl).replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
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

function rodarClaude(prompt, repoDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      // HARD: sem isso, hooks globais do usuário matam o headless (lição 21/06).
      '--setting-sources', 'project,local',
    ];
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

async function processarChat(job) {
  const { repo } = cfg();

  let resultado;
  let costUsd = null;
  let model = ENV.GERADOR_MODEL ?? null;

  if (FAKE) {
    // Plumbing test: prova fila→peça→chat→ledger sem gastar token.
    resultado = {
      reply: '[FAKE] Peça de teste produzida — confere no kanban em "Pra aprovar".',
      peca: {
        slug: 'peca-fake',
        titulo: `[FAKE] ${String(job.payload?.message ?? 'peça de teste').slice(0, 60)}`,
        tipo: 'carrossel',
        legenda: 'Legenda de teste do worker (modo FAKE).',
        arquivo_preview: null,
      },
    };
  } else {
    const saida = await rodarClaude(montarPrompt(job.payload), repo);
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

async function processar(job) {
  try {
    if (job.kind === 'chat') {
      await processarChat(job);
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
