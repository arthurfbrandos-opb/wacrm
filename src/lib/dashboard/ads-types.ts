/** Criativo (utm_content) + campanha (utm_campaign) resolvidos de um lead. */
export interface CreativeAttribution {
  creative: string // utm_content, ou "Sem atribuição"
  campaign: string | null // utm_campaign
}

/** Bloco 1 · operação. Tudo no período selecionado, exceto awaitingResponseNow (estado atual). */
export interface AdsLiveOps {
  leads: number // leads no período
  responded: { count: number; pct: number } // % dos leads do período que responderam
  bookings: number // agendamentos no período
  avgFirstResponseMin: number | null // média de 1ª resposta no período
  awaitingResponseNow: number // fila viva AGORA — independe do período
}

/** Bloco 2 · funil. */
export interface FunnelStage {
  key: 'leads' | 'responded' | 'booked' | 'attended' | 'sold'
  label: string
  count: number
  convFromPrevPct: number | null // null no 1º estágio
}
export interface AdsFunnel {
  stages: FunnelStage[]
}

/** Bloco 3 · custo por resultado por criativo. */
export interface CreativeLead {
  contactId: string
  creative: string
  campaign: string | null
}
export interface SpendByAd {
  adName: string
  campaignName: string | null
  spend: number
}
export interface CreativeCostRow {
  creative: string
  campaign: string | null
  spend: number
  leads: number
  cpl: number | null // null se leads=0
  booked: number
  costPerBooking: number | null
  attended: number
  costPerAttended: number | null
}
