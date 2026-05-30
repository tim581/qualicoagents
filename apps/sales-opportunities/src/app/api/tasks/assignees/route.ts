import { NextRequest, NextResponse } from 'next/server'
import { mapAssignee } from '@/lib/tasks/db'
import { createSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createSupabaseClient()

    const { data: maxRow } = await supabase
      .from('task_board_assignees')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await supabase
      .from('task_board_assignees')
      .insert({
        name: body.name,
        sort_order: (maxRow?.sort_order ?? 0) + 1,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ assignee: mapAssignee(data) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Create failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
