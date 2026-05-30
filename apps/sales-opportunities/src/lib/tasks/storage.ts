import { Assignee, Task } from './types'

export function createId(): string {
  return crypto.randomUUID()
}

export function nextColor(colors: string[], used: string[]): string {
  const available = colors.find((c) => !used.includes(c))
  return available ?? colors[used.length % colors.length]
}

export function activeTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status !== 'done')
}

export function activeSubtasks(subtasks: Task['subtasks']): Task['subtasks'] {
  return subtasks.filter((s) => !s.completed)
}

export function tasksForScope(
  tasks: Task[],
  departmentId: string | null,
  projectId: string | null
): Task[] {
  return activeTasks(tasks).filter((t) => {
    if (departmentId && t.departmentId !== departmentId) return false
    if (projectId && t.projectId !== projectId) return false
    return true
  })
}

export function tasksWithDueDate(tasks: Task[], departmentId: string | null): Task[] {
  return activeTasks(tasks).filter((t) => {
    if (!t.dueDate) return false
    if (departmentId && t.departmentId !== departmentId) return false
    return true
  })
}

export function countOpenTasks(tasks: Task[], projectId: string): number {
  return activeTasks(tasks).filter((t) => t.projectId === projectId).length
}

export function findAssignee(assignees: Assignee[], id: string | null): Assignee | undefined {
  if (!id) return undefined
  return assignees.find((a) => a.id === id)
}
