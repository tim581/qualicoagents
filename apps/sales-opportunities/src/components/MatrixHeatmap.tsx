'use client'

interface Props {
  products: any[]
  channels: any[]
  revenue2025: { marketplace: string; net_revenue: number }[]
  margins: any[]
}

export default function MatrixHeatmap({ products, channels, revenue2025, margins }: Props) {
  // Filter to selling/active products only
  const activeProducts = products.filter(
    (p: any) => p.status === 'Selling' || p.status === 'Ready to Launch'
  )

  // Get marketplaces that have revenue
  const revenueMap: Record<string, number> = {}
  revenue2025.forEach(r => {
    revenueMap[r.marketplace] = r.net_revenue
  })

  // Use channels from the channels table that are marketplaces (not AMZ EU consolidated)
  const marketplaceChannels = channels
    .filter((c: any) => c.channel_name !== 'AMZ EU' && c.channel_name !== 'WEBSHOP')
    .sort((a: any, b: any) => {
      const revA = revenueMap[a.channel_name] || 0
      const revB = revenueMap[b.channel_name] || 0
      return revB - revA
    })

  // Build margin lookup: product_name → channel → exists
  const marginLookup: Record<string, Set<string>> = {}
  margins.forEach((m: any) => {
    if (!marginLookup[m.product_name]) marginLookup[m.product_name] = new Set()
    marginLookup[m.product_name].add(m.channel)
  })

  // Build per-product per-channel revenue from P&L (marketplace level, not product level)
  // We only know marketplace-level revenue, so we use that as a signal

  const getShortName = (sku: string) => {
    return sku
      .replace('Puzzlup ', '')
      .replace('Qualico ', 'Q: ')
  }

  const getCellStatus = (product: any, channelName: string) => {
    const productName = product.sku
      .replace('Puzzlup ', 'Puzzlup ')
      .replace('Qualico ', 'Qualico ')

    // Check if product has a margin entry for this channel
    const hasMargin = Object.keys(marginLookup).some(pName => {
      // Match product name from margins to SKU
      const skuNorm = product.sku.replace(product.brand + ' ', product.brand + ' ')
      const pNameNorm = pName
      return skuNorm === pNameNorm && marginLookup[pName]?.has(channelName)
    })

    // Try to match using the product name format in margins table
    const marginKey = product.sku
    const hasMarginDirect = marginLookup[marginKey]?.has(channelName) || false

    const marketplaceRevenue = revenueMap[channelName] || 0
    const channelExists = channels.some((c: any) => c.channel_name === channelName)

    if (product.status === 'discontinued') return 'discontinued'
    if (product.status === 'Ready to Launch') {
      if (hasMarginDirect) return 'ready'
      return 'not-applicable'
    }

    if (hasMarginDirect && marketplaceRevenue > 1000) return 'active'
    if (hasMarginDirect && marketplaceRevenue > 0 && marketplaceRevenue <= 1000) return 'low-revenue'
    if (hasMarginDirect) return 'listed'
    if (channelExists && product.status === 'Selling') return 'opportunity'
    return 'not-applicable'
  }

  const cellStyles: Record<string, { bg: string; border: string; label: string; emoji: string }> = {
    active: { bg: 'bg-green-500/20', border: 'border-green-500/40', label: 'Active & selling', emoji: '🟢' },
    'low-revenue': { bg: 'bg-yellow-500/20', border: 'border-yellow-500/40', label: 'Low revenue (<€1k)', emoji: '🟡' },
    listed: { bg: 'bg-cyan-500/15', border: 'border-cyan-500/30', label: 'Listed (no revenue data)', emoji: '🔷' },
    opportunity: { bg: 'bg-blue-500/20', border: 'border-blue-500/40', label: 'Expansion opportunity', emoji: '🔵' },
    ready: { bg: 'bg-purple-500/20', border: 'border-purple-500/40', label: 'Ready to launch', emoji: '🟣' },
    'not-applicable': { bg: 'bg-[#21262D]/50', border: 'border-[#30363D]/30', label: 'Not applicable', emoji: '⬛' },
    discontinued: { bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'Discontinued', emoji: '🔴' },
  }

  const fmt = (n: number) =>
    n >= 1000
      ? `€${(n / 1000).toFixed(0)}k`
      : `€${n.toFixed(0)}`

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">
            <span className="text-[#00D4AA]">Product × Channel</span> Matrix
          </h2>
          <p className="text-xs text-[#8B949E] mt-1">
            Cross-referencing margins table (listings) with P&amp;L revenue data
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(cellStyles).map(([key, style]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-sm">{style.emoji}</span>
              <span className="text-[#8B949E]">{style.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-[#8B949E] font-medium p-2 sticky left-0 bg-[#161B22] min-w-[200px]">
                Product
              </th>
              {marketplaceChannels.map((ch: any) => (
                <th
                  key={ch.channel_name}
                  className="text-center text-[#8B949E] font-medium p-2 min-w-[80px]"
                >
                  <div>{ch.channel_name}</div>
                  <div className="text-[10px] text-[#6E7681] font-normal">
                    {revenueMap[ch.channel_name] ? fmt(revenueMap[ch.channel_name]) : '—'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeProducts.map((product: any) => (
              <tr key={product.sku} className="border-t border-[#21262D]">
                <td className="p-2 sticky left-0 bg-[#161B22]">
                  <div className="text-[#E6EDF3] font-medium text-xs">
                    {getShortName(product.sku)}
                  </div>
                  <div className="text-[10px] text-[#6E7681]">
                    {product.product_type} • {product.size}pc
                    {product.status !== 'Selling' && (
                      <span className="ml-1 text-yellow-400">({product.status})</span>
                    )}
                  </div>
                </td>
                {marketplaceChannels.map((ch: any) => {
                  const status = getCellStatus(product, ch.channel_name)
                  const style = cellStyles[status]
                  return (
                    <td key={ch.channel_name} className="p-1 text-center">
                      <div
                        className={`matrix-cell ${style.bg} ${style.border} border rounded p-1.5 cursor-default`}
                        title={`${product.sku} × ${ch.channel_name}: ${style.label}`}
                      >
                        <span className="text-sm">{style.emoji}</span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
