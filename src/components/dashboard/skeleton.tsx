import { cn } from '@/lib/utils'
import { TerminalWindow } from '@/components/ui/terminal-window'

/**
 * Shared skeleton primitive — a pulsing slate block sized to whatever
 * container it's dropped into. Used by every dashboard widget while
 * its data fetches.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

// Loading placeholder for a metric tile — keeps the terminal-window
// chrome so the card doesn't pop a frame in once data arrives.
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <TerminalWindow title="metrics/…" className={cn('h-full', className)}>
      <div className="p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-8 w-20" />
        <Skeleton className="mt-2 h-3 w-16" />
      </div>
    </TerminalWindow>
  )
}
