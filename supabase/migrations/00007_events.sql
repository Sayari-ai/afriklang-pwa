-- Product analytics events (Phase 0 of the retention roadmap).
--
-- A minimal, privacy-respecting event log keyed on the same anonymous
-- device UUID every other table uses. No PII, no fingerprinting — just
-- named product events with a small JSON props bag, timestamped
-- server-side. This is what makes retention measurable at all:
--   * DAU / WAU            → count(distinct device_id) by day/week
--   * last-seen per device → max(created_at) group by device_id
--   * funnel drop-off      → app_open → onboarding_complete →
--                            consent_granted → level_start →
--                            recording_submitted → level_complete
--   * feature usage        → skip_used, cycle_advance, install_* ...
--
-- Design notes:
--   * NO foreign key to device_paths — events legitimately fire before
--     a path is assigned (app_open on first launch, onboarding steps),
--     and device_paths' PK is composite (device_id, cycle) anyway.
--   * `user_id` is a forward-compatibility column for the upcoming
--     Google / email auth project. It stays NULL until accounts exist;
--     the auth project will add the FK to auth.users and a
--     device→account link table. Adding the column now avoids a
--     backfill migration later.
--   * Server-side `created_at` only. Client clocks are unreliable and
--     events are fire-and-forget (dropped when offline), so server
--     receive time is the honest timestamp.
--   * Writes go through the `events_log` Edge Function (service role);
--     no anon-role table access is granted.

create table if not exists public.device_events (
  id         bigint generated always as identity primary key,
  device_id  uuid        not null,
  user_id    uuid        null,
  event      text        not null check (event ~ '^[a-z][a-z0-9_]{0,63}$'),
  props      jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.device_events is
  'Anonymous product analytics events, one row per event, keyed on the device UUID. user_id reserved for the auth project.';

-- Retention / DAU queries slice by event name over time.
create index if not exists device_events_event_created_idx
  on public.device_events (event, created_at);

-- Per-device history + last-seen lookups.
create index if not exists device_events_device_created_idx
  on public.device_events (device_id, created_at);
