'use client'

import { useEffect, useState } from 'react'
import {
  TimelineMilestone,
  TimelineProject,
  TimelineStatus,
  TimelineCreateDefaults,
  STATUS_LABELS,
  defaultEndDate,
} from '@/lib/timeline'

interface FormPayload {
  id?: string
  project_id: string
  title: string
  description: string
  start_date: string
  end_date: string
  status: TimelineStatus
}

interface TimelineItemFormProps {
  projects: TimelineProject[]
  milestone: TimelineMilestone | null
  defaults?: TimelineCreateDefaults | null
  saving: boolean
  onSave: (payload: FormPayload) => Promise<void>
  onDelete?: () => void
  onClose: () => void
}

export default function TimelineItemForm({
  projects,
  milestone,
  defaults,
  saving,
  onSave,
  onDelete,
  onClose,
}: TimelineItemFormProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState<TimelineStatus>('planned')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setFormError(null)
    if (milestone) {
      setProjectId(milestone.project_id)
      setTitle(milestone.title)
      setDescription(milestone.description || '')
      setStartDate(milestone.start_date)
      setEndDate(milestone.end_date || milestone.start_date)
      setStatus(milestone.status)
    } else if (defaults) {
      setProjectId(defaults.project_id)
      setTitle('')
      setDescription('')
      setStartDate(defaults.start_date)
      setEndDate(defaults.end_date)
      setStatus('planned')
    } else {
      setProjectId(projects[0]?.id || '')
      setTitle('')
      setDescription('')
      const today = new Date().toISOString().slice(0, 10)
      setStartDate(today)
      setEndDate(defaultEndDate(today))
      setStatus('planned')
    }
  }, [milestone, projects, defaults])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setFormError('Enter a milestone name')
      return
    }
    if (!projectId) {
      setFormError('Select a project')
      return
    }
    if (!startDate) {
      setFormError('Pick a start date')
      return
    }
    const resolvedEnd = endDate || defaultEndDate(startDate)
    if (resolvedEnd < startDate) {
      setFormError('End date must be on or after start date')
      return
    }
    setFormError(null)
    await onSave({
      id: milestone?.id,
      project_id: projectId,
      title: title.trim(),
      description: description.trim(),
      start_date: startDate,
      end_date: resolvedEnd,
      status,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div
        className="w-full max-w-lg bg-[#161B22] border border-[#30363D] rounded-lg shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="timeline-form-title"
      >
        <div className="px-6 py-4 border-b border-[#30363D] flex items-center justify-between">
          <h2 id="timeline-form-title" className="text-lg font-semibold text-white">
            {milestone ? 'Edit milestone' : 'New milestone'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#8B949E] hover:text-[#E6EDF3] text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {formError ? (
            <div className="rounded-md border border-[#FF7B72]/40 bg-[#FF7B72]/10 px-3 py-2 text-sm text-[#FF7B72]">
              {formError}
            </div>
          ) : null}
          <Field label="Milestone name">
            <input
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q3 product launch"
              className={inputClass}
            />
          </Field>

          <Field label="Project">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={inputClass}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional context"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date">
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="End date">
              <input
                required
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TimelineStatus)}
              className={inputClass}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-center justify-between pt-2">
            <div>
              {onDelete ? (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={saving}
                  className="text-sm text-[#FF7B72] hover:text-[#ff9b94] disabled:opacity-50"
                >
                  Delete
                </button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md text-sm text-[#8B949E] hover:text-[#E6EDF3]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim()}
                className="px-4 py-2 rounded-md bg-[#00D4AA] text-[#0D1117] text-sm font-semibold hover:bg-[#00D4AA]/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : milestone ? 'Save changes' : 'Add milestone'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#8B949E] mb-1.5">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full px-3 py-2 rounded-md bg-[#0D1117] border border-[#30363D] text-[#E6EDF3] text-sm focus:outline-none focus:border-[#00D4AA]/60'
