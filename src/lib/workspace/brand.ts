// src/lib/workspace/brand.ts
// Fundação da marca (tela /w/marca) — tipos + seções oficiais + puras.
// O conteúdo vive em content_brand_profile (migration 040); o worker injeta
// a versão mais recente na produção (referencia/fundacao-workspace/).

export interface BrandSection {
  section_key: string
  title: string
  content: string
  sort_order: number
  updated_at: string
}

/**
 * Seções oficiais da fundação (espelham conteudo-rodolfo/marca/ + linha-editorial).
 * O seed grava o conteúdo real; a tela usa isto como esqueleto/empty-state.
 */
export const BRAND_SECTION_CATALOG: { key: string; title: string; hint: string }[] = [
  { key: 'tom-de-voz', title: 'Tom de voz', hint: 'Como a marca fala: vocabulário, ritmo, o que nunca dizer.' },
  { key: 'icp', title: 'Cliente ideal (ICP)', hint: 'Pra quem o conteúdo fala: dores, objeções, linguagem do público.' },
  { key: 'base-conhecimento', title: 'Base de conhecimento', hint: 'Fatos, teses e argumentos que alimentam as peças.' },
  { key: 'linha-editorial', title: 'Linha editorial', hint: 'Pilares, formatos e calendário editorial.' },
]

/** Pura: ordena as seções pra tela (sort_order, depois título). */
export function orderBrandSections(rows: BrandSection[]): BrandSection[] {
  return [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'pt-BR'),
  )
}
