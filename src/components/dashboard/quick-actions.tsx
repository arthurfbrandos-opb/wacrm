"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react'
import type { ComponentType } from 'react'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { label: 'new contact', href: '/contacts', icon: UserPlus, tint: 'text-primary' },
  { label: 'new deal', href: '/pipelines', icon: Briefcase, tint: 'text-blue-400' },
  { label: 'new broadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-amber-400' },
  { label: 'new automation', href: '/automations/new', icon: Zap, tint: 'text-primary' },
]

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 font-mono text-sm transition-colors hover:border-primary/40 hover:bg-muted/60"
          >
            <span className="text-primary">▸</span>
            <Icon className={`h-4 w-4 ${a.tint}`} />
            <span className="text-foreground">{a.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
