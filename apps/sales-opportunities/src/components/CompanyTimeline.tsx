'use client'

import { useMemo, useRef, useState } from 'react'
import {
  TimelineMilestone,
  TimelineProject,
  TimelineProjectWithMilestones,
  TimelineZoom,
  TimelineStatus,
  groupMilestonesByProject,
  getTimelineBounds,
  buildColumns,
  buildMonthGrid,
  buildMonthOverviewColumns,
  getMonthRangeFromKey,
  getMonthKey,
  normalizeMilestone,
  parseDate,
  itemColor,
  positionOnTimeline,
  formatDate,
  STATUS_LABELS,
  STATUS_COLORS,
  TimelineCreateDefaults,
  dateFromTimelinePercent,
  percentFromClientX,
  addDays,
  toISODate,
} from '@/lib/timeline'
import TimelineItemForm from './TimelineItemForm'
import TimelineBar, { TimelineBarHint } from './TimelineBar'
import {
  TimelineMonthHeader,
  TimelineMonthDayRow,
  TimelineMonthGridBackground,
  ClickableMonthOverview,
  monthSidebarHeaderHeight,
  standardHeaderHeight,
  focusedMonthHeaderHeight,
} from './TimelineMonthGrid'

interface CompanyTimelineProps {
  initialProjects: TimelineProject[]
  initialMilestones: TimelineMilestone[]
}

const ZOOM_OPTIONS: { value: TimelineZoom; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

const ROW_HEIGHT = 44
const PROJECT_HEADER_HEIGHT = 36

export default function CompanyTimeline({
  initialProjects,
  initialMilestones,
}: CompanyTimelineProps) {
  const [projects, setProjects] = useState(initialProjects)
  const [milestones, setMilestones] = useState(initialMilestones)
  const [zoom, setZoom] = useState<TimelineZoom>('quarter')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<TimelineMilestone | null>(null)
  const [createDefaults, setCreateDefaults] = useState<TimelineCreateDefaults | null>(null)
  const [saving, setSaving] = useState(false)
  const [focusedMonthKey, setFocusedMonthKey] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const grouped = useMemo(
    () => groupMilestonesByProject(projects, milestones),
    [projects, milestones]
  )

  const bounds = useMemo(() => getTimelineBounds(milestones), [milestones])

  const displayBounds = useMemo(() => {
    if (focusedMonthKey) return getMonthRangeFromKey(focusedMonthKey)
    return bounds
  }, [focusedMonthKey, bounds])

  const monthOverviewColumns = useMemo(
    () => buildMonthOverviewColumns(bounds.start, bounds.end),
    [bounds.start, bounds.end]
  )

  const showMonthDetail = focusedMonthKey !== null || zoom === 'month'

  const monthGrid = useMemo(() => {
    if (!showMonthDetail) return null
    const range = focusedMonthKey ? getMonthRangeFromKey(focusedMonthKey) : bounds
    return buildMonthGrid(range.start, range.end)
  }, [showMonthDetail, focusedMonthKey, bounds])

  const headerHeight = showMonthDetail
    ? focusedMonthKey
      ? focusedMonthHeaderHeight()
      : monthSidebarHeaderHeight()
    : standardHeaderHeight()

  const chartWidth = monthGrid ? monthGrid.widthPx : undefined

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const todayLeft = positionOnTimeline(today, displayBounds.start, displayBounds.end)
  const showToday = today >= displayBounds.start && today <= displayBounds.end

  const selectedMilestone = milestones.find((m) => m.id === selectedId) || null
  const selectedProject = selectedMilestone
    ? projects.find((p) => p.id === selectedMilestone.project_id)
    : null

  function handleMonthClick(monthKey: string) {
    setFocusedMonthKey(monthKey)
  }

  function clearMonthFocus() {
    setFocusedMonthKey(null)
  }

  function handleZoomChange(next: TimelineZoom) {
    setZoom(next)
    setFocusedMonthKey(null)
  }

  async function refresh() {
    const res = await fetch('/api/timeline')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to load timeline')
    if (data.projects) setProjects(data.projects)
    if (data.milestones) {
      setMilestones(data.milestones.map((row: Record<string, unknown>) => normalizeMilestone(row)))
    }
  }

  function revealMilestone(milestone: TimelineMilestone) {
    setSelectedId(milestone.id)
    setFocusedMonthKey(getMonthKey(parseDate(milestone.start_date)))
    setZoom('month')
  }

  async function handleSave(payload: {
    id?: string
    project_id: string
    title: string
    description: string
    start_date: string
    end_date: string
    status: TimelineStatus
  }) {
    setSaving(true)
    try {
      const body = {
        project_id: payload.project_id,
        title: payload.title,
        description: payload.description || null,
        start_date: payload.start_date,
        end_date: payload.end_date || payload.start_date,
        status: payload.status,
      }

      if (payload.id) {
        const res = await fetch(`/api/timeline/${payload.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Update failed')
        await refresh()
        closeForm()
      } else {
        const projectMilestones = milestones.filter((m) => m.project_id === payload.project_id)
        const maxOrder = projectMilestones.reduce((m, i) => Math.max(m, i.sort_order), 0)
        const res = await fetch('/api/timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, sort_order: maxOrder + 1 }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Create failed')
        const created = data.milestone
          ? normalizeMilestone(data.milestone as Record<string, unknown>)
          : null
        await refresh()
        closeForm()
        if (created) revealMilestone(created)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this milestone?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/timeline/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      if (selectedId === id) setSelectedId(null)
      await refresh()
      closeForm()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  function closeForm() {
    setFormOpen(false)
    setEditingMilestone(null)
    setCreateDefaults(null)
  }

  function openCreate() {
    setEditingMilestone(null)
    setCreateDefaults(null)
    setFormOpen(true)
  }

  function openCreateAt(clientX: number, projectId: string) {
    if (!chartRef.current) return

    const chartRect = chartRef.current.getBoundingClientRect()
    const percent = percentFromClientX(clientX, chartRect)
    const startDate = dateFromTimelinePercent(percent, displayBounds.start, displayBounds.end)
    const endDate = addDays(startDate, 30)

    setEditingMilestone(null)
    setCreateDefaults({
      project_id: projectId,
      start_date: toISODate(startDate),
      end_date: toISODate(endDate),
    })
    setSelectedId(null)
    setFormOpen(true)
  }

  function openEdit(milestone: TimelineMilestone) {
    setEditingMilestone(milestone)
    setSelectedId(milestone.id)
    setFormOpen(true)
  }

  async function handleDatesChange(id: string, start_date: string, end_date: string) {
    const milestone = milestones.find((m) => m.id === id)
    if (!milestone) return

    const previous = { start_date: milestone.start_date, end_date: milestone.end_date }
    setMilestones((prev) =>
      prev.map((m) => (m.id === id ? { ...m, start_date, end_date } : m))
    )

    try {
      const res = await fetch(`/api/timeline/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date, end_date }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      if (data.milestone) {
        setMilestones((prev) => prev.map((m) => (m.id === id ? data.milestone : m)))
      }
    } catch (e) {
      setMilestones((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, start_date: previous.start_date, end_date: previous.end_date } : m
        )
      )
      alert(e instanceof Error ? e.message : 'Could not update dates')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {focusedMonthKey && monthGrid ? (
            <button
              type="button"
              onClick={clearMonthFocus}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-[#00D4AA] border border-[#00D4AA]/40 bg-[#00D4AA]/10 hover:bg-[#00D4AA]/15 transition-colors"
            >
              ← {monthGrid.months[0]?.label ?? 'All months'}
            </button>
          ) : null}
          <span className="text-xs text-[#8B949E] uppercase tracking-wide">Zoom</span>
          {ZOOM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleZoomChange(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                zoom === opt.value && !focusedMonthKey
                  ? 'bg-[#21262D] text-[#00D4AA] border border-[#00D4AA]/40'
                  : 'text-[#8B949E] hover:text-[#E6EDF3] border border-transparent'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 rounded-md bg-[#00D4AA] text-[#0D1117] text-sm font-semibold hover:bg-[#00D4AA]/90 transition-colors"
        >
          + Add milestone
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-[#8B949E]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2.5 bg-[#58A6FF] rounded-sm" />
          Milestone
        </span>
        <TimelineBarHint />
        <span className="text-[#484F58]">•</span>
        <span>Click empty space to add a milestone</span>
        {showMonthDetail ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-[#21262D]/80 border border-[#30363D]/40" />
            Weekend
          </span>
        ) : (
          <span className="text-[#484F58]">•</span>
        )}
        {!showMonthDetail ? (
          <span>Click a month to see its weeks</span>
        ) : null}
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[key as TimelineStatus] }}
            />
            {label}
          </span>
        ))}
      </div>

      <div className="bg-[#161B22] border border-[#30363D] rounded-lg overflow-hidden">
        <div className="flex">
          <div className="shrink-0 w-[280px] border-r border-[#30363D] bg-[#0D1117]">
            <div
              className="border-b border-[#30363D] px-4 flex items-end pb-2 text-xs font-semibold uppercase tracking-wide text-[#8B949E]"
              style={{ height: headerHeight }}
            >
              Projects
            </div>

            {grouped.map((project) => (
              <ProjectSidebar
                key={project.id}
                project={project}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onEdit={openEdit}
              />
            ))}
          </div>

          <div className="flex-1 overflow-x-auto">
            {showMonthDetail && monthGrid ? (
              <>
                <TimelineMonthHeader
                  grid={monthGrid}
                  onMonthClick={focusedMonthKey ? undefined : handleMonthClick}
                  focusedMonthKey={focusedMonthKey}
                />
                <TimelineMonthDayRow grid={monthGrid} />
              </>
            ) : (
              <ClickableMonthOverview
                columns={monthOverviewColumns}
                onMonthClick={handleMonthClick}
              />
            )}

            <div
              ref={chartRef}
              className="relative"
              style={{
                minWidth: chartWidth ?? 720,
                width: chartWidth,
              }}
            >
              {showMonthDetail && monthGrid ? (
                <TimelineMonthGridBackground grid={monthGrid} />
              ) : (
                <div className="absolute inset-0 flex pointer-events-none">
                  {monthOverviewColumns.map((col) => (
                    <div
                      key={'grid-' + (col.monthKey ?? col.start.toISOString())}
                      className="flex-1 min-w-[100px] border-r border-[#30363D]/40"
                    />
                  ))}
                </div>
              )}

              {showToday ? (
                <div
                  className="absolute top-0 bottom-0 w-px bg-[#FF7B72] z-20 pointer-events-none"
                  style={{ left: `${todayLeft}%` }}
                >
                  <div className="absolute -top-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FF7B72] text-white whitespace-nowrap">
                    Today
                  </div>
                </div>
              ) : null}

              {grouped.map((project) => (
                <ProjectChart
                  key={project.id}
                  project={project}
                  bounds={displayBounds}
                  chartRef={chartRef}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onEdit={openEdit}
                  onDatesChange={handleDatesChange}
                  onCreateAt={openCreateAt}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedMilestone && selectedProject && !formOpen ? (
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: selectedProject.color }}
                >
                  {selectedProject.name}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `${STATUS_COLORS[selectedMilestone.status]}22`,
                    color: STATUS_COLORS[selectedMilestone.status],
                  }}
                >
                  {STATUS_LABELS[selectedMilestone.status]}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white">{selectedMilestone.title}</h3>
              {selectedMilestone.description ? (
                <p className="text-sm text-[#8B949E] mt-2">{selectedMilestone.description}</p>
              ) : null}
              <p className="text-sm text-[#E6EDF3] mt-3 font-mono">
                {formatDate(selectedMilestone.start_date)}
                {selectedMilestone.end_date && selectedMilestone.end_date !== selectedMilestone.start_date
                  ? ` → ${formatDate(selectedMilestone.end_date)}`
                  : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openEdit(selectedMilestone)}
                className="px-3 py-1.5 rounded-md text-sm border border-[#30363D] text-[#E6EDF3] hover:border-[#00D4AA]/40"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="px-3 py-1.5 rounded-md text-sm text-[#8B949E] hover:text-[#E6EDF3]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {formOpen ? (
        <TimelineItemForm
          projects={projects}
          milestone={editingMilestone}
          defaults={createDefaults}
          saving={saving}
          onSave={handleSave}
          onDelete={editingMilestone ? () => handleDelete(editingMilestone.id) : undefined}
          onClose={closeForm}
        />
      ) : null}
    </div>
  )
}

function ProjectSidebar({
  project,
  selectedId,
  onSelect,
  onEdit,
}: {
  project: TimelineProjectWithMilestones
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (milestone: TimelineMilestone) => void
}) {
  return (
    <div>
      <div
        className="px-4 flex items-center gap-2 border-b border-[#30363D] bg-[#161B22]"
        style={{ height: PROJECT_HEADER_HEIGHT }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <span className="text-sm font-semibold text-[#E6EDF3] truncate">{project.name}</span>
        <span className="text-xs text-[#8B949E] ml-auto">{project.milestones.length}</span>
      </div>

      {project.milestones.length === 0 ? (
        <div
          className="px-4 flex items-center text-xs text-[#484F58] border-b border-[#30363D]/60 italic"
          style={{ height: ROW_HEIGHT }}
        >
          No milestones yet
        </div>
      ) : (
        project.milestones.map((milestone) => (
          <button
            key={milestone.id}
            type="button"
            onClick={() => onSelect(milestone.id)}
            onDoubleClick={() => onEdit(milestone)}
            className={`w-full px-4 flex items-center gap-2 text-left border-b border-[#30363D]/60 transition-colors ${
              selectedId === milestone.id
                ? 'bg-[#00D4AA]/10'
                : 'hover:bg-[#21262D]'
            }`}
            style={{ height: ROW_HEIGHT }}
          >
            <span
              className="w-4 h-2 shrink-0 rounded-sm"
              style={{ backgroundColor: itemColor(milestone, project.color) }}
            />
            <span className="text-sm text-[#E6EDF3] truncate">{milestone.title}</span>
          </button>
        ))
      )}
    </div>
  )
}

function ProjectChart({
  project,
  bounds,
  chartRef,
  selectedId,
  onSelect,
  onEdit,
  onDatesChange,
  onCreateAt,
}: {
  project: TimelineProjectWithMilestones
  bounds: { start: Date; end: Date }
  chartRef: React.RefObject<HTMLDivElement>
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (milestone: TimelineMilestone) => void
  onDatesChange: (id: string, start_date: string, end_date: string) => void
  onCreateAt: (clientX: number, projectId: string) => void
}) {
  function handleEmptyClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-timeline-item]')) return
    onCreateAt(e.clientX, project.id)
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        title={`Add milestone to ${project.name}`}
        onClick={handleEmptyClick}
        className="border-b border-[#30363D] bg-[#161B22]/50 cursor-cell hover:bg-[#21262D]/60 transition-colors"
        style={{ height: PROJECT_HEADER_HEIGHT }}
      />

      {project.milestones.length === 0 ? (
        <div
          role="button"
          tabIndex={0}
          title={`Add milestone to ${project.name}`}
          onClick={handleEmptyClick}
          className="border-b border-[#30363D]/60 cursor-cell hover:bg-[#00D4AA]/5 transition-colors"
          style={{ height: ROW_HEIGHT }}
        />
      ) : (
        project.milestones.map((milestone) => (
          <div
            key={milestone.id}
            role="button"
            tabIndex={0}
            title="Click empty space to add a milestone"
            onClick={handleEmptyClick}
            className="relative border-b border-[#30363D]/60 cursor-cell hover:bg-[#00D4AA]/5 transition-colors"
            style={{ height: ROW_HEIGHT }}
          >
            <TimelineBar
              milestone={milestone}
              projectColor={project.color}
              bounds={bounds}
              chartRef={chartRef}
              isSelected={selectedId === milestone.id}
              onSelect={onSelect}
              onEdit={onEdit}
              onDatesChange={onDatesChange}
            />
          </div>
        ))
      )}
    </div>
  )
}
