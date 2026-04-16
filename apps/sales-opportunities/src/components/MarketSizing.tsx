'use client'

interface Props {
  revenue2025: { marketplace: string; net_revenue: number }[]
  revenue2024: { marketplace: string; net_revenue: number }[]
  monthly2025: { marketplace: string; month: number; net_revenue: number }[]
}

// Estimated relative marketplace size indices (industry research, NOT from Supabase)
// Normalized to DE = 1.0
const MARKET_SIZE_INDEX: Record<string, number> = {
  'AMZ DE': 1.0,
  'AMZ UK': 1.1,
  'AMZ FR': 0.55,
  'AMZ IT': 0.45,
  'AMZ ES': 0.40,
  'AMZ USA': 6.5,
  'AMZ CA': 0.65,
  'AMZ NL': 0.15,
  'AMZ PL': 0.10,
  'AMZ SW': 0.08,
  'AMZ BE': 0.05,
  'BOL.COM': 0.25,
}

export default function MarketSizing({ revenue2025, revenue2024, monthly2025 }: Props) {
  const rev2024Map: Record<string, number> = {}
  revenue2024.forEach(r => { rev2024Map[r.marketplace] = r.net_revenue })

  const deRevenue = revenue2025.find(r => r.marketplace === 'AMZ DE')?.net_revenue || 1
  const revenuePerIndex = deRevenue / (MARKET_SIZE_INDEX['AMZ DE'] || 1)

  const fmt = (n: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

  // Build data rows sorted by 2025 revenue
  const rows = revenue2025
    .filter(r => r.marketplace !== 'WEBSHOP')
    .map(r => {
      const prev = rev2024Map[r.marketplace] || 0
      const yoy = prev > 0 ? ((r.net_revenue - prev) / prev) * 100 : null
      const sizeIndex = MARKET_SIZE_INDEX[r.marketplace]
      const potential = sizeIndex !== undefined ? revenuePerIndex * sizeIndex : null
      const gap = potential !== null ? potential - r.net_revenue : null
      const penetration = potential !== null && potential > 0 ? (r.net_revenue / potential) * 100 : null

      // Get monthly sparkline data
      const monthlyData = Array.from({ length: 12 }, (_, i) => {
        const m = monthly2025.find(
          md => md.marketplace === r.marketplace && md.month === i + 1
        )
        return m ? m.net_revenue : 0
      })

      return {
        marketplace: r.marketplace,
        revenue2025: r.net_revenue,
        revenue2024: prev,
        yoy,
        sizeIndex,
        potential,
        gap,
        penetration,
        monthlyData,
      }
    })

  const maxRevenue = Math.max(...rows.map(r => r.revenue2025))
  const maxMonthly = Math.max(...rows.flatMap(r => r.monthlyData))

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">
          <span className="text-[#00D4AA]">Market Sizing</span> & Opportunity Gap
        </h2>
        <p className="text-xs text-[#8B949E] mt-1">
          Revenue from Supabase P&amp;L • Market size indices are{' '}
          <span className="text-yellow-400 font-medium">estimated from industry research</span>{' '}
          (relative GMV size, normalized to DE = 1.0)
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#8B949E] text-xs uppercase tracking-wider">
              <th className="text-left p-3 font-medium">Marketplace</th>
              <th className="text-right p-3 font-medium">2025 Revenue</th>
              <th className="text-right p-3 font-medium">2024 Revenue</th>
              <th className="text-right p-3 font-medium">YoY Growth</th>
              <th className="text-center p-3 font-medium">
                <div>Size Index</div>
                <div className="text-[10px] normal-case tracking-normal text-yellow-400/80">est. research</div>
              </th>
              <th className="text-right p-3 font-medium">
                <div>Potential Rev.</div>
                <div className="text-[10px] normal-case tracking-normal text-yellow-400/80">if DE penetration</div>
              </th>
              <th className="text-right p-3 font-medium">Gap</th>
              <th className="text-right p-3 font-medium">Penetration</th>
              <th className="text-center p-3 font-medium">2025 Monthly Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.marketplace}
                className="border-t border-[#21262D] hover:bg-[#21262D]/50 transition-colors"
              >
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="font-semibold text-[#E6EDF3]">{row.marketplace}</div>
                    {/* Revenue bar */}
                    <div className="flex-1 max-w-[100px]">
                      <div
                        className="h-1.5 rounded-full bg-[#00D4AA]/40"
                        style={{ width: `${(row.revenue2025 / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="p-3 text-right font-mono text-[#E6EDF3] font-medium">
                  {fmt(row.revenue2025)}
                </td>
                <td className="p-3 text-right font-mono text-[#8B949E]">
                  {row.revenue2024 > 0 ? fmt(row.revenue2024) : '—'}
                </td>
                <td className="p-3 text-right">
                  {row.yoy !== null ? (
                    <span className={`font-mono font-medium ${row.yoy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {fmtPct(row.yoy)}
                    </span>
                  ) : (
                    <span className="text-[#6E7681]">New</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  {row.sizeIndex !== undefined ? (
                    <span className="font-mono text-yellow-300/90 bg-yellow-500/10 px-2 py-0.5 rounded text-xs">
                      {row.sizeIndex.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[#6E7681]">—</span>
                  )}
                </td>
                <td className="p-3 text-right font-mono text-[#8B949E]">
                  {row.potential !== null ? fmt(row.potential) : '—'}
                </td>
                <td className="p-3 text-right">
                  {row.gap !== null ? (
                    <span className={`font-mono font-medium ${row.gap > 0 ? 'text-blue-400' : 'text-green-400'}`}>
                      {row.gap > 0 ? '+' : ''}{fmt(row.gap)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-3 text-right">
                  {row.penetration !== null ? (
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-[#21262D] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            row.penetration >= 80 ? 'bg-green-500' :
                            row.penetration >= 40 ? 'bg-yellow-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${Math.min(row.penetration, 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-[#8B949E] w-10 text-right">
                        {row.penetration.toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-3">
                  {/* Sparkline */}
                  <div className="flex items-end gap-0.5 h-6 justify-center">
                    {row.monthlyData.map((val, mi) => (
                      <div
                        key={mi}
                        className="w-1.5 bg-[#00D4AA]/60 rounded-t-sm min-h-[1px]"
                        style={{
                          height: maxMonthly > 0 ? `${Math.max((val / maxMonthly) * 24, 1)}px` : '1px',
                        }}
                        title={`Month ${mi + 1}: €${val.toFixed(0)}`}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
