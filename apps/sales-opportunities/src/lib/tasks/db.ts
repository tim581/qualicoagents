import {
  Assignee,
  Department,
  Priority,
  Project,
  Subtask,
  Task,
  TaskStatus,
  TaskStore,
} from './types'

export interface DbDepartment {
  id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface DbProject {
  id: string
  department_id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface DbAssignee {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export interface DbTask {
  id: string
  department_id: string
  project_id: string
  title: string
  description: string
  status: TaskStatus
  importance: Priority
  urgency: Priority
  assignee_id: string | null
  due_date: string | null
  subtasks: Subtask[]
  sort_order: number
  created_at: string
  updated_at: string
}

export function mapDepartment(row: DbDepartment): Department {
  return { id: row.id, name: row.name, color: row.color }
}

export function mapProject(row: DbProject): Project {
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    color: row.color,
  }
}

export function mapAssignee(row: DbAssignee): Assignee {
  return { id: row.id, name: row.name }
}

export function mapTask(row: DbTask): Task {
  return {
    id: row.id,
    departmentId: row.department_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description ?? '',
    status: row.status,
    importance: row.importance,
    urgency: row.urgency,
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapStore(
  departments: DbDepartment[],
  projects: DbProject[],
  assignees: DbAssignee[],
  tasks: DbTask[]
): TaskStore {
  return {
    departments: departments.map(mapDepartment),
    projects: projects.map(mapProject),
    assignees: assignees.map(mapAssignee),
    tasks: tasks.map(mapTask),
  }
}

export function taskToDb(task: Partial<Task> & { departmentId: string; projectId: string; title: string }) {
  return {
    department_id: task.departmentId,
    project_id: task.projectId,
    title: task.title,
    description: task.description ?? '',
    status: task.status ?? 'to_start',
    importance: task.importance ?? 'medium',
    urgency: task.urgency ?? 'medium',
    assignee_id: task.assigneeId ?? null,
    due_date: task.dueDate ?? null,
    subtasks: task.subtasks ?? [],
  }
}

export async function fetchTaskStore(): Promise<TaskStore> {
  const { createSupabaseClient } = await import('@/lib/supabase')
  const supabase = createSupabaseClient()

  const [departmentsRes, projectsRes, assigneesRes, tasksRes] = await Promise.all([
    supabase.from('task_board_departments').select('*').order('sort_order'),
    supabase.from('task_board_projects').select('*').order('sort_order'),
    supabase.from('task_board_assignees').select('*').order('sort_order'),
    supabase.from('task_board_items').select('*').order('sort_order'),
  ])

  if (departmentsRes.error) throw new Error(`Departments: ${departmentsRes.error.message}`)
  if (projectsRes.error) throw new Error(`Projects: ${projectsRes.error.message}`)
  if (assigneesRes.error) throw new Error(`Assignees: ${assigneesRes.error.message}`)
  if (tasksRes.error) throw new Error(`Tasks: ${tasksRes.error.message}`)

  return mapStore(
    (departmentsRes.data ?? []) as DbDepartment[],
    (projectsRes.data ?? []) as DbProject[],
    (assigneesRes.data ?? []) as DbAssignee[],
    (tasksRes.data ?? []) as DbTask[]
  )
}
