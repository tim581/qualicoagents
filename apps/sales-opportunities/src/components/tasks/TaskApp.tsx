'use client'

import { useCallback, useState } from 'react'
import {
  Assignee,
  CalendarZoom,
  Priority,
  Project,
  Task,
  TaskStatus,
  TaskStore,
  ViewMode,
  DEPT_COLORS,
  PROJECT_COLORS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
} from '@/lib/tasks/types'
import {
  activeSubtasks,
  countOpenTasks,
  createId,
  nextColor,
  tasksForScope,
  tasksWithDueDate,
} from '@/lib/tasks/storage'
import * as taskApi from '@/lib/tasks/api'
import { KanbanView } from './KanbanView'
import { CalendarView } from './CalendarView'

function PlusIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function InlineAdd({
  placeholder,
  onAdd,
  buttonLabel = 'Add',
}: {
  placeholder: string
  onAdd: (name: string) => void
  buttonLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-[#8B949E] hover:text-[#00D4AA] transition-colors"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        {buttonLabel}
      </button>
    )
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = value.trim()
        if (!trimmed) return
        onAdd(trimmed)
        setValue('')
        setOpen(false)
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-[#30363D] bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:border-[#00D4AA]"
      />
      <button type="submit" className="px-2 py-1 text-xs rounded bg-[#00D4AA] text-[#0D1117] font-medium">
        Save
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setValue('') }}
        className="px-2 py-1 text-xs text-[#8B949E]"
      >
        Cancel
      </button>
    </form>
  )
}

function PriorityBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
    </span>
  )
}

function TaskCard({
  task,
  assignees,
  projects,
  onUpdate,
  onDelete,
}: {
  task: Task
  assignees: Assignee[]
  projects: Project[]
  onUpdate: (task: Task) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const project = projects.find((p) => p.id === task.projectId)
  const assignee = assignees.find((a) => a.id === task.assigneeId)
  const openSubtasks = activeSubtasks(task.subtasks)

  const patch = (partial: Partial<Task>) => {
    onUpdate({ ...task, ...partial, updatedAt: new Date().toISOString() })
  }

  const toggleSubtask = (subId: string) => {
    const subtasks = task.subtasks.map((s) =>
      s.id === subId ? { ...s, completed: !s.completed } : s
    )
    patch({ subtasks })
  }

  const addSubtask = () => {
    const title = newSubtask.trim()
    if (!title) return
    patch({
      subtasks: [...task.subtasks, { id: createId(), title, completed: false }],
    })
    setNewSubtask('')
  }

  const dueSoon =
    task.dueDate &&
    new Date(task.dueDate) <= new Date(Date.now() + 2 * 86400000)

  return (
    <div className="rounded-lg border border-[#30363D] bg-[#161B22] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <select
            value={task.status}
            onChange={(e) => patch({ status: e.target.value as TaskStatus })}
            className="mt-0.5 shrink-0 text-xs font-medium rounded px-2 py-1 border-0 cursor-pointer"
            style={{
              backgroundColor: `${STATUS_COLORS[task.status]}22`,
              color: STATUS_COLORS[task.status],
            }}
          >
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
              <option key={s} value={s} className="bg-[#161B22]">
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-left w-full"
            >
              <h3 className="font-semibold text-[#E6EDF3] leading-snug">{task.title}</h3>
            </button>

            <div className="flex flex-wrap items-center gap-2 mt-2">
              {project && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${project.color}22`, color: project.color }}
                >
                  {project.name}
                </span>
              )}
              <PriorityBadge label={`Imp: ${PRIORITY_LABELS[task.importance]}`} color={PRIORITY_COLORS[task.importance]} />
              <PriorityBadge label={`Urg: ${PRIORITY_LABELS[task.urgency]}`} color={PRIORITY_COLORS[task.urgency]} />
              {assignee && (
                <span className="text-xs text-[#8B949E]">{assignee.name}</span>
              )}
            </div>

            {task.dueDate && (
              <div
                className={`mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${
                  dueSoon
                    ? 'bg-[#FF7B72]/15 text-[#FF7B72] border border-[#FF7B72]/40'
                    : 'bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/30'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Due {new Date(task.dueDate + 'T12:00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[#8B949E] hover:text-[#E6EDF3] text-xs shrink-0"
          >
            {expanded ? 'Less' : 'Edit'}
          </button>
        </div>

        {openSubtasks.length > 0 && (
          <ul className="mt-3 space-y-1.5 pl-1">
            {openSubtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 group">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleSubtask(s.id)}
                  className="w-4 h-4 rounded border-[#30363D] bg-[#0D1117] accent-[#00D4AA] cursor-pointer"
                />
                <span className="text-sm text-[#C9D1D9]">{s.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[#30363D] bg-[#0D1117] p-4 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">Title</label>
            <input
              value={task.title}
              onChange={(e) => patch({ title: e.target.value })}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3] focus:outline-none focus:border-[#00D4AA]"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">Description</label>
            <textarea
              value={task.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              className="mt-1 w-full px-3 py-2 text-sm rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3] focus:outline-none focus:border-[#00D4AA] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">Importance</label>
              <select
                value={task.importance}
                onChange={(e) => patch({ importance: e.target.value as Priority })}
                className="mt-1 w-full px-2 py-2 text-sm rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3]"
              >
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">Urgency</label>
              <select
                value={task.urgency}
                onChange={(e) => patch({ urgency: e.target.value as Priority })}
                className="mt-1 w-full px-2 py-2 text-sm rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3]"
              >
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">Responsible</label>
              <select
                value={task.assigneeId ?? ''}
                onChange={(e) => patch({ assigneeId: e.target.value || null })}
                className="mt-1 w-full px-2 py-2 text-sm rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3]"
              >
                <option value="">— None —</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">Due date</label>
              <input
                type="date"
                value={task.dueDate ?? ''}
                onChange={(e) => patch({ dueDate: e.target.value || null })}
                className="mt-1 w-full px-2 py-2 text-sm rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3] [color-scheme:dark]"
              />
              {task.dueDate && (
                <button
                  type="button"
                  onClick={() => patch({ dueDate: null })}
                  className="mt-1 text-[10px] text-[#8B949E] hover:text-[#FF7B72]"
                >
                  Clear deadline
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">Subtasks</label>
            <div className="mt-2 space-y-1.5">
              {openSubtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    onChange={() => toggleSubtask(s.id)}
                    className="w-4 h-4 rounded accent-[#00D4AA] cursor-pointer"
                  />
                  <span className="text-sm text-[#C9D1D9] flex-1">{s.title}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSubtask())}
                placeholder="Add subtask…"
                className="flex-1 px-2 py-1.5 text-sm rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3]"
              />
              <button
                type="button"
                onClick={addSubtask}
                className="px-3 py-1.5 text-xs rounded bg-[#21262D] text-[#E6EDF3] hover:bg-[#30363D]"
              >
                Add
              </button>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => patch({ status: 'done' })}
              className="text-xs text-[#00D4AA] hover:underline"
            >
              Mark complete
            </button>
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="text-xs text-[#FF7B72] hover:underline"
            >
              Delete task
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TaskApp({ initialStore }: { initialStore: TaskStore }) {
  const [store, setStore] = useState<TaskStore>(initialStore)
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [calendarZoom, setCalendarZoom] = useState<CalendarZoom>('week')
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date())
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [addingAssignee, setAddingAssignee] = useState(false)
  const [newAssigneeName, setNewAssigneeName] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    const data = await taskApi.fetchTasks()
    setStore(data)
  }, [])

  const handleError = (e: unknown, fallback: string) => {
    alert(e instanceof Error ? e.message : fallback)
  }

  if (!store) {
    return (
      <div className="flex items-center justify-center py-24 text-[#8B949E] text-sm">
        Loading tasks…
      </div>
    )
  }

  const departments = store.departments
  const activeDeptId = selectedDeptId ?? departments[0]?.id ?? null
  const deptProjects = store.projects.filter((p) => p.departmentId === activeDeptId)
  const activeProjectId = selectedProjectId && deptProjects.some((p) => p.id === selectedProjectId)
    ? selectedProjectId
    : null

  const scopedTasks = tasksForScope(store.tasks, activeDeptId, activeProjectId)
  const calendarTasks = tasksWithDueDate(store.tasks, activeDeptId)

  const addDepartment = async (name: string) => {
    setSaving(true)
    try {
      const color = nextColor(DEPT_COLORS, store.departments.map((d) => d.color))
      const dept = await taskApi.createDepartment(name, color)
      await refresh()
      setSelectedDeptId(dept.id)
    } catch (e) {
      handleError(e, 'Failed to add department')
    } finally {
      setSaving(false)
    }
  }

  const addProject = async (name: string) => {
    if (!activeDeptId) return
    setSaving(true)
    try {
      const color = nextColor(PROJECT_COLORS, deptProjects.map((p) => p.color))
      const project = await taskApi.createProject(activeDeptId, name, color)
      await refresh()
      setSelectedProjectId(project.id)
    } catch (e) {
      handleError(e, 'Failed to add project')
    } finally {
      setSaving(false)
    }
  }

  const addAssignee = async (name: string) => {
    setSaving(true)
    try {
      await taskApi.createAssignee(name)
      await refresh()
    } catch (e) {
      handleError(e, 'Failed to add person')
    } finally {
      setSaving(false)
    }
  }

  const addTask = async () => {
    const title = newTaskTitle.trim()
    if (!title || !activeDeptId) return
    const projectId = activeProjectId ?? deptProjects[0]?.id
    if (!projectId) return

    setSaving(true)
    try {
      await taskApi.createTask({
        department_id: activeDeptId,
        project_id: projectId,
        title,
      })
      await refresh()
      setNewTaskTitle('')
      setAddingTask(false)
    } catch (e) {
      handleError(e, 'Failed to add task')
    } finally {
      setSaving(false)
    }
  }

  const updateTask = async (task: Task) => {
    setStore((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === task.id ? task : t)),
    }))
    try {
      await taskApi.updateTask(task.id, task)
      await refresh()
    } catch (e) {
      handleError(e, 'Failed to update task')
      await refresh()
    }
  }

  const deleteTask = async (id: string) => {
    setSaving(true)
    try {
      await taskApi.deleteTask(id)
      await refresh()
    } catch (e) {
      handleError(e, 'Failed to delete task')
    } finally {
      setSaving(false)
    }
  }

  const viewTabs: { id: ViewMode; label: string }[] = [
    { id: 'list', label: 'List' },
    { id: 'kanban', label: 'Kanban' },
    { id: 'calendar', label: 'Calendar' },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] min-h-[600px]">
      {/* Department bar — horizontal top */}
      <div className="shrink-0 border-b border-[#30363D] bg-[#161B22] px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold mr-2 shrink-0">
            Departments
          </span>
          {departments.map((d) => {
            const active = d.id === activeDeptId
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setSelectedDeptId(d.id)
                  setSelectedProjectId(null)
                }}
                className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                  active
                    ? 'border-transparent text-[#0D1117]'
                    : 'border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:border-[#484f58] bg-[#0D1117]'
                }`}
                style={active ? { backgroundColor: d.color } : undefined}
              >
                {d.name}
              </button>
            )
          })}
          <div className="shrink-0 pl-2 border-l border-[#30363D] ml-1">
            <InlineAdd placeholder="Department name" onAdd={addDepartment} buttonLabel="Dept" />
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Project sidebar — left pane */}
        <aside className="w-56 shrink-0 border-r border-[#30363D] bg-[#0D1117] flex flex-col">
          <div className="p-3 border-b border-[#30363D]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold">
                Projects
              </span>
            </div>
            <InlineAdd placeholder="Project name" onAdd={addProject} buttonLabel="Project" />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                !activeProjectId
                  ? 'bg-[#00D4AA]/15 text-[#00D4AA] font-medium'
                  : 'text-[#8B949E] hover:bg-[#21262D] hover:text-[#E6EDF3]'
              }`}
            >
              All projects
              <span className="float-right text-xs opacity-70">
                {tasksForScope(store.tasks, activeDeptId, null).length}
              </span>
            </button>

            {deptProjects.map((p) => {
              const active = p.id === activeProjectId
              const count = countOpenTasks(store.tasks, p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                    active
                      ? 'bg-[#21262D] text-[#E6EDF3] font-medium'
                      : 'text-[#8B949E] hover:bg-[#21262D] hover:text-[#E6EDF3]'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-xs opacity-60">{count}</span>
                </button>
              )
            })}

            {deptProjects.length === 0 && (
              <p className="px-3 py-4 text-xs text-[#8B949E]">Add a project to get started</p>
            )}
          </div>

          {/* Assignees */}
          <div className="p-3 border-t border-[#30363D]">
            <span className="text-[10px] uppercase tracking-wider text-[#8B949E] font-semibold block mb-2">
              Team
            </span>
            <ul className="space-y-1 mb-2">
              {store.assignees.map((a) => (
                <li key={a.id} className="text-xs text-[#C9D1D9] px-2 py-1 rounded bg-[#161B22]">
                  {a.name}
                </li>
              ))}
            </ul>
            {addingAssignee ? (
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = newAssigneeName.trim()
                  if (!name) return
                  addAssignee(name)
                  setNewAssigneeName('')
                  setAddingAssignee(false)
                }}
              >
                <input
                  autoFocus
                  value={newAssigneeName}
                  onChange={(e) => setNewAssigneeName(e.target.value)}
                  placeholder="Name"
                  className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-[#30363D] bg-[#161B22] text-[#E6EDF3]"
                />
                <button type="submit" className="text-xs text-[#00D4AA]">Add</button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAddingAssignee(true)}
                className="flex items-center gap-1 text-xs text-[#8B949E] hover:text-[#00D4AA]"
              >
                <PlusIcon className="w-3 h-3" /> Add person
              </button>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* View toolbar */}
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#30363D] bg-[#161B22]/50">
            <div className="flex items-center gap-1">
              {viewTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewMode(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === tab.id
                      ? 'bg-[#00D4AA]/15 text-[#00D4AA]'
                      : 'text-[#8B949E] hover:text-[#E6EDF3]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {viewMode === 'calendar' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCalendarZoom(calendarZoom === 'week' ? 'month' : 'week')
                  }
                  className="text-xs px-2 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3]"
                >
                  {calendarZoom === 'week' ? 'Zoom out (4 weeks)' : 'Zoom in (week)'}
                </button>
              </div>
            )}

            {viewMode !== 'calendar' && (
              <button
                type="button"
                onClick={() => setAddingTask(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[#00D4AA] text-[#0D1117] hover:bg-[#00D4AA]/90"
              >
                <PlusIcon className="w-4 h-4" />
                New task
              </button>
            )}
          </div>

          {/* Views */}
          <div className="flex-1 overflow-auto p-4">
            {addingTask && viewMode === 'list' && (
              <form
                className="mb-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  addTask()
                }}
              >
                <input
                  autoFocus
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Task title…"
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-[#30363D] bg-[#161B22] text-[#E6EDF3] focus:outline-none focus:border-[#00D4AA]"
                />
                <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-[#00D4AA] text-[#0D1117] font-medium">
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => { setAddingTask(false); setNewTaskTitle('') }}
                  className="px-3 py-2 text-sm text-[#8B949E]"
                >
                  Cancel
                </button>
              </form>
            )}

            {viewMode === 'list' && (
              <div className="space-y-3 max-w-3xl">
                {scopedTasks.length === 0 ? (
                  <div className="text-center py-16 text-[#8B949E]">
                    <p className="text-sm">No open tasks</p>
                    <p className="text-xs mt-1">Completed tasks disappear automatically</p>
                  </div>
                ) : (
                  scopedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      assignees={store.assignees}
                      projects={store.projects}
                      onUpdate={updateTask}
                      onDelete={deleteTask}
                    />
                  ))
                )}
              </div>
            )}

            {viewMode === 'kanban' && (
              <KanbanView
                tasks={scopedTasks}
                assignees={store.assignees}
                projects={store.projects}
                onUpdate={updateTask}
              />
            )}

            {viewMode === 'calendar' && (
              <CalendarView
                tasks={calendarTasks}
                zoom={calendarZoom}
                anchor={calendarAnchor}
                onAnchorChange={setCalendarAnchor}
                assignees={store.assignees}
                projects={store.projects}
                onUpdate={updateTask}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
