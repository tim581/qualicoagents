'use client'

import {
  TimelineDay,
  TimelineMonthGrid,
  TimelineColumn,
  MONTH_DAY_WIDTH_PX,
  MONTH_HEADER_HEIGHT,
} from '@/lib/timeline'

interface TimelineMonthHeaderProps {
  grid: TimelineMonthGrid
  onMonthClick?: (monthKey: string) => void
  focusedMonthKey?: string | null
}

export function TimelineMonthHeader({
  grid,
  onMonthClick,
  focusedMonthKey,
}: TimelineMonthHeaderProps) {
  const singleMonth = grid.months.length === 1

  return (
    <div
      className="border-b border-[#30363D] shrink-0"
      style={{
        width: grid.widthPx,
        height: singleMonth ? MONTH_HEADER_HEIGHT / 2 + 24 : MONTH_HEADER_HEIGHT,
      }}
    >
      <div
        className={`flex ${singleMonth ? 'h-7 border-b border-[#30363D]/60' : 'h-1/2 border-b border-[#30363D]/60'}`}
      >
        {grid.months.map((month) => {
          const isFocused = focusedMonthKey === month.monthKey
          const clickable = onMonthClick && grid.months.length > 1

          return (
            <div
              key={month.monthKey}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onMonthClick(month.monthKey) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter') onMonthClick(month.monthKey)
                    }
                  : undefined
              }
              className={`flex items-center justify-center border-r border-[#30363D]/60 text-xs font-semibold bg-[#161B22] ${
                clickable
                  ? 'cursor-pointer hover:bg-[#21262D] hover:text-[#00D4AA] transition-colors'
                  : 'text-[#E6EDF3]'
              } ${isFocused ? 'text-[#00D4AA] bg-[#00D4AA]/10' : ''}`}
              style={{ width: month.dayCount * MONTH_DAY_WIDTH_PX }}
              title={clickable ? `Open ${month.label}` : month.label}
            >
              {month.label}
            </div>
          )
        })}
      </div>

      <div className={`flex ${singleMonth ? 'h-6' : 'h-1/2'}`}>
        {grid.weeks.map((week, i) => (
          <div
            key={week.start.toISOString() + i}
            className="flex items-center justify-center border-r border-[#30363D]/40 text-[10px] font-semibold text-[#00D4AA]/80 bg-[#161B22]/80"
            style={{ width: week.dayCount * MONTH_DAY_WIDTH_PX }}
          >
            {week.label}
          </div>
        ))}
      </div>
    </div>
  )
}

interface TimelineMonthDayRowProps {
  grid: TimelineMonthGrid
}

export function TimelineMonthDayRow({ grid }: TimelineMonthDayRowProps) {
  return (
    <div
      className="flex border-b border-[#30363D] shrink-0"
      style={{ width: grid.widthPx, height: 28 }}
    >
      {grid.days.map((day) => (
        <div
          key={day.iso}
          className={`flex items-center justify-center border-r text-[10px] font-mono ${
            day.isWeekend
              ? 'bg-[#21262D]/80 text-[#484F58] border-[#30363D]/30'
              : 'bg-[#0D1117] text-[#8B949E] border-[#30363D]/20'
          } ${day.isMonday ? 'border-l border-[#30363D]/50' : ''}`}
          style={{ width: MONTH_DAY_WIDTH_PX }}
          title={day.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        >
          {day.dayOfMonth}
        </div>
      ))}
    </div>
  )
}

interface TimelineMonthGridBackgroundProps {
  grid: TimelineMonthGrid
}

export function TimelineMonthGridBackground({ grid }: TimelineMonthGridBackgroundProps) {
  return (
    <div
      className="absolute inset-0 flex pointer-events-none"
      style={{ width: grid.widthPx }}
    >
      {grid.days.map((day) => (
        <DayColumn key={day.iso} day={day} />
      ))}
    </div>
  )
}

function DayColumn({ day }: { day: TimelineDay }) {
  return (
    <div
      className={`shrink-0 border-r ${
        day.isWeekend
          ? 'bg-[#21262D]/50 border-[#30363D]/25'
          : 'border-[#30363D]/15'
      } ${day.isMonday ? 'border-l border-[#30363D]/40' : ''}`}
      style={{ width: MONTH_DAY_WIDTH_PX }}
    />
  )
}

interface ClickableMonthOverviewProps {
  columns: TimelineColumn[]
  onMonthClick: (monthKey: string) => void
}

export function ClickableMonthOverview({ columns, onMonthClick }: ClickableMonthOverviewProps) {
  return (
    <div
      className="flex border-b border-[#30363D] min-w-[720px]"
      style={{ height: standardHeaderHeight() }}
    >
      {columns.map((col) => (
        <button
          key={col.monthKey ?? col.start.toISOString()}
          type="button"
          onClick={() => col.monthKey && onMonthClick(col.monthKey)}
          className="flex-1 min-w-[100px] px-2 flex flex-col items-center justify-end pb-2 border-r border-[#30363D]/60 text-xs font-medium text-[#8B949E] hover:bg-[#21262D] hover:text-[#00D4AA] transition-colors cursor-pointer"
          title={`Open ${col.label}`}
        >
          <span>{col.label}</span>
          <span className="text-[10px] text-[#484F58] mt-0.5 font-normal">4 weeks →</span>
        </button>
      ))}
    </div>
  )
}

export function monthSidebarHeaderHeight(focused = false): number {
  return focused ? focusedMonthHeaderHeight() : MONTH_HEADER_HEIGHT + 28
}

export function standardHeaderHeight(): number {
  return 52
}

export function focusedMonthHeaderHeight(): number {
  return MONTH_HEADER_HEIGHT / 2 + 28
}
