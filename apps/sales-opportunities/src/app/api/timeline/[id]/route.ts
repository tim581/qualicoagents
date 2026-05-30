import { NextRequest, NextResponse } from 'next/server'
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
      .from('company_timeline_items')
      .select('*')
      .eq('id', params.id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: fetchError?.message || 'Not found' }, { status: 404 })
    }

    const startDate = body.start_date ?? existing.start_date
    const endDate = body.end_date ?? existing.end_date ?? startDate

    const { data, error } = await supabase
      .from('company_timeline_items')
      .update({
        project_id: body.project_id ?? existing.project_id,
        title: body.title ?? existing.title,
        description: body.description !== undefined ? body.description : existing.description,
        item_type: 'initiative',
        start_date: startDate,
        end_date: endDate,
        status: body.status ?? existing.status,
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ milestone: data })
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
    const { error } = await supabase
      .from('company_timeline_items')
      .delete()
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
