import { NextRequest, NextResponse } from 'next/server'
import { mapTask } from '@/lib/tasks/db'
import { createSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const supabase = createSupabaseClient()

    const { data: existing, error: fetchError } = await supabase
      .from('task_board_items')
      .select('*')
      .eq('id', params.id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: fetchError?.message || 'Not found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('task_board_items')
      .update({
        department_id: body.department_id ?? existing.department_id,
        project_id: body.project_id ?? existing.project_id,
        title: body.title ?? existing.title,
        description: body.description !== undefined ? body.description : existing.description,
        status: body.status ?? existing.status,
        importance: body.importance ?? existing.importance,
        urgency: body.urgency ?? existing.urgency,
        assignee_id: body.assignee_id !== undefined ? body.assignee_id : existing.assignee_id,
        due_date: body.due_date !== undefined ? body.due_date : existing.due_date,
        subtasks: body.subtasks !== undefined ? body.subtasks : existing.subtasks,
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ task: mapTask(data) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseClient()
    const { error } = await supabase.from('task_board_items').delete().eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
