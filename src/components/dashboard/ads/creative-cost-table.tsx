import { Skeleton } from '@/components/dashboard/skeleton'
import { TerminalWindow } from '@/components/ui/terminal-window'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'
import type { CreativeCostRow } from '@/lib/dashboard/ads-types'

interface CreativeCostTableProps {
  data: { rows: CreativeCostRow[]; spendSyncedAt: string | null } | null
}

function spendBadge(syncedAt: string | null): string {
  if (!syncedAt) return 'sem gasto sincronizado'
  const diffMs = Date.now() - new Date(syncedAt).getTime()
  const diffH = Math.round(diffMs / 3_600_000)
  if (diffH < 1) return 'gasto atualizado há menos de 1h'
  return `gasto atualizado há ${diffH}h`
}

function fmt(value: number | null, currency = 'BRL'): string {
  if (value === null) return '—'
  return formatCurrency(value, currency)
}

export function CreativeCostTable({ data }: CreativeCostTableProps) {
  if (!data) {
    return (
      <TerminalWindow title="ads/custo-por-criativo">
        <div className="space-y-2 p-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </TerminalWindow>
    )
  }

  const badge = spendBadge(data.spendSyncedAt)

  return (
    <TerminalWindow title="ads/custo-por-criativo">
      <div className="p-5">
        {/* Spend sync badge */}
        <div className="mb-3 inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {badge}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Criativo</th>
                <th className="py-2 pr-4 text-right font-medium">Gasto</th>
                <th className="py-2 pr-4 text-right font-medium">Leads</th>
                <th className="py-2 pr-4 text-right font-medium">CPL</th>
                <th className="py-2 pr-4 text-right font-medium">Agendou</th>
                <th className="py-2 pr-4 text-right font-medium">Custo/agend.</th>
                <th className="py-2 pr-4 text-right font-medium">Compareceu</th>
                <th className="py-2 text-right font-medium">Custo/compar.</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    nenhum dado no período
                  </td>
                </tr>
              ) : (
                data.rows.map((row, i) => {
                  const isUnattributed = row.creative === 'Sem atribuição'
                  return (
                    <tr
                      key={i}
                      className={cn(
                        'border-b border-border/50 transition-colors hover:bg-muted/30',
                        isUnattributed && 'text-muted-foreground',
                      )}
                    >
                      <td className="py-2 pr-4">
                        <span
                          className="max-w-[180px] truncate block"
                          title={row.creative}
                        >
                          {row.creative}
                        </span>
                        {row.campaign && (
                          <span className="text-[10px] text-muted-foreground/70">
                            {row.campaign}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {fmt(row.spend)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.leads}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {fmt(row.cpl)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.booked}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {fmt(row.costPerBooking)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.attended}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {fmt(row.costPerAttended)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TerminalWindow>
  )
}
