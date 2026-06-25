import type { AdsFunnel, FunnelStage, CreativeCostRow, CreativeLead, SpendByAd } from './ads-types'

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

export function buildCreativeCostTable(args: {
  leads: CreativeLead[]
  bookedContactIds: Set<string>
  attendedContactIds: Set<string>
  spend: SpendByAd[]
}): CreativeCostRow[] {
  interface Agg {
    creative: string
    campaign: string | null
    leadIds: Set<string>
    booked: Set<string>
    attended: Set<string>
  }
  const byCreative = new Map<string, Agg>()
  for (const l of args.leads) {
    let agg = byCreative.get(l.creative)
    if (!agg) {
      agg = { creative: l.creative, campaign: l.campaign, leadIds: new Set(), booked: new Set(), attended: new Set() }
      byCreative.set(l.creative, agg)
    }
    agg.leadIds.add(l.contactId)
    if (args.bookedContactIds.has(l.contactId)) agg.booked.add(l.contactId)
    if (args.attendedContactIds.has(l.contactId)) agg.attended.add(l.contactId)
  }

  // Gasto somado por ad_name.
  const spendByAd = new Map<string, { spend: number; campaign: string | null }>()
  for (const s of args.spend) {
    const cur = spendByAd.get(s.adName) ?? { spend: 0, campaign: s.campaignName }
    cur.spend += s.spend
    spendByAd.set(s.adName, cur)
  }

  const rows: CreativeCostRow[] = []
  const div = (num: number, den: number) => (num > 0 && den > 0 ? Math.round((num / den) * 100) / 100 : null)

  // 1) Linhas a partir dos leads (com ou sem gasto casado).
  for (const agg of byCreative.values()) {
    const spend = spendByAd.get(agg.creative)?.spend ?? 0
    const leads = agg.leadIds.size
    const booked = agg.booked.size
    const attended = agg.attended.size
    rows.push({
      creative: agg.creative,
      campaign: agg.campaign,
      spend,
      leads,
      cpl: div(spend, leads),
      booked,
      costPerBooking: div(spend, booked),
      attended,
      costPerAttended: div(spend, attended),
    })
  }

  // 2) Gasto sem nenhum lead casado → linha visível (flagra rename/typo de UTM).
  for (const [adName, info] of spendByAd) {
    if (byCreative.has(adName)) continue
    rows.push({
      creative: adName,
      campaign: info.campaign,
      spend: info.spend,
      leads: 0,
      cpl: null,
      booked: 0,
      costPerBooking: null,
      attended: 0,
      costPerAttended: null,
    })
  }

  // Ordena por gasto desc (determinístico pros testes e útil pro operador).
  return rows.sort((a, b) => b.spend - a.spend || b.leads - a.leads)
}
