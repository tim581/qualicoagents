'use client'

interface Props {
  products: any[]
  channels: any[]
  revenue2025: { marketplace: string; net_revenue: number }[]
  margins: any[]
}

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

interface Opportunity {
  product: string
  channel: string
  type: 'Launch' | 'Expansion'
  estimatedRevenue: number
  reason: string
  priority: 'High' | 'Medium' | 'Low'
}

export default function GrowthOpportunities({ products, channels, revenue2025, margins }: Props) {
  const revenueMap: Record<string, number> = {}
  revenue2025.forEach(r => { revenueMap[r.marketplace] = r.net_revenue })

  // Build margin lookup
  const marginLookup: Record<string, Set<string>> = {}
  margins.forEach((m: any) => {
    if (!marginLookup[m.product_name]) marginLookup[m.product_name] = new Set()
    marginLookup[m.product_name].add(m.channel)
  })

  const activeProducts = products.filter((p: any) => p.status === 'Selling')
  const deRevenue = revenueMap['AMZ DE'] || 1
  const revenuePerIndex = deRevenue / MARKET_SIZE_INDEX['AMZ DE']

  // Only consider marketplace channels (exclude AMZ EU consolidated, WEBSHOP)
  const marketplaceNames = channels
    .filter((c: any) => c.channel_name !== 'AMZ EU' && c.channel_name !== 'WEBSHOP')
    .map((c: any) => c.channel_name)

  const opportunities: Opportunity[] = []

  activeProducts.forEach((product: any) => {
    const productChannels = marginLookup[product.sku] || new Set()
    const activeChannels = Array.from(productChannels)

    marketplaceNames.forEach((channelName: string) => {
      const hasMargin = productChannels.has(channelName)
      const channelRevenue = revenueMap[channelName] || 0
      const sizeIndex = MARKET_SIZE_INDEX[channelName]

      if (!hasMargin && channelRevenue > 0 && sizeIndex !== undefined) {
        // Product not listed in this channel — opportunity!
        const estimatedRevenue = (revenuePerIndex * sizeIndex) / activeProducts.length
        const priority =
          sizeIndex >= 0.5 ? 'High' : sizeIndex >= 0.15 ? 'Medium' : 'Low'

        opportunities.push({
          product: product.sku.replace('Puzzlup ', '').replace('Qualico ', 'Q: '),
          channel: channelName,
          type: 'Launch',
          estimatedRevenue,
          reason: `Product active in ${activeChannels.length} channels but not ${channelName} (mkt index: ${sizeIndex})`,
          priority,
        })
      } else if (hasMargin && channelRevenue > 0 && channelRevenue < 5000 && sizeIndex !== undefined && sizeIndex >= 0.3) {
        // Listed but low revenue in a decent-sized market
        const estimatedRevenue = (revenuePerIndex * sizeIndex) / activeProducts.length - (channelRevenue / activeProducts.length)
        if (estimatedRevenue > 1000) {
          opportunities.push({
            product: product.sku.replace('Puzzlup ', '').replace('Qualico ', 'Q: '),
            channel: channelName,
            type: 'Expansion',
            estimatedRevenue,
            reason: `Listed but low revenue in ${channelName} (${new Intl.NumberFormat('de-DE', {style:'currency',currency:'EUR',maximumFractionDigits:0}).format(channelRevenue)} total channel revenue vs ${sizeIndex} index)`,
            priority: 'Medium',
          })
        }
      }
    })
  })

  // Sort by estimated revenue descending
  opportunities.sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)

  // Take top 25
  const topOpps = opportunities.slice(0, 25)

  const fmt = (n: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

  const priorityStyles = {
    High: 'bg-red-500/15 text-red-400 border-red-500/30',
    Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    Low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  }

  const typeStyles = {
    Launch: 'bg-blue-500/15 text-blue-400',
    Expansion: 'bg-green-500/15 text-green-400',
  }

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">
          <span className="text-[#00D4AA]">Growth Opportunities</span>
          <span className="ml-2 text-sm font-normal text-[#8B949E]">
            ({opportunities.length} total, showing top {topOpps.length})
          </span>
        </h2>
        <p className="text-xs text-[#8B949E] mt-1">
          Derived from cross-referencing active products, channel listings, and market size •
          Revenue estimates use{' '}
          <span className="text-yellow-400">estimated market size indices</span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#8B949E] text-xs uppercase tracking-wider">
              <th className="text-left p-3 font-medium">#</th>
              <th className="text-left p-3 font-medium">Product</th>
              <th className="text-left p-3 font-medium">Channel</th>
              <th className="text-center p-3 font-medium">Type</th>
              <th className="text-center p-3 font-medium">Priority</th>
              <th className="text-right p-3 font-medium">
                <div>Est. Revenue Impact</div>
                <div className="text-[10px] normal-case tracking-normal text-yellow-400/80">based on market indices</div>
              </th>
              <th className="text-left p-3 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {topOpps.map((opp, i) => (
              <tr
                key={`${opp.product}-${opp.channel}`}
                className="border-t border-[#21262D] hover:bg-[#21262D]/50 transition-colors"
              >
                <td className="p-3 text-[#6E7681] font-mono text-xs">{i + 1}</td>
                <td className="p-3 font-medium text-[#E6EDF3]">{opp.product}</td>
                <td className="p-3 text-[#E6EDF3]">{opp.channel}</td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeStyles[opp.type]}`}>
                    {opp.type === 'Launch' ? '🚀 Launch' : '📈 Expand'}
                  </span>
                </td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-0.5 rounded border text-xs font-medium ${priorityStyles[opp.priority]}`}>
                    {opp.priority}
                  </span>
                </td>
                <td className="p-3 text-right font-mono text-[#00D4AA] font-medium">
                  {fmt(opp.estimatedRevenue)}
                </td>
                <td className="p-3 text-xs text-[#8B949E] max-w-[300px]">{opp.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {opportunities.length > topOpps.length && (
        <div className="mt-4 text-center text-xs text-[#6E7681]">
          + {opportunities.length - topOpps.length} more opportunities not shown
        </div>
      )}
    </div>
  )
}
