/**
 * Mapa toque → template Meta aprovado. Vazio p/ reminders até a copy ser
 * escrita e aprovada na Meta (follow-up). Sem entrada = rede de segurança
 * (adia o toque fora da janela em vez de mandar texto livre rejeitado).
 */
import type { SdrTouchType } from './touches'

export const TOUCH_TEMPLATES: Partial<Record<SdrTouchType, { name: string; lang: string }>> = {
  // reminder_24h: { name: 'lembrete_24h', lang: 'pt_BR' },  // quando aprovado pela Meta
  // reminder_2h:  { name: 'lembrete_2h',  lang: 'pt_BR' },  // quando aprovado pela Meta
}

export function templateForTouch(type: SdrTouchType): { name: string; lang: string } | null {
  return TOUCH_TEMPLATES[type] ?? null
}
