'use client'

interface Props {
  products: any[]
  channels: any[]
  revenue2025: { marketplace: string; net_revenue: number }[]
  revenue2024: { marketplace: string; net_revenue: number }[]
  margins: any[]
}

// Estimated relative marketplace size indices (industry research, NOT from Supabase)
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

export default function KpiCards({ products, channels, revenue2025, revenue2024, margins }: Props) {
  const totalRevenue2025 = revenue2025.reduce((sum, r) => sum + r.net_revenue, 0)
  const totalRevenue2024 = revenue2024.reduce((sum, r) => sum + r.net_revenue, 0)
  const yoyGrowth = totalRevenue2024 > 0 ? ((totalRevenue2025 - totalRevenue2024) / totalRevenue2024) * 100 : 0

  // Get active products (status = 'Selling')
  const activeProducts = products.filter(p => p.status === 'Selling')

  // Get unique product×channel combos from margins
  const activeCombos = new Set(margins.map((m: any) => `${m.product_name}||${m.channel}`))
  const activeComboCount = activeCombos.size

  // Marketplaces with revenue
  const revenueMarketplaces = new Set(revenue2025.map(r => r.marketplace))

  // Total possible = active products × channels that have revenue
  const sellingProducts = activeProducts
  const relevantChannels = channels.filter((c: any) =>
    revenueMarketplaces.has(c.channel_name) || activeCombos.has(c.channel_name)
  )
  const totalPossible = sellingProducts.length * revenueMarketplaces.size
  const coverage = totalPossible > 0 ? (activeComboCount / totalPossible) * 100 : 0

  // Estimated total addressable revenue based on market size indices
  const deRevenue = revenue2025.find(r => r.marketplace === 'AMZ DE')?.net_revenue || 0
  const revenuePerIndex = deRevenue / (MARKET_SIZE_INDEX['AMZ DE'] || 1)
  const totalAddressable = Object.values(MARKET_SIZE_INDEX).reduce(
    (sum, idx) => sum + revenuePerIndex * idx,
    0
  )

  const fmt = (n: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

  const kpis = [
    {
      label: '2025 Net Revenue',
      value: fmt(totalRevenue2025),
      sub: `YoY: ${yoyGrowth >= 0 ? '+' : ''}${yoyGrowth.toFixed(1)}%`,
      subColor: yoyGrowth >= 0 ? 'text-green-400' : 'text-red-400',
      icon: '💰',
    },
    {
      label: 'Active Product×Channel',
      value: activeComboCount.toString(),
      sub: `of ${totalPossible} possible`,
      subColor: 'text-[#8B949E]',
      icon: '📊',
    },
    {
      label: 'Coverage',
      value: `${coverage.toFixed(1)}%`,
      sub: `${sellingProducts.length} products × ${revenueMarketplaces.size} channels`,
      subColor: 'text-[#8B949E]',
      icon: '🎯',
    },
    {
      label: 'Est. Addressable Revenue',
      value: fmt(totalAddressable),
      sub: '⚠️ Based on estimated market size indices',
      subColor: 'text-yellow-400',
      icon: '🌍',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, i) => (
        <div
          key={i}
          className="bg-[#161B22] border border-[#30363D] rounded-lg p-5 hover:border-[#00D4AA]/40 transition-colors"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{kpi.icon}</span>
            <span className="text-xs text-[#8B949E] uppercase tracking-wider font-medium">
              {kpi.label}
            </span>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{kpi.value}</div>
          <div className={`text-xs ${kpi.subColor}`}>{kpi.sub}</div>
        </div>
      ))}
    </div>
  )
}
