'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TimelineMilestone,
  barStyle,
  itemColor,
  milestoneStartDate,
  milestoneEndDate,
  dateFromTimelinePercent,
  percentFromClientX,
  daysBetween,
  addDays,
  toISODate,
} from '@/lib/timeline'

type DragMode = 'move' | 'resize-start' | 'resize-end'

interface DragState {
  milestoneId: string
  mode: DragMode
  chartRect: DOMRect
  origStart: Date
  origEnd: Date
  anchorDate: Date
}

interface TimelineBarProps {
  milestone: TimelineMilestone
  projectColor: string
  bounds: { start: Date; end: Date }
  chartRef: React.RefObject<HTMLDivElement>
  isSelected: boolean
  onSelect: (id: string) => void
  onEdit: (milestone: TimelineMilestone) => void
  onDatesChange: (id: string, start_date: string, end_date: string) => void
}

export default function TimelineBar({
  milestone,
  projectColor,
  bounds,
  chartRef,
  isSelected,
  onSelect,
  onEdit,
  onDatesChange,
}: TimelineBarProps) {
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [livePreview, setLivePreview] = useState<{ start: Date; end: Date } | null>(null)
  const movedRef = useRef(false)
  const color = itemColor(milestone, projectColor)

  const displayMilestone: TimelineMilestone = livePreview
    ? {
        ...milestone,
        start_date: toISODate(livePreview.start),
        end_date: toISODate(livePreview.end),
      }
    : milestone

  const beginDrag = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (!chartRef.current) return
      e.preventDefault()
      e.stopPropagation()
      onSelect(milestone.id)

      const chartRect = chartRef.current.getBoundingClientRect()
      const percent = percentFromClientX(e.clientX, chartRect)
      const anchorDate = dateFromTimelinePercent(percent, bounds.start, bounds.end)

      setDragging({
        milestoneId: milestone.id,
        mode,
        chartRect,
        origStart: milestoneStartDate(milestone),
        origEnd: milestoneEndDate(milestone),
        anchorDate,
      })
      movedRef.current = false

      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [bounds.end, bounds.start, chartRef, milestone, onSelect]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || dragging.milestoneId !== milestone.id) return

      const chartRect = chartRef.current?.getBoundingClientRect() ?? dragging.chartRect
      const percent = percentFromClientX(e.clientX, chartRect)
      const pointerDate = dateFromTimelinePercent(percent, bounds.start, bounds.end)

      let nextStart = dragging.origStart
      let nextEnd = dragging.origEnd

      if (dragging.mode === 'resize-end') {
        nextEnd = pointerDate < dragging.origStart ? dragging.origStart : pointerDate
        if (daysBetween(nextStart, nextEnd) < 1) nextEnd = addDays(nextStart, 1)
      } else if (dragging.mode === 'resize-start') {
        nextStart = pointerDate > dragging.origEnd ? dragging.origEnd : pointerDate
        if (daysBetween(nextStart, nextEnd) < 1) nextStart = addDays(nextEnd, -1)
      } else {
        const deltaDays = daysBetween(dragging.anchorDate, pointerDate)
        nextStart = addDays(dragging.origStart, deltaDays)
        nextEnd = addDays(dragging.origEnd, deltaDays)
      }

      setLivePreview({ start: nextStart, end: nextEnd })
      movedRef.current = true
    },
    [bounds.end, bounds.start, chartRef, dragging, milestone.id]
  )

  const finishDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || dragging.milestoneId !== milestone.id) return

      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)

      if (livePreview && movedRef.current) {
        onDatesChange(
          milestone.id,
          toISODate(livePreview.start),
          toISODate(livePreview.end)
        )
      }

      setDragging(null)
      setLivePreview(null)
      movedRef.current = false
    },
    [dragging, milestone.id, livePreview, onDatesChange]
  )

  useEffect(() => {
    if (!dragging) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDragging(null)
        setLivePreview(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dragging])

  const style = barStyle(displayMilestone, bounds.start, bounds.end)
  const isDragging = dragging?.milestoneId === milestone.id

  return (
    <div
      data-timeline-item
      className="absolute inset-0 z-10"
      onClick={(e) => e.stopPropagation()}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div
        className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-md flex items-stretch overflow-hidden touch-none group ${
          isDragging ? 'opacity-95 shadow-lg ring-2 ring-[#00D4AA]/60' : ''
        } ${isSelected ? 'ring-2 ring-white/80' : ''}`}
        style={{
          left: style.left,
          width: style.width,
          minWidth: 32,
          backgroundColor: color,
        }}
      >
        <div
          onPointerDown={(e) => beginDrag(e, 'resize-start')}
          className="w-2 shrink-0 cursor-ew-resize hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Drag to change start date"
        />
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!movedRef.current) onSelect(milestone.id)
          }}
          onDoubleClick={() => onEdit(milestone)}
          onPointerDown={(e) => beginDrag(e, 'move')}
          className={`flex-1 px-1 flex items-center min-w-0 ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          title={`${milestone.title} — drag to move, edges to resize`}
        >
          <span className="text-[11px] font-medium text-white truncate pointer-events-none select-none">
            {milestone.title}
          </span>
        </div>
        <div
          onPointerDown={(e) => beginDrag(e, 'resize-end')}
          className="w-2 shrink-0 cursor-ew-resize hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Drag to change end date"
        />
      </div>
    </div>
  )
}

export function TimelineBarHint() {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-6 h-2.5 rounded-sm bg-[#58A6FF]/40" />
      Drag edges to resize • drag to move
    </span>
  )
}
