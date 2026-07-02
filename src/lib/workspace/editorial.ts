// src/lib/workspace/editorial.ts
// Linha editorial — tipos + validação pura do formulário "Nova linha editorial".
// Regra de produto (Arthur 02/07): máximo 1 conteúdo por dia do período;
// vídeo entra no mix (a squad entrega o ROTEIRO — ele grava e sobe no Drive).

export interface EditorialLine {
  id: string
  start_date: string
  end_date: string
  mix: { carrossel?: number; estatico?: number; video?: number }
  themes: string | null
  status: 'gerando' | 'ativa' | 'falhou' | 'encerrada'
  error: string | null
  created_at: string
}

export interface NewLineInput {
  start_date: string
  end_date: string
  carrossel: number
  estatico: number
  video: number
  themes: string
}

/** Dias corridos do período, inclusivo nas duas pontas (datas YYYY-MM-DD). */
export function periodDays(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0
  return Math.floor((e.getTime() - s.getTime()) / 86_400_000) + 1
}

export interface LineValidation {
  ok: boolean
  errors: string[]
  total: number
  days: number
}

/** Pura: valida o formulário da nova linha (datas · mix · 1 conteúdo/dia). */
export function validateNewLine(input: NewLineInput): LineValidation {
  const errors: string[] = []
  const days = periodDays(input.start_date, input.end_date)
  const counts = [input.carrossel, input.estatico, input.video]
  const total = counts.reduce((s, n) => s + (Number.isInteger(n) && n > 0 ? n : 0), 0)

  if (!input.start_date || !input.end_date || days < 1) {
    errors.push('Período inválido — a data fim precisa ser igual ou depois da data início.')
  }
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) {
    errors.push('Quantidades precisam ser números inteiros (0 ou mais).')
  }
  if (total < 1) {
    errors.push('A linha precisa de pelo menos 1 conteúdo.')
  }
  if (days >= 1 && total > days) {
    errors.push(`Máximo de 1 conteúdo por dia: o período tem ${days} dia(s) e você pediu ${total}.`)
  }
  return { ok: errors.length === 0, errors, total, days }
}

/** Rótulo curto do mix pra tela ("2 carrosséis · 1 estático"). */
export function mixLabel(mix: EditorialLine['mix']): string {
  const parts: string[] = []
  const c = mix.carrossel ?? 0
  const e = mix.estatico ?? 0
  const v = mix.video ?? 0
  if (c) parts.push(`${c} ${c === 1 ? 'carrossel' : 'carrosséis'}`)
  if (e) parts.push(`${e} ${e === 1 ? 'estático' : 'estáticos'}`)
  if (v) parts.push(`${v} ${v === 1 ? 'vídeo' : 'vídeos'}`)
  return parts.join(' · ') || 'sem formatos'
}
