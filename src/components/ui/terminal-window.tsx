import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TerminalWindowProps {
  /**
   * Mono header label shown after the traffic-light dots, like a file
   * path or command (e.g. "metrics/active_conversations"). Optional —
   * a window with no title just shows the dots bar.
   */
  title?: string
  /** Right-aligned chrome in the header bar (e.g. range toggles). */
  action?: ReactNode
  className?: string
  /** Applied to the body wrapper — pass flex utils when the body needs to fill. */
  bodyClassName?: string
  children: ReactNode
}

// The NS terminal-window atom (ns-darknative). Mirrors `.term-window`
// from second-brain/identidade-visual/index.html: a header bar with the
// three macOS traffic-light dots + a mono path label, over a body. Used
// to give every dashboard "square" the look of a terminal screen.
export function TerminalWindow({
  title,
  action,
  className,
  bodyClassName,
  children,
}: TerminalWindowProps) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-card',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-card-2 px-3 py-2">
        <span className="flex shrink-0 gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        </span>
        {title && (
          <span className="ml-1 truncate font-mono text-xs text-muted-foreground">
            {title}
          </span>
        )}
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </div>
      <div className={cn('flex-1', bodyClassName)}>{children}</div>
    </div>
  )
}
