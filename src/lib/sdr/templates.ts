/** Fixed SDR touch templates (copy approved by Arthur 2026-06-11).
 *  Ported verbatim from ns-crm src/lib/domains/sdr/templates.ts. */

const firstName = (name: string) => (name || '').trim().split(/\s+/)[0] || 'tudo bem'

/** "2026-06-13T15:00:00-03:00" → { ddmm: "13/06", hour: "15h" } (offset is already SP). */
export function spDayHour(startIso: string): { ddmm: string; hour: string } {
  if (startIso.endsWith('Z')) {
    throw new Error(`spDayHour expects ISO with SP offset, got UTC: ${startIso}`)
  }
  const [date, time] = startIso.slice(0, 16).split('T')
  const [, mo, da] = date.split('-')
  const [h, mi] = time.split(':')
  return { ddmm: `${da}/${mo}`, hour: `${parseInt(h, 10)}h${mi === '00' ? '' : mi}` }
}

export function chaseBubbles(name: string): string[] {
  const n = firstName(name)
  return [
    `Fala ${n}, Ian da Negócio Simples aqui, tudo certo?`,
    'Recebi seu cadastro aqui e queria te fazer 2 ou 3 perguntas rápidas antes de agendar nosso diagnóstico. Pode ser? Jogo rápido.',
  ]
}

export function confirmBubbles(name: string, startIso: string): string[] {
  const n = firstName(name)
  const { ddmm, hour } = spDayHour(startIso)
  return [
    `Fala ${n}, Ian da Negócio Simples aqui, tudo certo?`,
    `Vi que cê marcou o diagnóstico com o Arthur pra ${ddmm} às ${hour}. Tá confirmado, já tá na agenda dele.`,
    'Antes da call, queria só bater dois dados rápidos do seu cadastro contigo. Pode ser?',
  ]
}

export function reminder24hBubbles(name: string, startIso: string): string[] {
  const { ddmm, hour } = spDayHour(startIso)
  return [
    `Oi ${firstName(name)}! Lembrete rápido: seu diagnóstico com o Arthur é amanhã, ${ddmm} às ${hour}.`,
    'Se mudar qualquer coisa, me avisa por aqui.',
  ]
}

export function reminder2hBubbles(name: string, startIso: string, meetLink: string): string[] {
  const { hour } = spDayHour(startIso)
  const first = `${firstName(name)}, hoje às ${hour} tem seu diagnóstico com o Arthur. Te espero lá!`
  if (meetLink) return [first, `🔗 ${meetLink}`]
  return [first, 'O link da call chegou no seu email, do Calendly. Qualquer coisa me chama.']
}
