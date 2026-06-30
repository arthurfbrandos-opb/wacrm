/**
 * Mapa toque → template Meta aprovado. Sem entrada = rede de segurança
 * (adia o toque fora da janela em vez de mandar texto livre rejeitado).
 *
 * Os 2 lembretes carregam {{1}}=primeiro nome e {{2}}=data/hora do evento
 * (24h: "13/06 às 15h" · 2h: "15h") — o 2º parâmetro é montado em
 * touches-processor.ts via spDayHour(event_start_iso). Submetidos/aprovados
 * na Meta 30/06 (WABA 986434437725624).
 */
import type { SdrTouchType } from './touches'

export const TOUCH_TEMPLATES: Partial<Record<SdrTouchType, { name: string; lang: string }>> = {
  reminder_24h: { name: 'lembrete_24h', lang: 'pt_BR' },
  reminder_2h: { name: 'lembrete_2h', lang: 'pt_BR' },
}

export function templateForTouch(type: SdrTouchType): { name: string; lang: string } | null {
  return TOUCH_TEMPLATES[type] ?? null
}
