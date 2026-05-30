import AppHeader from '@/components/AppHeader'
import CompanyTimeline from '@/components/CompanyTimeline'
import { TimelineMilestone, TimelineProject, normalizeMilestone } from '@/lib/timeline'
import { createSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function fetchTimeline() {
  const supabase = createSupabaseClient()

  const [projectsRes, milestonesRes] = await Promise.all([
    supabase
      .from('company_timeline_projects')
      .select('*')
      .order('sort_order'),
    supabase
      .from('company_timeline_items')
      .select('*')
      .order('sort_order'),
  ])

  if (projectsRes.error) throw new Error(`Supabase projects: ${projectsRes.error.message}`)
  if (milestonesRes.error) throw new Error(`Supabase milestones: ${milestonesRes.error.message}`)

  return {
    projects: (projectsRes.data || []) as TimelineProject[],
    milestones: (milestonesRes.data || []).map((row) => normalizeMilestone(row as Record<string, unknown>)),
  }
}

function ConnectionError({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[#0D1117]">
      <AppHeader
        title={
          <>
            <span className="text-[#00D4AA]">Qualico</span> Company Timeline
          </>
        }
        subtitle="Projects and milestones across the company"
      />
      <div className="max-w-[1600px] mx-auto px-6 py-12">
        <div className="rounded-lg border border-[#FF7B72]/40 bg-[#FF7B72]/10 p-6">
          <h2 className="text-lg font-semibold text-[#FF7B72] mb-2">Connection failed</h2>
          <p className="text-sm text-[#E6EDF3] mb-4">{message}</p>
          <p className="text-xs text-[#8B949E]">
            Fix: create <code className="text-[#E6EDF3]">.env.local</code> with your Supabase URL and anon key, then restart <code className="text-[#E6EDF3]">npm run dev</code>.
          </p>
        </div>
      </div>
    </main>
  )
}

export default async function CompanyTimelinePage() {
  let projects: TimelineProject[] = []
  let milestones: TimelineMilestone[] = []
  let error: string | null = null

  try {
    const data = await fetchTimeline()
    projects = data.projects
    milestones = data.milestones
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not connect to Supabase'
  }

  if (error) {
    return <ConnectionError message={error} />
  }

  return (
    <main className="min-h-screen bg-[#0D1117]">
      <AppHeader
        title={
          <>
            <span className="text-[#00D4AA]">Qualico</span> Company Timeline
          </>
        }
        subtitle="Each row is a project — each bar is a milestone"
      />

      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <CompanyTimeline initialProjects={projects} initialMilestones={milestones} />

        <div className="text-center py-8 mt-4 border-t border-[#30363D]">
          <p className="text-[#8B949E] text-xs">
            Click empty space to add a milestone • double-click to edit • drag edges to resize
          </p>
        </div>
      </div>
    </main>
  )
}
