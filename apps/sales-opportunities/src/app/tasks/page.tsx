import AppHeader from '@/components/AppHeader'
import TaskApp from '@/components/tasks/TaskApp'
import { fetchTaskStore } from '@/lib/tasks/db'
import { TaskStore } from '@/lib/tasks/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function ConnectionError({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[#0D1117]">
      <AppHeader
        title={
          <>
            <span className="text-[#00D4AA]">Qualico</span> Tasks
          </>
        }
        subtitle="Departments, projects, subtasks, kanban & calendar"
      />
      <div className="max-w-[1600px] mx-auto px-6 py-12">
        <div className="rounded-lg border border-[#FF7B72]/40 bg-[#FF7B72]/10 p-6">
          <h2 className="text-lg font-semibold text-[#FF7B72] mb-2">Connection failed</h2>
          <p className="text-sm text-[#E6EDF3] mb-4">{message}</p>
          <p className="text-xs text-[#8B949E]">
            Ensure the task board migration is applied in Supabase and{' '}
            <code className="text-[#E6EDF3]">.env.local</code> has valid Supabase credentials.
          </p>
        </div>
      </div>
    </main>
  )
}

export default async function TasksPage() {
  let initialStore: TaskStore | null = null
  let error: string | null = null

  try {
    initialStore = await fetchTaskStore()
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not connect to Supabase'
  }

  if (error || !initialStore) {
    return <ConnectionError message={error ?? 'Unknown error'} />
  }

  return (
    <main className="min-h-screen bg-[#0D1117]">
      <AppHeader
        title={
          <>
            <span className="text-[#00D4AA]">Qualico</span> Tasks
          </>
        }
        subtitle="Departments, projects, subtasks, kanban & calendar — synced via Supabase"
      />

      <div className="max-w-[1600px] mx-auto px-6 py-4">
        <TaskApp initialStore={initialStore} />
      </div>
    </main>
  )
}
