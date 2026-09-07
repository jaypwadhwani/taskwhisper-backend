-- TaskWhisper: reminders table
-- Only needed if the original Supabase project was DELETED rather than paused.
-- A paused project already has this table; just restore it in the dashboard.
--
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Every column below is one the backend in server.js reads or writes.

create table if not exists public.reminders (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),

  email                text,
  phone_number         text,

  transcript           text,
  tasks                jsonb not null default '[]'::jsonb,
  email_draft          text,
  email_subject        text not null default 'TaskWhisper Reminder - Your Tasks',

  scheduled_for        timestamptz not null,
  notification_methods text[] not null default array['email'],

  sent                 boolean not null default false,
  completed            boolean not null default false,
  last_followup_sent   timestamptz,
  followup_count       integer not null default 0
);

-- Indexes for the three queries the backend actually runs:
-- list by user, find due reminders, find reminders needing a follow-up.
create index if not exists reminders_email_scheduled_idx
  on public.reminders (email, scheduled_for);

create index if not exists reminders_due_idx
  on public.reminders (sent, scheduled_for);

create index if not exists reminders_followup_idx
  on public.reminders (sent, completed, scheduled_for);

-- The backend connects with the service_role key, which bypasses row level
-- security. RLS is enabled with no policies so that a leaked anon key cannot
-- read anyone's reminders.
alter table public.reminders enable row level security;
