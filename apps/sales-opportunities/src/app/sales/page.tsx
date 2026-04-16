import { createClient } from '@supabase/supabase-js'
import KpiCards from '@/components/KpiCards'
import MatrixHeatmap from '@/components/MatrixHeatmap'
import MarketSizing from '@/components/MarketSizing'
import GrowthOpportunities from '@/components/GrowthOpportunities'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function fetchData() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [productsRes, channelsRes, marginsRes] = await Promise.all([
    supabase
      .from('Puzzlup_Product_Info')
      .select('sku, product_type, brand, color, size, status, cogs_usd, ean')
      .order('sku'),
    supabase
      .from('puzzlup_channels')
      .select('*')
      .order('channel_name'),
    supabase
      .from('puzzlup_margins')
      .select('*')
      .order('product_name'),
  ])

  // Fetch P&L data using from() with filters
  const [plRes2025, plRes2024, plMonthlyRes] = await Promise.all([
    supabase
      .from('P&L_Masterdata')
      .select('marketplace, amount')
      .eq('section', 'REVENUE')
      .eq('line_item', 'Net Revenue')
      .eq('fiscal_year', 2025),
    supabase
      .from('P&L_Masterdata')
      .select('marketplace, amount')
      .eq('section', 'REVENUE')
      .eq('line_item', 'Net Revenue')
      .eq('fiscal_year', 2024),
    supabase
      .from('P&L_Masterdata')
      .select('marketplace, month, amount')
      .eq('section', 'REVENUE')
      .eq('line_item', 'Net Revenue')
      .eq('fiscal_year', 2025),
  ])

  // Aggregate 2025 revenue by marketplace
  const rev2025Map: Record<string, number> = {}
  ;(plRes2025.data || []).forEach((row: any) => {
    const mp = row.marketplace
    rev2025Map[mp] = (rev2025Map[mp] || 0) + Number(row.amount)
  })

  // Aggregate 2024 revenue by marketplace
  const rev2024Map: Record<string, number> = {}
  ;(plRes2024.data || []).forEach((row: any) => {
    const mp = row.marketplace
    rev2024Map[mp] = (rev2024Map[mp] || 0) + Number(row.amount)
  })

  // Aggregate monthly 2025 revenue
  const monthlyMap: Record<string, Record<number, number>> = {}
  ;(plMonthlyRes.data || []).forEach((row: any) => {
    const mp = row.marketplace
    const m = Number(row.month)
    if (!monthlyMap[mp]) monthlyMap[mp] = {}
    monthlyMap[mp][m] = (monthlyMap[mp][m] || 0) + Number(row.amount)
  })

  // Convert maps to sorted arrays
  const revenue2025 = Object.entries(rev2025Map)
    .map(([marketplace, net_revenue]) => ({ marketplace, net_revenue }))
    .sort((a, b) => b.net_revenue - a.net_revenue)

  const revenue2024 = Object.entries(rev2024Map)
    .map(([marketplace, net_revenue]) => ({ marketplace, net_revenue }))

  const monthly2025 = Object.entries(monthlyMap).flatMap(([marketplace, months]) =>
    Object.entries(months).map(([month, net_revenue]) => ({
      marketplace,
      month: Number(month),
      net_revenue,
    }))
  )

  return {
    products: productsRes.data || [],
    channels: channelsRes.data || [],
    revenue2025,
    revenue2024,
    margins: marginsRes.data || [],
    monthly2025,
  }
}

export default async function SalesPage() {
  const data = await fetchData()

  return (
    <main className="min-h-screen bg-[#0D1117]">
      {/* Header */}
      <div className="border-b border-[#30363D] bg-[#161B22]">
        <div className="max-w-[1600px] mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                <span className="text-[#00D4AA]">Puzzlup</span> Sales Opportunities
              </h1>
              <p className="text-[#8B949E] text-sm mt-1">
                Product × Channel matrix • Live data from Supabase
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-[#8B949E]">Last refreshed</div>
              <div className="text-sm text-[#E6EDF3] font-mono">
                {new Date().toLocaleString('en-GB', { timeZone: 'Europe/Brussels' })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-8">
        <KpiCards
          products={data.products}
          channels={data.channels}
          revenue2025={data.revenue2025}
          revenue2024={data.revenue2024}
          margins={data.margins}
        />
        <MatrixHeatmap
          products={data.products}
          channels={data.channels}
          revenue2025={data.revenue2025}
          margins={data.margins}
        />
        <MarketSizing
          revenue2025={data.revenue2025}
          revenue2024={data.revenue2024}
          monthly2025={data.monthly2025}
        />
        <GrowthOpportunities
          products={data.products}
          channels={data.channels}
          revenue2025={data.revenue2025}
          margins={data.margins}
        />
        <div className="text-center py-6 border-t border-[#30363D]">
          <p className="text-[#8B949E] text-xs">
            Data sourced live from Supabase • Market size indices are estimated from industry research (clearly labeled) •
            All revenue figures from P&L_Masterdata (line_item = 'Net Revenue')
          </p>
        </div>
      </div>
    </main>
  )
}
