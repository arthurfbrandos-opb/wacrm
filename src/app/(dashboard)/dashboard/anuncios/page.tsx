"use client"
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadAdsLiveOps, loadAdsFunnel, loadCreativeCostTable } from '@/lib/dashboard/ads-queries'
import type { AdsLiveOps, AdsFunnel, CreativeCostRow } from '@/lib/dashboard/ads-types'
import { LiveOpsCards } from '@/components/dashboard/ads/live-ops-cards'
import { FunnelBars } from '@/components/dashboard/ads/funnel-bars'
import { CreativeCostTable } from '@/components/dashboard/ads/creative-cost-table'

type RangeDays = 1 | 7 | 365

export default function AnunciosPage() {
  const [liveOps, setLiveOps] = useState<AdsLiveOps | null>(null)
  const [funnel, setFunnel] = useState<AdsFunnel | null>(null)
  const [cost, setCost] = useState<{ rows: CreativeCostRow[]; spendSyncedAt: string | null } | null>(null)
  const [range, setRange] = useState<RangeDays>(7)

  const load = useCallback((r: RangeDays) => {
    const db = createClient()
    void loadAdsLiveOps(db).then(setLiveOps).catch((e) => console.error('[anuncios] liveops', e))
    void loadAdsFunnel(db, r).then(setFunnel).catch((e) => console.error('[anuncios] funnel', e))
    void loadCreativeCostTable(db, r).then(setCost).catch((e) => console.error('[anuncios] cost', e))
  }, [])

  useEffect(() => { load(range) }, [load, range])

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-2xl font-bold text-foreground">
          <span className="text-primary">▸</span> anúncios/painel
        </h1>
        <div className="flex gap-2">
          {([['Hoje', 1], ['7 dias', 7], ['Desde o início', 365]] as [string, RangeDays][]).map(([lbl, v]) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={
                range === v
                  ? 'font-mono text-sm font-semibold text-primary underline'
                  : 'font-mono text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <LiveOpsCards data={liveOps} />
      <FunnelBars data={funnel} />
      <CreativeCostTable data={cost} />
    </div>
  )
}
