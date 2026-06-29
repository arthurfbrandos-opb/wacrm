/** Escolhe o canal do 1º contato FAP01 a partir da origem principal,
 *  caindo pro outro canal se a escolhida estiver indisponível. */
import type { Provider } from './send-plan'

export function pickFap01Provider(
  source: Provider,
  avail: { meta: boolean; uaz: boolean },
): Provider | null {
  const ok = (p: Provider) => (p === 'meta' ? avail.meta : avail.uaz)
  if (ok(source)) return source
  const other: Provider = source === 'meta' ? 'uazapi' : 'meta'
  if (ok(other)) return other
  return null
}
