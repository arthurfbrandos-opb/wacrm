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
 * Seções oficiais da fundação (espelham conteudo-rodolfo/marca/).
 * O seed grava o conteúdo real; a tela usa isto como esqueleto/empty-state.
 * Linha editorial NÃO é seção de marca — é frente de produção própria
 * (aba Linha editorial da squad, content_editorial_lines).
 */
export const BRAND_SECTION_CATALOG: { key: string; title: string; hint: string }[] = [
  { key: 'tom-de-voz', title: 'Tom de voz', hint: 'Como a marca fala: vocabulário, ritmo, o que nunca dizer.' },
  { key: 'icp', title: 'Cliente ideal (ICP)', hint: 'Pra quem o conteúdo fala: dores, objeções, linguagem do público.' },
  { key: 'base-conhecimento', title: 'Base de conhecimento', hint: 'Fatos, teses e argumentos que alimentam as peças.' },
]

/** Pura: ordena as seções pra tela (sort_order, depois título). */
export function orderBrandSections(rows: BrandSection[]): BrandSection[] {
  return [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'pt-BR'),
  )
}
