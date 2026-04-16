# Puzzlup Sales Opportunities Dashboard

A Next.js 14 app that shows the Puzzlup Sales Opportunities matrix with **live data from Supabase**.

## Features

- **KPI Cards**: Total revenue, coverage %, active combos, addressable revenue
- **Product × Channel Matrix**: Heatmap showing status of every product in every marketplace
- **Market Sizing**: Revenue by marketplace with YoY growth, potential gap analysis
- **Growth Opportunities**: Ranked list of launch/expansion opportunities

## Data Sources

| Data | Source |
|------|--------|
| Products | `Puzzlup_Product_Info` table (Supabase) |
| Channels | `puzzlup_channels` table (Supabase) |
| Revenue | `P&L_Masterdata` table, line_item = 'Net Revenue' (Supabase) |
| Margins | `puzzlup_margins` table (Supabase) |
| Market Size Indices | Estimated from industry research (**clearly labeled**) |

## Setup

1. Clone this repo
2. `npm install`
3. Create `.env.local` with:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
   ```
4. `npm run dev`

## Deploy to Vercel

1. Push to GitHub
2. Connect to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy

## Visual Style

Dark theme (Qualico house style) with teal accent (#00D4AA).
