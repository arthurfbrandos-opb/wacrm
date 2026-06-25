import type { AdsFunnel, FunnelStage } from './ads-types'

const FUNNEL_LABELS: Record<FunnelStage['key'], string> = {
  leads: 'Leads',
  responded: 'Responderam',
  booked: 'Agendaram',
  attended: 'Compareceram',
  sold: 'Venderam',
}

export function computeFunnel(args: {
  leadContactIds: string[]
  respondedContactIds: Iterable<string>
  bookedContactIds: Iterable<string>
  attendedContactIds: Iterable<string>
  soldContactIds: Iterable<string>
}): AdsFunnel {
  const leads = new Set(args.leadContactIds)
  // Cada etapa = leads que alcançaram aquele estado (subset dos leads).
  const inLeads = (ids: Iterable<string>) => {
    let n = 0
    const seen = new Set<string>()
    for (const id of ids) {
      if (leads.has(id) && !seen.has(id)) {
        seen.add(id)
        n++
      }
    }
    return n
  }

  const counts: Record<FunnelStage['key'], number> = {
    leads: leads.size,
    responded: inLeads(args.respondedContactIds),
    booked: inLeads(args.bookedContactIds),
    attended: inLeads(args.attendedContactIds),
    sold: inLeads(args.soldContactIds),
  }

  const order: FunnelStage['key'][] = ['leads', 'responded', 'booked', 'attended', 'sold']
  const stages: FunnelStage[] = order.map((key, i) => {
    const convFromPrevPct =
      i === 0 ? null : counts[order[i - 1]] === 0 ? null : Math.round((counts[key] / counts[order[i - 1]]) * 100)
    return { key, label: FUNNEL_LABELS[key], count: counts[key], convFromPrevPct }
  })

  return { stages }
}
