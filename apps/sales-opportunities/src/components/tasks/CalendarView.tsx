'use client'

import { Assignee, CalendarZoom, Project, Task, PRIORITY_COLORS } from '@/lib/tasks/types'

interface CalendarViewProps {
  tasks: Task[]
  zoom: CalendarZoom
  anchor: Date
  onAnchorChange: (d: Date) => void
  assignees: Assignee[]
  projects: Project[]
  onUpdate: (task: Task) => void
}

function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}

function fmtKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isSameDay(a: Date, b: Date): boolean {
  return fmtKey(a) === fmtKey(b)
}

function CalendarTaskPill({
  task,
  projects,
  compact,
}: {
  task: Task
  projects: Project[]
  compact?: boolean
}) {
  const project = projects.find((p) => p.id === task.projectId)
  return (
    <div
      className={`rounded px-1.5 py-1 text-left border-l-2 ${
        compact ? 'text-[10px]' : 'text-xs'
      }`}
      style={{
        backgroundColor: `${PRIORITY_COLORS[task.urgency]}15`,
        borderLeftColor: project?.color ?? PRIORITY_COLORS[task.urgency],
      }}
    >
      <p className="font-medium text-[#E6EDF3] truncate">{task.title}</p>
      {!compact && (
        <p className="text-[10px] text-[#8B949E] mt-0.5">{project?.name}</p>
      )}
    </div>
  )
}

export function CalendarView({
  tasks,
  zoom,
  anchor,
  onAnchorChange,
  projects,
}: CalendarViewProps) {
  const weekStart = startOfWeek(anchor)
  const dayCount = zoom === 'week' ? 7 : 28
  const days = Array.from({ length: dayCount }, (_, i) => addDays(weekStart, i))

  const tasksByDay = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.dueDate) continue
    const key = task.dueDate
    if (!tasksByDay.has(key)) tasksByDay.set(key, [])
    tasksByDay.get(key)!.push(task)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const navigate = (delta: number) => {
    const next = new Date(anchor)
    next.setDate(next.getDate() + delta * (zoom === 'week' ? 7 : 28))
    onAnchorChange(next)
  }

  const rangeLabel =
    zoom === 'week'
      ? `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[27].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-2 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] text-sm"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => onAnchorChange(new Date())}
            className="px-3 py-1 rounded border border-[#30363D] text-xs text-[#8B949E] hover:text-[#E6EDF3]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            className="px-2 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] text-sm"
          >
            →
          </button>
        </div>
        <h3 className="text-sm font-semibold text-[#E6EDF3]">{rangeLabel}</h3>
        <span className="text-xs text-[#8B949E]">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''} with deadlines
        </span>
      </div>

      {zoom === 'week' ? (
        <div className="grid grid-cols-7 gap-2 flex-1 min-h-[420px]">
          {days.map((day, i) => {
            const key = fmtKey(day)
            const dayTasks = tasksByDay.get(key) ?? []
            const isToday = isSameDay(day, today)
            const isWeekend = i >= 5

            return (
              <div
                key={key}
                className={`flex flex-col rounded-lg border min-h-[400px] ${
                  isToday
                    ? 'border-[#00D4AA] bg-[#00D4AA]/5'
                    : isWeekend
                      ? 'border-[#30363D] bg-[#161B22]/30'
                      : 'border-[#30363D] bg-[#161B22]/50'
                }`}
              >
                <div className={`px-2 py-2 border-b border-[#30363D] text-center ${isToday ? 'bg-[#00D4AA]/10' : ''}`}>
                  <p className="text-[10px] uppercase text-[#8B949E] font-semibold">{weekdayLabels[i]}</p>
                  <p className={`text-lg font-bold ${isToday ? 'text-[#00D4AA]' : 'text-[#E6EDF3]'}`}>
                    {day.getDate()}
                  </p>
                </div>
                <div className="flex-1 p-2 space-y-1.5 overflow-y-auto">
                  {dayTasks.length === 0 ? (
                    <p className="text-[10px] text-[#484f58] text-center pt-4">—</p>
                  ) : (
                    dayTasks.map((task) => (
                      <CalendarTaskPill key={task.id} task={task} projects={projects} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col flex-1">
          <div className="grid grid-cols-7 gap-px mb-1">
            {weekdayLabels.map((label) => (
              <div key={label} className="text-center text-[10px] uppercase font-semibold text-[#8B949E] py-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 flex-1 auto-rows-fr">
            {days.map((day) => {
              const key = fmtKey(day)
              const dayTasks = tasksByDay.get(key) ?? []
              const isToday = isSameDay(day, today)

              return (
                <div
                  key={key}
                  className={`rounded border p-1.5 min-h-[90px] flex flex-col ${
                    isToday
                      ? 'border-[#00D4AA] bg-[#00D4AA]/5'
                      : 'border-[#30363D] bg-[#161B22]/40'
                  }`}
                >
                  <p className={`text-xs font-bold mb-1 ${isToday ? 'text-[#00D4AA]' : 'text-[#8B949E]'}`}>
                    {day.getDate()}
                  </p>
                  <div className="space-y-0.5 overflow-hidden flex-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <CalendarTaskPill key={task.id} task={task} projects={projects} compact />
                    ))}
                    {dayTasks.length > 3 && (
                      <p className="text-[10px] text-[#8B949E]">+{dayTasks.length - 3} more</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tasks.length === 0 && (
        <p className="text-center text-sm text-[#8B949E] mt-8">
          No tasks with deadlines in this department. Add a due date to a task to see it here.
        </p>
      )}
    </div>
  )
}
