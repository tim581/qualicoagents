export type TimelineStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export type TimelineZoom = 'month' | 'quarter' | 'year'

export const MONTH_DAY_WIDTH_PX = 28
export const MONTH_HEADER_HEIGHT = 64

export interface TimelineDay {
  date: Date
  iso: string
  dayOfMonth: number
  isWeekend: boolean
  isMonday: boolean
  monthKey: string
}

export interface TimelineMonthGroup {
  label: string
  monthKey: string
  start: Date
  end: Date
  dayCount: number
}

export interface TimelineWeekGroup {
  label: string
  start: Date
  end: Date
  dayCount: number
}

export interface TimelineMonthGrid {
  days: TimelineDay[]
  months: TimelineMonthGroup[]
  weeks: TimelineWeekGroup[]
  widthPx: number
}

export interface TimelineProject {
  id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface TimelineMilestone {
  id: string
  project_id: string
  title: string
  description: string | null
  start_date: string
  end_date: string | null
  status: TimelineStatus
  color: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TimelineProjectWithMilestones extends TimelineProject {
  milestones: TimelineMilestone[]
}

export interface TimelineCreateDefaults {
  project_id: string
  start_date: string
  end_date: string
}

export const STATUS_LABELS: Record<TimelineStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const STATUS_COLORS: Record<TimelineStatus, string> = {
  planned: '#8B949E',
  in_progress: '#58A6FF',
  completed: '#3FB950',
  cancelled: '#484F58',
}

export function normalizeMilestone(row: Record<string, unknown>): TimelineMilestone {
  return {
    id: row.id as string,
    project_id: (row.project_id ?? row.track_id) as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    start_date: row.start_date as string,
    end_date: (row.end_date as string | null) ?? null,
    status: row.status as TimelineStatus,
    color: (row.color as string | null) ?? null,
    sort_order: row.sort_order as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export function defaultEndDate(startDate: string, days = 30): string {
  return toISODate(addDays(parseDate(startDate), days))
}

  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(value: string): string {
  return parseDate(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function milestoneEndDate(milestone: TimelineMilestone): Date {
  return parseDate(milestone.end_date || milestone.start_date)
}

export function milestoneStartDate(milestone: TimelineMilestone): Date {
  return parseDate(milestone.start_date)
}

export function groupMilestonesByProject(
  projects: TimelineProject[],
  milestones: TimelineMilestone[]
): TimelineProjectWithMilestones[] {
  const byProject = new Map<string, TimelineMilestone[]>()
  for (const milestone of milestones) {
    const list = byProject.get(milestone.project_id) || []
    list.push(milestone)
    byProject.set(milestone.project_id, list)
  }

  return projects.map((project) => ({
    ...project,
    milestones: (byProject.get(project.id) || []).sort((a, b) => a.sort_order - b.sort_order),
  }))
}

export function getTimelineBounds(milestones: TimelineMilestone[]): { start: Date; end: Date } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (milestones.length === 0) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end = new Date(today.getFullYear(), today.getMonth() + 6, 0)
    return { start, end }
  }

  let min = milestoneStartDate(milestones[0])
  let max = milestoneEndDate(milestones[0])

  for (const milestone of milestones) {
    const s = milestoneStartDate(milestone)
    const e = milestoneEndDate(milestone)
    if (s < min) min = s
    if (e > max) max = e
  }

  const start = new Date(min.getFullYear(), min.getMonth() - 1, 1)
  const end = new Date(max.getFullYear(), max.getMonth() + 2, 0)
  return { start, end }
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function startOfQuarter(date: Date): Date {
  const q = Math.floor(date.getMonth() / 3)
  return new Date(date.getFullYear(), q * 3, 1)
}

export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1)
}

export function enumerateDays(rangeStart: Date, rangeEnd: Date): TimelineDay[] {
  const days: TimelineDay[] = []
  let cursor = new Date(rangeStart)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(rangeEnd)
  end.setHours(0, 0, 0, 0)

  while (cursor <= end) {
    const dow = cursor.getDay()
    days.push({
      date: new Date(cursor),
      iso: toISODate(cursor),
      dayOfMonth: cursor.getDate(),
      isWeekend: dow === 0 || dow === 6,
      isMonday: dow === 1,
      monthKey: `${cursor.getFullYear()}-${cursor.getMonth()}`,
    })
    cursor = addDays(cursor, 1)
  }

  return days
}

export function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`
}

export function getMonthRangeFromKey(monthKey: string): { start: Date; end: Date } {
  const [year, month] = monthKey.split('-').map(Number)
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0),
  }
}

export function buildMonthOverviewColumns(
  rangeStart: Date,
  rangeEnd: Date
): TimelineColumn[] {
  const columns: TimelineColumn[] = []
  let cursor = startOfMonth(rangeStart)
  while (cursor <= rangeEnd) {
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    columns.push({
      label: cursor.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      start: cursor,
      end,
      monthKey: getMonthKey(cursor),
    })
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }
  return columns
}

export function buildMonthGrid(rangeStart: Date, rangeEnd: Date): TimelineMonthGrid {
  const days = enumerateDays(rangeStart, rangeEnd)
  const months: TimelineMonthGroup[] = []
  const weeks: TimelineWeekGroup[] = []
  const singleMonth = days.length > 0 && days.every((d) => d.monthKey === days[0].monthKey)

  let monthCursor: TimelineMonthGroup | null = null
  for (const day of days) {
    if (!monthCursor || monthCursor.monthKey !== day.monthKey) {
      monthCursor = {
        label: day.date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        monthKey: day.monthKey,
        start: day.date,
        end: day.date,
        dayCount: 1,
      }
      months.push(monthCursor)
    } else {
      monthCursor.end = day.date
      monthCursor.dayCount += 1
    }
  }

  let weekCursor: TimelineWeekGroup | null = null
  let weekNum = 1
  for (const day of days) {
    if (day.isMonday || !weekCursor) {
      const weekEnd = addDays(day.date, 6)
      weekCursor = {
        label: singleMonth
          ? `Week ${weekNum}`
          : day.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        start: day.date,
        end: weekEnd,
        dayCount: 1,
      }
      weeks.push(weekCursor)
      weekNum += 1
    } else {
      weekCursor.end = day.date
      weekCursor.dayCount += 1
    }
  }

  return {
    days,
    months,
    weeks,
    widthPx: days.length * MONTH_DAY_WIDTH_PX,
  }
}

export interface TimelineColumn {
  label: string
  start: Date
  end: Date
  monthKey?: string
}

export function buildColumns(
  rangeStart: Date,
  rangeEnd: Date,
  zoom: TimelineZoom
): TimelineColumn[] {
  if (zoom === 'month' || zoom === 'quarter' || zoom === 'year') {
    return buildMonthOverviewColumns(rangeStart, rangeEnd)
  }
  return []
}

export function positionOnTimeline(
  date: Date,
  rangeStart: Date,
  rangeEnd: Date
): number {
  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 1)
  const offset = daysBetween(rangeStart, date)
  return Math.min(100, Math.max(0, (offset / totalDays) * 100))
}

export function barStyle(
  milestone: TimelineMilestone,
  rangeStart: Date,
  rangeEnd: Date
): { left: string; width: string } {
  const start = milestoneStartDate(milestone)
  const end = milestoneEndDate(milestone)
  const left = positionOnTimeline(start, rangeStart, rangeEnd)
  const right = positionOnTimeline(end, rangeStart, rangeEnd)
  const width = Math.max(right - left, 2.5)
  return { left: `${left}%`, width: `${width}%` }
}

export function itemColor(milestone: TimelineMilestone, projectColor: string): string {
  if (milestone.color) return milestone.color
  if (milestone.status === 'completed') return '#3FB950'
  if (milestone.status === 'cancelled') return '#484F58'
  return projectColor
}

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dateFromTimelinePercent(
  percent: number,
  rangeStart: Date,
  rangeEnd: Date
): Date {
  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 1)
  const offsetDays = Math.round((percent / 100) * totalDays)
  return addDays(rangeStart, offsetDays)
}

export function percentFromClientX(
  clientX: number,
  chartRect: DOMRect
): number {
  const x = clientX - chartRect.left
  return Math.min(100, Math.max(0, (x / chartRect.width) * 100))
}
