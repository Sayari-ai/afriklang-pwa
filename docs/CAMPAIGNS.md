# Campaigns in the app

How contributors take part in an Afriklang **campaign** from the recording app: the invitation link,
sign-in, profile, consents, missions and recording. The dashboard side (creating campaigns, assigning
contributors, tracking) lives in `afriklang-landing-page`; the contract between the two is
`docs/CAMPAIGN_BRIDGE_CONTRACT.md` there.

## 1. The contributor's path

1. An admin assigns the contributor to a launched campaign. The dashboard emails a personal link,
   `https://<dashboard>/c/<token>`, valid 14 days.
2. The link records the open and redirects to `<app>/campaign#t=<token>`. The token is in the **URL
   fragment** so it never reaches a server log. The app reads it, stores it, and **removes it from the
   address bar** at once.
3. The contributor signs in with **Google** (the only sign-in method today).
4. The app sends the token to the dashboard. The dashboard binds the account to the contributor **only
   if the Google email is verified and equals the email the invitation was sent to**. Otherwise the
   contributor is told which address (masked, for example `a***@gmail.com`) to use.
5. Home (`/campaign`, also what `/` and the installed app open): totals, takes waiting on the phone,
   and one card per campaign **that has missions assigned to the speaker**, with a direct
   "Start recording" button. With no missions assigned, the speaker sees their recent activity and a
   link to their history instead.
6. In a campaign: a three-step setup, **profile** (language, variety, country, region, gender, age
   group, phone) → **account consent** (once) → **campaign consent**; then the start button, recording
   tips, and the missions in tabs (to record, to redo, in review, accepted).
7. **Studio** (`/campaign/<id>/studio`): missions back to back, the ones to redo first. The studio
   records a short silence before showing "Speak now" and keeps recording a moment after Stop, so the
   silence margins pass; a ring around the button follows the voice (green loud enough, amber too
   quiet). Duration, level, clipping and silence are checked before the take can be submitted.
   "Submit & next" saves the take on the phone and goes straight on; a session goal (the campaign's
   smallest "missions per session") ends in a small celebration.
8. **History** (`/campaign/history`): totals, takes still on the phone (send now, record again,
   delete), every recording with its review result, and the activity on this phone by day.

**Pay is per hour of accepted audio.** When the dashboard sends `rewards.accepted_s` / `pending_s`, the
home, each card, the campaign page and the history show accepted and in-review audio as hours and
minutes, rounded down (never more than will be paid). With an older dashboard they fall back to counts.

### Planned and pool campaigns

Each card says how work reaches the speaker (`dispatch`; a card without it is planned).

- **Planned**: every mission is assigned up front. Everything above applies as is.
- **Pool** (large campaigns): nothing is assigned up front, so the card shows from the first setup
  step. Once set up, the speaker **draws** a small batch (`draw`). Each mission is held under a
  **lease** (`lease_until`, usually 72 h); one not submitted in time goes back to the pool.
  - The app draws by itself when the speaker opens the campaign or the studio holding fewer than
    `refill_below` missions they can still record, and again while recording as the batch runs low.
    It waits a minute after a draw, 2 minutes after a failed call, and 15 minutes after a refusal
    or a give-back (`src/lib/campaign/pool.ts`, `shouldDraw`). "Get more missions" asks at once.
  - The campaign page shows when the batch must be recorded by (amber within 24 h; rows show the
    hours left). Missions whose lease ended are hidden and never started, even from the saved copy.
  - A refusal is not an error: `cell_full`, `campaign_full`, `speaker_cap` and `quality_hold` each
    get a message, and a full cell lists the speaker's other campaigns that still need them.
  - "More options" → **Give back the missions I will not record** frees them for others at once.
  - A take recorded before the lease ended but sent after it is still sent: the dashboard keeps it
    (late submission). The outbox never drops a take because of a lease.

Only a pseudonymous **speaker ID** (for example `SPK-7Q2M9X4D`) travels with the audio, never a name.

## 2. Architecture

```
browser /campaign  ──►  Edge Function `campaigns`  ──►  dashboard /api/pwa/campaigns/*
 Google session          verifies the session,           checks Authorization: Bearer <secret>
                         holds BRIDGE_SECRET             (PWA_BRIDGE_SECRET on the dashboard)

browser  ──►  /api/audio-upload (proxy)  ──►  Sayari      (the audio itself)
 Bearer <session>   checks the session with Supabase Auth,   checks X-Upload-Key
                    size (≤ 25 MB) and rate; adds the key
```

- **The upload proxy only forwards for a signed-in contributor** (since 2026-10-13): it reads
  `Authorization: Bearer <Supabase access token>`, checks it with Supabase Auth (cached 60 s), and
  refuses a body over 25 MB or without `Content-Length`. Limits, in each server instance's memory:
  120 uploads per person per 10 minutes, 20 failed sign-in checks per address per 10 minutes, 600
  Auth lookups per minute in total. Sayari's 5xx text and a refused upload key never reach the
  browser (`502 upstream_error`, `500 server_misconfigured`). Code: `src/lib/server/upload-guard.ts`.
  The outbox sends the token, renews it once on a 401, and otherwise holds the take until the
  speaker signs in again. The old learning-app screen (`/level/*`) sends no token and can no longer
  upload. The next step (dashboard-signed upload tickets) is in
  `afriklang/docs/CAMPAIGN_PIPELINE_COMPLETION_PLAN.md`, Phase 1.

- The browser **never holds the bridge secret** and **never says who it is**. The Edge Function reads
  the user id and the verified Google email from the signed-in session
  (`supabase/functions/_shared/campaigns.ts`) and drops any `user_id` / `email` the browser sends.
- Only the actions and fields listed in `ACTIONS` are forwarded: `claim`, `campaigns`, `profile`,
  `consent`, `withdraw`, `missions`, `submit`, and for pool campaigns `draw` and `return` (1 to 200
  mission ids). Each field is checked first (type, length, allowed
  values, formats, recording metadata ranges, with the dashboard's limits); a bad request gets a 400
  `{ error, code: "invalid_input", fieldErrors: { <field>: <problem> } }` naming every bad field,
  and the profile form marks those fields.
- Audio goes straight to Sayari through the existing proxy, with the campaign context as extra multipart
  fields (campaign, mission, prompt, speaker IDs and the take's measurements). The full list is
  `docs/SAYARI_UPLOAD_PAYLOAD.json`.
- The dashboard receives only the recording's
  **metadata** (duration, level, peak, silence margins, sample rate, sha-256 of the file, Sayari id when
  Sayari returns one) and checks it again.
- The campaign area has its **own persistent Google session** (`src/lib/campaign/auth-client.ts`). The
  app's other Supabase client keeps no session on purpose (it identifies a device, not a person).
- The app is the speaker app: `/` redirects to `/campaign`; the manifest starts there and has shortcuts
  to Missions and History. (The learning-app screens are still in the code but no longer reachable
  from the entry point.)
- **Reads are cached** (`src/lib/campaign/cache.ts`): one request per key however many screens ask,
  the last answer saved on the device per user and painted at once (also offline), refreshed in the
  background on app start, when the app returns to the foreground and when the network comes back.
  A `missions` answer also refreshes that campaign's card on the home screen. Sign-out clears it.
- **The installed app opens offline** (service worker, `next.config.ts`). Page loads are network
  first with a 4 s timeout and kept with no age limit, one copy per path; the shell saves home,
  history and each campaign's page and studio ahead of time (`src/lib/campaign/offline-pages.ts`,
  again after each new build); a page never saved falls back to `/~offline`. The page is not
  reloaded when the network comes back (that would end a take being recorded). Other origins
  (Supabase, the bridge) are never cached by the service worker.
- **Takes go through an outbox** (`src/lib/campaign/outbox*.ts`, IndexedDB `afriklang.campaign.outbox`):
  saved the moment the speaker submits, then sent in the background, audio first, metadata second,
  each step remembered so neither is repeated without need. The upload has no fixed time limit: it is
  aborted only when no bytes have moved for 30 s (or the server has not answered 90 s after the last
  byte), and the speaker sees its progress. A network failure stops the run (the next take would fail
  the same way and cost data); uploaded takes and the smallest files go first. Retries back off (5 s to
  5 min; 15 s to 15 min after an upload lost on the network, since each retry resends the file);
  "campaign paused" and similar hold the take for later (the saved campaign card is checked before
  each upload, so a take of a paused campaign or one without consent is not uploaded);
  **withdrawing the campaign consent** stops that campaign's uploads at once, then deletes its
  takes from the phone and says how many; a submit refused for the campaign consent deletes the take; a take the dashboard refuses is removed and
  the mission comes back to redo. A cross-tab lock keeps two tabs from sending the same take. An
  upload whose answer was lost is sent again, so Sayari may hold two copies with the same
  `source_sha256`; the dashboard stores the recording once.

## 3. Setup, in order

All steps can be done in the Supabase dashboard (no CLI needed).

### 3.1 Google sign-in (the app's Supabase project)
- **Authentication → Providers → Google**: enable it and paste the Google OAuth client ID and secret.
- **Authentication → URL Configuration → Redirect URLs**: add **exactly** `https://<app>/campaign`
  (no trailing slash, no query, no `#`), plus `http://localhost:3000/campaign` for local work. One entry
  per origin in use (production, staging, …).
- In **Google Cloud Console → your OAuth client → Authorized redirect URIs**, add Supabase's callback:
  `https://<project-ref>.supabase.co/auth/v1/callback` (a different setting from the one above).

### 3.2 Secrets (Edge Functions → Secrets)
| Name | Value |
|---|---|
| `BRIDGE_SECRET` | A long random value (`openssl rand -hex 32`). The **same value** goes into the dashboard as `PWA_BRIDGE_SECRET`. Never paste it in chat, tickets or commits. |
| `DASHBOARD_URL` | The dashboard's https origin with no path, for example `https://afriklang.com` |

### 3.3 Deploy the function (JWT verification must stay ON)
- **Dashboard editor**: Edge Functions → Deploy a new function → Via Editor, name it **`campaigns`**,
  paste the whole of `deploy/campaigns-single-file.ts`, deploy, then open the function's settings and check
  **Verify JWT** is ON. The file is generated (`node scripts/build-campaigns-single-file.mjs`); a test fails
  when it is out of date.
- **CLI**: `supabase functions deploy campaigns --project-ref <ref>` deploys the multi-file source.

### 3.4 Dashboard side
Set `PWA_BRIDGE_SECRET` (same value as above), `PWA_APP_URL` (this app's https origin),
`CAMPAIGN_REPLY_TO`, the SES settings and `CRON_SECRET`, and apply migrations 0044-0053. Full list and
order: `afriklang-landing-page/docs/CAMPAIGNS_DEPLOYMENT_CHECKLIST.md`.

### 3.5 Build environment
No new variables here. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SAYARI_*` are the
existing ones. After setting them, rebuild so the public ones are inlined.

## 4. Check it works (dry run)

Do this with staff accounts before inviting anyone:

1. Call the function without signing in: expect **401**. (If it answers 200, Verify JWT is off: turn it on.)
2. As an admin create a Draft campaign, run it through to Launched, and assign a staff contributor whose
   **Google email equals the contributor's email**.
3. Open the emailed link on a phone. Expect: sign-in, then the campaign card.
4. Sign in with a *different* Google account: expect the "use the account for a***@…" message, and
   no binding. An admin can unlink an account on the contributor's page in the dashboard.
5. Complete profile and both consents, then record a mission with a real microphone. Confirm it shows
   under Tracking in the dashboard.
6. Test on iOS Safari and Android Chrome: the microphone prompt and the 16 kHz capture are the parts
   that automated tests cannot reach.

## 5. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Google redirects back with "requested path is invalid" | `https://<app>/campaign` is not in Redirect URLs (check `www.`, trailing slash, the exact origin) |
| `redirect_uri_mismatch` from Google | Supabase's `/auth/v1/callback` URL is missing in Google Cloud Console |
| App shows "The service is not reachable" | `DASHBOARD_URL` wrong, dashboard down, or the function cannot reach it |
| 500 `server_misconfigured` from the function | `BRIDGE_SECRET` (min. 16 characters) or `DASHBOARD_URL` (https origin) not set |
| 401 from the dashboard through the function | `BRIDGE_SECRET` here ≠ `PWA_BRIDGE_SECRET` there |
| "Sign in with the Google account for a***@…" | The signed-in Google email differs from the contributor's email, or is not verified |
| Link says expired / not valid | Older than 14 days, replaced by a resend, or the contributor was removed: send a new invitation |

## 6. Where things live

| Path | What |
|---|---|
| `supabase/functions/campaigns/` | The Edge Function (the single door to the dashboard) |
| `supabase/functions/_shared/campaigns.ts` | Pure logic: allowed actions and fields, verified identity |
| `deploy/campaigns-single-file.ts` | Generated one-file build for the dashboard editor |
| `src/lib/campaign/` | Auth client, bridge API client, link-token handling, hooks, flow logic |
| `src/lib/audio/analyze.ts` | Level, peak, silence, sha-256 of a take; the same rules the dashboard applies |
| `src/app/campaign/**` | The screens: home/claim, campaign page, studio, history |
| `src/lib/campaign/cache.ts`, `queries.ts` | Read cache and the local edits after a write |
| `src/lib/campaign/outbox*.ts` | Takes waiting on the phone and the background sender |
| `src/lib/campaign/studio-flow.ts`, `view.ts`, `activity.ts` | Studio order and timing, screen facts, local activity log |
| `src/lib/campaign/pool.ts`, `pool-client.ts` | Pool campaigns (leases, when to draw) and paid time; the screens' hook |
| `src/components/campaign/PoolParts.tsx` | Lease notice, refusals, "get more", give back, paid time |
| `src/lib/campaign/dev-mock.ts` | Pretend backend for trying the app (development only) |
| `src/components/campaign/**` | Screen components |
| `src/messages/campaign/*.{en,fr}.json` | Strings, one file per area, English and French |

## 7. Try it without a backend

```bash
NEXT_PUBLIC_CAMPAIGN_MOCK=1 NEXT_PUBLIC_SUPABASE_URL=https://mock.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=mock npx next dev --webpack
```

Opens signed in as a fake speaker with two Wolof campaigns (setup not done yet): a planned one of 12
missions and a pool one (batches of 6, draw again under 3, 72 h leases). Audio uploads are accepted
locally. In the browser console:

- `__afkMock.review()` plays the reviewer (first submitted take sent back, the others accepted)
- `__afkMock.poolStatus("cell_full")` refuses the next draws with that status (`"ok"` lifts it; pass
  `true` as a second argument to list another campaign in `elsewhere`)
- `__afkMock.leaseSoon()` / `__afkMock.expire()` end the pool batch's leases in 5 hours / now
- `__afkMock.reset()` starts over

Never active in a production build. The mock's answers must follow the bridge contract exactly.

## 8. Tests

```bash
npx vitest run --config vitest.campaign.config.ts
```

Covers the Edge Function handler (Deno and Supabase faked), identity and field rules, link-token handling,
audio measurements, error mapping, the screens' decision logic, and English/French key parity.

**Not covered by automated tests:** a real microphone, real Google sign-in, and the live Edge Function
runtime. Check those by hand (section 4).

## 9. Known limits

- Google is the only sign-in; the functional spec also asks for phone or email with a code. The bridge
  keys on the user id, so changing the sign-in method changes nothing on the dashboard side.
- Two-device capture (one channel per speaker) is not supported; conversations are one phone, mono.
- Recording status after upload (pre-annotated, accepted, rejected) is set by the dashboard; the app
  only shows it.
- A take recorded but not yet submitted (still on the review screen) is saved on the phone the moment
  recording stops, and the studio offers it again if the app closed (`src/lib/campaign/drafts.ts`);
  leaving on purpose asks first and drops it. A recording cut short by a crash *while* recording is
  lost.
- Capture keeps only 16 kHz PCM16 in memory (about 32 KB a second), downsampled with an anti-alias
  filter as it is recorded and measured on the way; every take stops by itself (timed types at their
  maximum, a read sentence 1 s past it, nothing past 10 minutes).
- Takes waiting on the phone are sent while the app is open (no background sync when it is closed).
- The french copy of the invitation and reminder emails (dashboard side) is not reviewed by a native speaker.
