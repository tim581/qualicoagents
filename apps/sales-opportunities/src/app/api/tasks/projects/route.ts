import { NextRequest, NextResponse } from 'next/server'
import { mapProject } from '@/lib/tasks/db'
import { createSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createSupabaseClient()

    const { data: maxRow } = await supabase
      .from('task_board_projects')
      .select('sort_order')
      .eq('department_id', body.department_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await supabase
      .from('task_board_projects')
      .insert({
        department_id: body.department_id,
        name: body.name,
        color: body.color ?? '#238636',
        sort_order: (maxRow?.sort_order ?? 0) + 1,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ project: mapProject(data) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Create failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
