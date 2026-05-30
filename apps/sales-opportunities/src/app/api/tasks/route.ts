import { NextRequest, NextResponse } from 'next/server'
import { fetchTaskStore, mapTask, taskToDb } from '@/lib/tasks/db'
import { createSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const store = await fetchTaskStore()
    return NextResponse.json(store)
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
      .from('task_board_items')
      .insert({
        ...taskToDb({
          departmentId: body.department_id,
          projectId: body.project_id,
          title: body.title,
        }),
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ task: mapTask(data) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Create failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
