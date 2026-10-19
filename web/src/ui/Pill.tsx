import { GOAL_STATUS_LABELS, TASK_STATUS_LABELS, type GoalStatus, type TaskStatus } from '@offix/core';
import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent' | 'info';

export function Pill({ tone = 'neutral', plain, live, children }: { tone?: Tone; plain?: boolean; live?: boolean; children: ReactNode }) {
  return <span className={['pill', tone !== 'neutral' && tone, plain && 'plain', live && 'live'].filter(Boolean).join(' ')}>{children}</span>;
}

const GOAL_TONE: Record<GoalStatus, Tone> = { draft: 'neutral', active: 'accent', on_hold: 'warn', completed: 'good', cancelled: 'neutral' };
const TASK_TONE: Record<TaskStatus, Tone> = { todo: 'neutral', in_progress: 'accent', blocked: 'bad', review: 'info', done: 'good', cancelled: 'neutral' };

export const GoalStatusPill = ({ status }: { status: GoalStatus }) => <Pill tone={GOAL_TONE[status]}>{GOAL_STATUS_LABELS[status]}</Pill>;
export const TaskStatusPill = ({ status, overdue }: { status: TaskStatus; overdue?: boolean }) =>
  overdue && status !== 'blocked' ? <Pill tone="warn">Просрочена</Pill> : <Pill tone={TASK_TONE[status]} live={status === 'blocked'}>{TASK_STATUS_LABELS[status]}</Pill>;
