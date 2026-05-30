'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/tasks', label: 'Tasks' },
  { href: '/company-timeline', label: 'Company Timeline' },
  { href: '/sales', label: 'Sales Opportunities' },
]

interface AppHeaderProps {
  title: React.ReactNode
  subtitle?: string
  actions?: React.ReactNode
}

export default function AppHeader({ title, subtitle, actions }: AppHeaderProps) {
  const pathname = usePathname()

  return (
    <div className="border-b border-[#30363D] bg-[#161B22]">
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        <nav className="flex items-center gap-1 mb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#8B949E] mr-3">
            Qualico
          </span>
          {NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#00D4AA]/15 text-[#00D4AA]'
                    : 'text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D]'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{title}</h1>
            {subtitle ? (
              <p className="text-[#8B949E] text-sm mt-1">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </div>
    </div>
  )
}
