export type TaskStatus = 'to_start' | 'in_progress' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type ViewMode = 'list' | 'kanban' | 'calendar'
export type CalendarZoom = 'week' | 'month'

export interface Subtask {
  id: string
  title: string
  completed: boolean
}

export interface Task {
  id: string
  departmentId: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  importance: Priority
  urgency: Priority
  assigneeId: string | null
  dueDate: string | null
  subtasks: Subtask[]
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  departmentId: string
  name: string
  color: string
}

export interface Department {
  id: string
  name: string
  color: string
}

export interface Assignee {
  id: string
  name: string
}

export interface TaskStore {
  departments: Department[]
  projects: Project[]
  tasks: Task[]
  assignees: Assignee[]
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  to_start: 'To start',
  in_progress: 'In progress',
  done: 'Done',
}

export const STATUS_COLORS: Record<TaskStatus, string> = {
  to_start: '#8B949E',
  in_progress: '#58A6FF',
  done: '#00D4AA',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#8B949E',
  medium: '#D29922',
  high: '#F0883E',
  critical: '#FF7B72',
}

export const DEPT_COLORS = ['#00D4AA', '#58A6FF', '#BC8CFF', '#F0883E', '#FF7B72', '#D29922']
export const PROJECT_COLORS = ['#238636', '#1F6FEB', '#8957E5', '#BF8700', '#DA3633', '#0969DA']
