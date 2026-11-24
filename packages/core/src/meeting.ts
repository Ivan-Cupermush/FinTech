import type { UserBrief } from './api-types';

export interface MeetingInput {
  title: string;
  agenda?: string;
  location?: string;
  starts_at: string;
  ends_at: string;
  participant_ids: string[];
}

export interface Meeting {
  id: string;
  title: string;
  agenda: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  organizer_id: string | null;
  participants: UserBrief[];
}

export interface Meetings {
  upcoming: Meeting[];
  past: Meeting[];
}

/** Ввод в местном часовом поясе → однозначное время для API. */
export function meetingInstant(value: string): string | null {
  const input = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/.exec(value.trim());
  if (!input) return null;
  const date = new Date(`${input[1]}T${input[2]}:00`);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (number: number) => String(number).padStart(2, '0');
  const normalized = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return normalized === `${input[1]} ${input[2]}` ? date.toISOString() : null;
}

export function meetingTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
