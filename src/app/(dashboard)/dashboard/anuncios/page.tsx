"use client"
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadAdsLiveOps, loadAdsFunnel, loadCreativeCostTable } from '@/lib/dashboard/ads-queries'
import type { AdsLiveOps, AdsFunnel, CreativeCostRow } from '@/lib/dashboard/ads-types'
import { startOfLocalDay, daysAgoStart } from '@/lib/dashboard/date-utils'
import { LiveOpsCards } from '@/components/dashboard/ads/live-ops-cards'
import { FunnelChart } from '@/components/dashboard/ads/funnel-chart'
import { CreativeCostTable } from '@/components/dashboard/ads/creative-cost-table'

type PresetKey = 'hoje' | '7d' | 'all' | 'custom'
interface Range {
  since: string
  until: string // exclusivo
  key: PresetKey
}

function presetRange(key: Exclude<PresetKey, 'custom'>): Range {
  const until = new Date().toISOString()
  if (key === 'hoje') return { since: startOfLocalDay().toISOString(), until, key }
  if (key === '7d') return { since: daysAgoStart(6).toISOString(), until, key }
  return { since: new Date(0).toISOString(), until, key } // desde o início
}

function customRange(start: string, end: string): Range {
  const [ys, ms, ds] = start.split('-').map(Number)
  const [ye, me, de] = end.split('-').map(Number)
  const since = new Date(ys, ms - 1, ds).toISOString()
  const until = new Date(ye, me - 1, de + 1).toISOString() // início do dia seguinte (exclusivo)
  return { since, until, key: 'custom' }
}

const PRESETS: [string, Exclude<PresetKey, 'custom'>][] = [
  ['Hoje', 'hoje'],
  ['7 dias', '7d'],
  ['Desde o início', 'all'],
]

export default function AnunciosPage() {
  const [liveOps, setLiveOps] = useState<AdsLiveOps | null>(null)
  const [funnel, setFunnel] = useState<AdsFunnel | null>(null)
  const [cost, setCost] = useState<{ rows: CreativeCostRow[]; spendSyncedAt: string | null } | null>(null)
  const [range, setRange] = useState<Range>(() => presetRange('7d'))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const load = useCallback((r: Range) => {
    const db = createClient()
    setLiveOps(null)
    setFunnel(null)
    setCost(null)
    void loadAdsLiveOps(db, r.since, r.until).then(setLiveOps).catch((e) => console.error('[anuncios] liveops', e))
    void loadAdsFunnel(db, r.since, r.until).then(setFunnel).catch((e) => console.error('[anuncios] funnel', e))
    void loadCreativeCostTable(db, r.since, r.until).then(setCost).catch((e) => console.error('[anuncios] cost', e))
  }, [])

  useEffect(() => {
    load(range)
  }, [load, range])

  function applyCustom(start: string, end: string) {
    setCustomStart(start)
    setCustomEnd(end)
    if (start && end && start <= end) setRange(customRange(start, end))
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-mono text-2xl font-bold text-foreground">
          <span className="text-primary">▸</span> anúncios/painel
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(([lbl, k]) => (
            <button
              key={k}
              onClick={() => setRange(presetRange(k))}
              className={
                range.key === k
                  ? 'font-mono text-sm font-semibold text-primary underline'
                  : 'font-mono text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {lbl}
            </button>
          ))}
          <span className="mx-1 text-muted-foreground">|</span>
          <input
            type="date"
            value={customStart}
            max={customEnd || undefined}
            onChange={(e) => applyCustom(e.target.value, customEnd)}
            aria-label="Data início"
            className={
              'rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground ' +
              (range.key === 'custom' ? 'border-primary' : 'border-border')
            }
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={customEnd}
            min={customStart || undefined}
            onChange={(e) => applyCustom(customStart, e.target.value)}
            aria-label="Data fim"
            className={
              'rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground ' +
              (range.key === 'custom' ? 'border-primary' : 'border-border')
            }
          />
        </div>
      </div>
      <LiveOpsCards data={liveOps} />
      <FunnelChart data={funnel} />
      <CreativeCostTable data={cost} />
    </div>
  )
}
