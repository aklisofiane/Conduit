import { useCallback, useMemo, useState } from 'react';
import cronstrue from 'cronstrue';
import { ChevronDown } from 'lucide-react';
import { CRON_EXPRESSION_RE } from '@conduit/shared';
import { Select } from '../common/Select.js';
import { cn } from '../../lib/cn.js';
import { Hint } from './trigger-panel-common.js';

type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

interface StructuredSchedule {
  frequency: Frequency;
  minute: number;
  hour: number;
  daysOfWeek: number[];
  dayOfMonth: number;
}

const DEFAULTS: StructuredSchedule = {
  frequency: 'daily',
  minute: 0,
  hour: 9,
  daysOfWeek: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const FREQUENCY_OPTIONS = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom (cron)' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, '0'),
}));

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, '0'),
}));

const DOM_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

function serializeCron(s: StructuredSchedule): string {
  switch (s.frequency) {
    case 'hourly':
      return `${s.minute} * * * *`;
    case 'daily':
      return `${s.minute} ${s.hour} * * *`;
    case 'weekly': {
      const dow =
        s.daysOfWeek.length === 0
          ? '*'
          : s.daysOfWeek.toSorted((a, b) => a - b).join(',');
      return `${s.minute} ${s.hour} * * ${dow}`;
    }
    case 'monthly':
      return `${s.minute} ${s.hour} ${s.dayOfMonth} * *`;
    case 'custom':
      return '';
  }
}

function parseDowField(field: string): number[] | null {
  const parts = field.split(',');
  const days: number[] = [];
  for (const p of parts) {
    if (/^\d$/.test(p)) {
      const n = Number(p);
      if (n < 0 || n > 6) return null;
      days.push(n);
    } else if (/^\d-\d$/.test(p)) {
      const [a, b] = p.split('-').map(Number);
      if (a! > b!) return null;
      for (let i = a!; i <= b!; i++) days.push(i);
    } else {
      return null;
    }
  }
  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : null;
}

function parseCron(cron: string): StructuredSchedule | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;

  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return null;
  }

  const minNum = Number(min);
  if (!Number.isInteger(minNum) || minNum < 0 || minNum > 59) return null;

  if (hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return { ...DEFAULTS, frequency: 'hourly', minute: minNum };
  }

  const hourNum = Number(hour);
  if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) return null;

  if (dom === '*' && month === '*' && dow === '*') {
    return { ...DEFAULTS, frequency: 'daily', minute: minNum, hour: hourNum };
  }

  if (dom === '*' && month === '*' && dow !== '*') {
    const days = parseDowField(dow!);
    if (!days) return null;
    return { ...DEFAULTS, frequency: 'weekly', minute: minNum, hour: hourNum, daysOfWeek: days };
  }

  const domNum = Number(dom);
  if (
    Number.isInteger(domNum) &&
    domNum >= 1 &&
    domNum <= 31 &&
    month === '*' &&
    dow === '*'
  ) {
    return { ...DEFAULTS, frequency: 'monthly', minute: minNum, hour: hourNum, dayOfMonth: domNum };
  }

  return null;
}

function describeCron(cron: string): string | null {
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: true });
  } catch {
    return null;
  }
}

interface CronScheduleBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

export function CronScheduleBuilder({ value, onChange }: CronScheduleBuilderProps) {
  const initialParsed = useMemo(() => parseCron(value), []);
  const [schedule, setSchedule] = useState<StructuredSchedule>(
    () => initialParsed ?? DEFAULTS,
  );
  const [isCustom, setIsCustom] = useState(() => !initialParsed && value !== '');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateSchedule = useCallback(
    (patch: Partial<StructuredSchedule>) => {
      const next = { ...schedule, ...patch };
      setSchedule(next);
      const cron = serializeCron(next);
      if (cron) onChange(cron);
    },
    [schedule, onChange],
  );

  const handleFrequencyChange = useCallback(
    (freq: string) => {
      if (freq === 'custom') {
        setIsCustom(true);
        return;
      }
      setIsCustom(false);
      const parsed = parseCron(value);
      if (parsed) {
        updateSchedule({ ...parsed, frequency: freq as Frequency });
      } else {
        updateSchedule({ frequency: freq as Frequency });
      }
    },
    [value, updateSchedule],
  );

  const toggleDay = useCallback(
    (day: number) => {
      const current = schedule.daysOfWeek;
      if (current.includes(day) && current.length === 1) return;
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day];
      updateSchedule({ daysOfWeek: next });
    },
    [schedule.daysOfWeek, updateSchedule],
  );

  const description = useMemo(() => describeCron(value), [value]);
  const isValid = useMemo(() => CRON_EXPRESSION_RE.test(value), [value]);

  return (
    <div className="space-y-4">
      <div>
        <div className="field-label">Repeat</div>
        <Select
          ariaLabel="Schedule frequency"
          value={isCustom ? 'custom' : schedule.frequency}
          onValueChange={handleFrequencyChange}
          options={FREQUENCY_OPTIONS}
        />
      </div>

      {!isCustom && (
        <>
          {schedule.frequency === 'weekly' && (
            <div>
              <div className="field-label">On</div>
              <div className="flex gap-1">
                {DAYS.map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={cn(
                      'flex h-8 w-10 items-center justify-center rounded-[var(--radius-sm)] font-mono text-[11px] font-medium transition-colors',
                      schedule.daysOfWeek.includes(i)
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-pill-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-divider)]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {schedule.frequency === 'monthly' && (
            <div>
              <div className="field-label">Day of month</div>
              <Select
                ariaLabel="Day of month"
                value={String(schedule.dayOfMonth)}
                onValueChange={(v) => updateSchedule({ dayOfMonth: Number(v) })}
                options={DOM_OPTIONS}
              />
            </div>
          )}

          <div>
            <div className="field-label">
              {schedule.frequency === 'hourly' ? 'At minute' : 'At'}
            </div>
              <div className="flex items-center gap-1.5">
                {schedule.frequency !== 'hourly' && (
                  <>
                    <Select
                      ariaLabel="Hour"
                      value={String(schedule.hour)}
                      onValueChange={(v) => updateSchedule({ hour: Number(v) })}
                      options={HOUR_OPTIONS}
                      className="w-[72px]"
                    />
                    <span className="font-mono text-[13px] text-[var(--color-text-muted)]">
                      :
                    </span>
                  </>
                )}
                <Select
                  ariaLabel="Minute"
                  value={String(schedule.minute)}
                  onValueChange={(v) => updateSchedule({ minute: Number(v) })}
                  options={MINUTE_OPTIONS}
                  className="w-[72px]"
                />
              </div>
          </div>
        </>
      )}

      {isCustom && (
        <div>
          <div className="field-label">
            Cron expression
            <span className="hint">5-field POSIX (min hour dom month dow)</span>
          </div>
          <input
            className="field-input"
            type="text"
            placeholder="0 9 * * *"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {value !== '' && !isValid && (
            <Hint tone="danger">
              Invalid — expected 5 space-separated fields (min hour dom month dow)
            </Hint>
          )}
        </div>
      )}

      {description && (
        <div className="rounded-[var(--radius)] bg-[var(--color-pill-bg)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-muted)]">
          {description}
        </div>
      )}

      {!isCustom && (
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 font-mono text-[11px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            <ChevronDown
              size={12}
              strokeWidth={1.5}
              className={cn(
                'transition-transform',
                showAdvanced && 'rotate-180',
              )}
            />
            {showAdvanced ? 'Hide' : 'Show'} cron expression
          </button>
          {showAdvanced && (
            <input
              className="field-input mt-2"
              type="text"
              value={value}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          )}
        </div>
      )}
    </div>
  );
}
