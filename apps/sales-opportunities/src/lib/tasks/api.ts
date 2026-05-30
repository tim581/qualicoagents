import { Task, TaskStore } from './types'

async function parseJson<T>(res: Response): Promise<T & { error?: string }> {
  return res.json() as Promise<T & { error?: string }>
}

export async function fetchTasks(): Promise<TaskStore> {
  const res = await fetch('/api/tasks')
  const data = await parseJson<TaskStore>(res)
  if (!res.ok) throw new Error(data.error || 'Failed to load tasks')
  return data
}

export async function createDepartment(name: string, color: string) {
  const res = await fetch('/api/tasks/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  })
  const data = await parseJson<{ department: { id: string; name: string; color: string } }>(res)
  if (!res.ok) throw new Error(data.error || 'Failed to create department')
  return data.department
}

export async function createProject(departmentId: string, name: string, color: string) {
  const res = await fetch('/api/tasks/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ department_id: departmentId, name, color }),
  })
  const data = await parseJson<{ project: { id: string; department_id: string; name: string; color: string } }>(res)
  if (!res.ok) throw new Error(data.error || 'Failed to create project')
  return data.project
}

export async function createAssignee(name: string) {
  const res = await fetch('/api/tasks/assignees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = await parseJson<{ assignee: { id: string; name: string } }>(res)
  if (!res.ok) throw new Error(data.error || 'Failed to create assignee')
  return data.assignee
}

export async function createTask(payload: {
  department_id: string
  project_id: string
  title: string
}) {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJson<{ task: Task }>(res)
  if (!res.ok) throw new Error(data.error || 'Failed to create task')
  return data.task
}

export async function updateTask(id: string, payload: Partial<Task>) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      department_id: payload.departmentId,
      project_id: payload.projectId,
      title: payload.title,
      description: payload.description,
      status: payload.status,
      importance: payload.importance,
      urgency: payload.urgency,
      assignee_id: payload.assigneeId,
      due_date: payload.dueDate,
      subtasks: payload.subtasks,
    }),
  })
  const data = await parseJson<{ task: Task }>(res)
  if (!res.ok) throw new Error(data.error || 'Failed to update task')
  return data.task
}

export async function deleteTask(id: string) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  const data = await parseJson<{ ok?: boolean }>(res)
  if (!res.ok) throw new Error(data.error || 'Failed to delete task')
}
