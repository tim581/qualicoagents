'use client'

import {
  Assignee,
  Project,
  Task,
  TaskStatus,
  STATUS_COLORS,
  STATUS_LABELS,
  PRIORITY_COLORS,
} from '@/lib/tasks/types'
import { activeSubtasks } from '@/lib/tasks/storage'

interface KanbanViewProps {
  tasks: Task[]
  assignees: Assignee[]
  projects: Project[]
  onUpdate: (task: Task) => void
}

const COLUMNS: TaskStatus[] = ['to_start', 'in_progress', 'done']

function KanbanCard({
  task,
  assignees,
  projects,
  onUpdate,
}: {
  task: Task
  assignees: Assignee[]
  projects: Project[]
  onUpdate: (task: Task) => void
}) {
  const assignee = assignees.find((a) => a.id === task.assigneeId)
  const project = projects.find((p) => p.id === task.projectId)
  const openSubtasks = activeSubtasks(task.subtasks)

  const moveTo = (status: TaskStatus) => {
    onUpdate({ ...task, status, updatedAt: new Date().toISOString() })
  }

  return (
    <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-3 shadow-sm">
      <p className="text-sm font-medium text-[#E6EDF3] leading-snug">{task.title}</p>

      {project && (
        <span
          className="inline-block mt-2 text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${project.color}22`, color: project.color }}
        >
          {project.name}
        </span>
      )}

      <div className="flex flex-wrap gap-1 mt-2">
        <span
          className="text-[10px] px-1 py-0.5 rounded font-semibold uppercase"
          style={{ backgroundColor: `${PRIORITY_COLORS[task.urgency]}22`, color: PRIORITY_COLORS[task.urgency] }}
        >
          {task.urgency}
        </span>
        {assignee && <span className="text-[10px] text-[#8B949E]">{assignee.name}</span>}
      </div>

      {task.dueDate && (
        <p className="mt-2 text-[10px] font-semibold text-[#58A6FF]">
          Due {new Date(task.dueDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </p>
      )}

      {openSubtasks.length > 0 && (
        <p className="mt-2 text-[10px] text-[#8B949E]">
          {openSubtasks.length} subtask{openSubtasks.length !== 1 ? 's' : ''}
        </p>
      )}

      <div className="flex gap-1 mt-3 pt-2 border-t border-[#30363D]">
        {COLUMNS.filter((s) => s !== task.status).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => moveTo(s)}
            className="flex-1 text-[10px] py-1 rounded font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: `${STATUS_COLORS[s]}22`, color: STATUS_COLORS[s] }}
          >
            → {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

export function KanbanView({ tasks, assignees, projects, onUpdate }: KanbanViewProps) {
  const visibleTasks = tasks.filter((t) => t.status !== 'done')

  return (
    <div className="grid grid-cols-3 gap-4 h-full min-h-[400px]">
      {(['to_start', 'in_progress'] as TaskStatus[]).map((status) => {
        const columnTasks = visibleTasks.filter((t) => t.status === status)
        return (
          <div key={status} className="flex flex-col rounded-lg border border-[#30363D] bg-[#0D1117]/50">
            <div
              className="px-4 py-3 border-b border-[#30363D] flex items-center justify-between"
              style={{ borderTopColor: STATUS_COLORS[status], borderTopWidth: 3 }}
            >
              <h3 className="text-sm font-semibold" style={{ color: STATUS_COLORS[status] }}>
                {STATUS_LABELS[status]}
              </h3>
              <span className="text-xs text-[#8B949E]">{columnTasks.length}</span>
            </div>
            <div className="flex-1 p-3 space-y-3 overflow-y-auto">
              {columnTasks.length === 0 ? (
                <p className="text-xs text-[#8B949E] text-center py-8">No tasks</p>
              ) : (
                columnTasks.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    assignees={assignees}
                    projects={projects}
                    onUpdate={onUpdate}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}

      <div className="flex flex-col rounded-lg border border-[#30363D] bg-[#0D1117]/50 border-dashed">
        <div
          className="px-4 py-3 border-b border-[#30363D] flex items-center justify-between"
          style={{ borderTopColor: STATUS_COLORS.done, borderTopWidth: 3 }}
        >
          <h3 className="text-sm font-semibold text-[#00D4AA]">Done</h3>
          <span className="text-xs text-[#8B949E]">Move here to complete</span>
        </div>
        <div className="flex-1 p-3 space-y-3 overflow-y-auto">
          {visibleTasks
            .filter((t) => t.status === 'done')
            .map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                assignees={assignees}
                projects={projects}
                onUpdate={onUpdate}
              />
            ))}
          <p className="text-xs text-[#8B949E] text-center py-8">
            Completed tasks disappear from all views
          </p>
        </div>
      </div>
    </div>
  )
}
