/** Tempo relativo compacto PT-BR pra lista de conversas ("4h", "1d", "12/06"). */
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function shortTimeAgo(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = nowMs - t
  if (diff < MIN) return 'agora'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`
  const d = new Date(t)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}
