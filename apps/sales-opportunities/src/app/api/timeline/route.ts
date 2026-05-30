import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createSupabaseClient()
    const [projectsRes, milestonesRes] = await Promise.all([
      supabase.from('company_timeline_projects').select('*').order('sort_order'),
      supabase.from('company_timeline_items').select('*').order('sort_order'),
    ])

    if (projectsRes.error) {
      return NextResponse.json({ error: projectsRes.error.message }, { status: 500 })
    }
    if (milestonesRes.error) {
      return NextResponse.json({ error: milestonesRes.error.message }, { status: 500 })
    }

    return NextResponse.json({
      projects: projectsRes.data ?? [],
      milestones: milestonesRes.data ?? [],
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Connection failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createSupabaseClient()

    const { data, error } = await supabase
      .from('company_timeline_items')
      .insert({
        project_id: body.project_id,
        title: body.title,
        description: body.description || null,
        item_type: 'initiative',
        start_date: body.start_date,
        end_date: body.end_date || body.start_date,
        status: body.status,
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ milestone: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Save failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
