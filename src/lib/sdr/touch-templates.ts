/**
 * Mapa toque → template Meta aprovado. Sem entrada = rede de segurança
 * (adia o toque fora da janela em vez de mandar texto livre rejeitado).
 *
 * Os 2 lembretes carregam {{1}}=primeiro nome e {{2}}=data/hora do evento
 * (24h: "13/06 às 15h" · 2h: "15h") — o 2º parâmetro é montado em
 * touches-processor.ts via spDayHour(event_start_iso). Submetidos/aprovados
 * na Meta 30/06 (WABA 986434437725624).
 *
 * `body` = texto EXATO aprovado na Meta — usado só pra persistir no inbox
 * o que o lead de fato recebeu (antes gravávamos o placeholder "[tipo]").
 */
import type { SdrTouchType } from './touches'

export interface TouchTemplate {
  name: string
  lang: string
  body: string
}

export const TOUCH_TEMPLATES: Partial<Record<SdrTouchType, TouchTemplate>> = {
  reminder_24h: {
    name: 'lembrete_24h',
    lang: 'pt_BR',
    body: 'Oi {{1}}! Lembrete rápido: seu diagnóstico com o Arthur é amanhã, {{2}}. Se mudar qualquer coisa, me avisa por aqui.',
  },
  reminder_2h: {
    name: 'lembrete_2h',
    lang: 'pt_BR',
    body: 'Oi {{1}}, hoje às {{2}} tem seu diagnóstico com o Arthur! O link da call tá no seu email, do Calendly. Te espero lá.',
  },
}

export function templateForTouch(type: SdrTouchType): TouchTemplate | null {
  return TOUCH_TEMPLATES[type] ?? null
}
