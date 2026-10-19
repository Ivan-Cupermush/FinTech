import type { BlockerReason, CompanyRole, Direction, GoalStatus, GoalType, KpiProgress, Risk, TaskStatus, UnitId, UnitType } from '@offix/core';

export interface UserBrief {
  id: string;
  display_name: string;
  position?: string | null;
}

export interface Metric {
  id: string;
  name: string;
  unit: UnitId;
  baseline: number;
  target: number;
  direction: Direction;
  range_min: number | null;
  range_max: number | null;
  is_primary: boolean;
  current_value: number | null;
  last_observed_at: string | null;
  planned_change: number | null;
  progress: KpiProgress;
}

export interface GoalSummary {
  id: string;
  title: string;
  type: GoalType;
  status: GoalStatus;
  parent_goal_id: string | null;
  owner: UserBrief | null;
  due_at: string | null;
  primary_metric: Metric | null;
  progress: number | null;
  task_progress: { done: number; total: number; percent: number | null };
  blocked: number;
  overdue: number;
  updated_at: string;
}

export interface GoalCard {
  id: string;
  title: string;
  description: string | null;
  type: GoalType;
  status: GoalStatus;
  parent_goal_id: string | null;
  owner: UserBrief | null;
  created_by: UserBrief | null;
  due_at: string | null;
  metrics: Metric[];
  progress: number | null;
  task_progress: { done: number; total: number; percent: number | null };
  units: { id: string; name: string; unit_type: UnitType; role: string }[];
  children_count: number;
  checklist: { key: string; label: string; done: boolean }[];
  permissions: { edit: boolean; manage: boolean; activate: boolean; record: boolean; audit: boolean };
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee: UserBrief | null;
  team: { id: string; name: string } | null;
  unit: { id: string; name: string } | null;
  start_at: string | null;
  due_at: string | null;
  done_at: string | null;
  definition_of_done: string | null;
  blocker: { reason: BlockerReason; note: string | null; since: string; next_step: string | null } | null;
  goal_ids: string[];
  depends_on: string[];
  permissions?: { view: boolean; edit: boolean; status: boolean };
}

export interface TaskDetail extends Task {
  history: { status: TaskStatus; blocked_reason: BlockerReason | null; note: string | null; at: string; actor_name: string | null }[];
  dependencies: { id: string; title: string; status: TaskStatus; due_at: string | null; direction: 'before' | 'after' }[];
  participants: { user_id: string; role: string; display_name: string }[];
}

export interface Roadmap {
  goal: GoalCard;
  subgoals: {
    id: string;
    title: string;
    status: GoalStatus;
    due_at: string | null;
    owner: UserBrief | null;
    metrics: Metric[];
    task_ids: string[];
    task_progress: { done: number; total: number };
  }[];
  direct_task_ids: string[];
  tasks: Task[];
  edges: { from: string; to: string }[];
  critical_path: string[];
  risks: Risk[];
  timeline: { from: string; to: string; today: string };
  analytics: {
    medianLeadHours: number | null;
    medianWaitHours: number | null;
    waitShare: number | null;
    finished: number;
    bottlenecks: { key: string; hours: number; share: number }[];
    on_time_share: number | null;
  };
}

export interface Dashboard {
  today: string;
  goals: {
    id: string;
    title: string;
    type: GoalType;
    due_at: string | null;
    primary_metric: Metric | null;
    progress: number | null;
    task_progress: { done: number; total: number };
    risk_level: 'critical' | 'warning' | 'ok';
  }[];
  risks: (Risk & { goal_id: string; goal_title: string })[];
  my_tasks: Task[];
  help_needed: Task[];
  unread_notifications: number;
  drafts: { id: string; title: string }[];
}

export interface Me {
  id: string;
  email: string;
  display_name: string;
  position: string | null;
  role: CompanyRole;
  company_id: string;
  company_name: string;
  setup_mode: 'quick' | 'structured';
  units: { id: string; name: string; unit_type: UnitType; is_manager: boolean; is_primary: boolean }[];
}

export interface Member {
  id: string;
  display_name: string;
  position: string | null;
  email: string;
  active: boolean;
  role: CompanyRole;
  units: { id: string; name: string; is_manager: boolean }[];
}

export interface OrgUnitRow {
  id: string;
  parent_unit_id: string | null;
  name: string;
  unit_type: UnitType;
  description: string | null;
  color: string | null;
  status: 'active' | 'archived';
  member_count: number;
  managers: UserBrief[];
  active_goals: number;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  goal_id: string | null;
  task_id: string | null;
  read_at: string | null;
  created_at: string;
}
