import type { ScheduledTaskSchedule } from './types.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function assertTime(time: string): void {
  if (!TIME_PATTERN.test(time)) {
    throw new Error('time must use HH:mm format');
  }
}

function dateWithTime(source: Date, time: string): Date {
  const [, hour, minute] = TIME_PATTERN.exec(time) || [];
  const next = new Date(source);
  next.setHours(Number(hour), Number(minute), 0, 0);
  return next;
}

export function normalizeSchedule(
  input: ScheduledTaskSchedule
): ScheduledTaskSchedule {
  if (input.type === 'daily') {
    assertTime(input.time);
    return {
      type: 'daily',
      time: input.time,
    };
  }

  if (input.type === 'weekly') {
    assertTime(input.time);
    const daysOfWeek = Array.from(
      new Set(input.daysOfWeek.filter((day) => Number.isInteger(day)))
    ).sort((a, b) => a - b);
    if (daysOfWeek.length === 0) {
      throw new Error('weekly schedule requires at least one weekday');
    }
    if (daysOfWeek.some((day) => day < 0 || day > 6)) {
      throw new Error('daysOfWeek values must be between 0 and 6');
    }
    return {
      type: 'weekly',
      time: input.time,
      daysOfWeek,
    };
  }

  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 1) {
    throw new Error('intervalMinutes must be a positive integer');
  }
  return {
    type: 'interval',
    intervalMinutes: Math.min(input.intervalMinutes, 525600),
  };
}

export function computeNextRunAt(
  schedule: ScheduledTaskSchedule,
  from = new Date(),
  lastRunAt?: Date | null
): Date {
  const normalized = normalizeSchedule(schedule);

  if (normalized.type === 'interval') {
    const anchor = lastRunAt && !Number.isNaN(lastRunAt.getTime()) ? lastRunAt : from;
    const next = new Date(anchor.getTime() + normalized.intervalMinutes * 60_000);
    return next <= from
      ? new Date(from.getTime() + normalized.intervalMinutes * 60_000)
      : next;
  }

  if (normalized.type === 'daily') {
    const next = dateWithTime(from, normalized.time);
    if (next <= from) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = dateWithTime(from, normalized.time);
    candidate.setDate(candidate.getDate() + offset);
    if (normalized.daysOfWeek.includes(candidate.getDay()) && candidate > from) {
      return candidate;
    }
  }

  const fallback = dateWithTime(from, normalized.time);
  fallback.setDate(fallback.getDate() + 7);
  return fallback;
}

export function describeSchedule(schedule: ScheduledTaskSchedule): string {
  const normalized = normalizeSchedule(schedule);
  if (normalized.type === 'daily') return `每天 ${normalized.time}`;
  if (normalized.type === 'interval') {
    return `每 ${normalized.intervalMinutes} 分钟`;
  }
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${normalized.daysOfWeek.map((day) => labels[day]).join('、')} ${normalized.time}`;
}
