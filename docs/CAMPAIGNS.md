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
5. Home: one card per campaign, each with a status (finish profile, consent needed, ready, paused, closed).
6. In a campaign: **profile** (language, variety, country, region, gender, age group, phone) →
   **account consent** (once) → **campaign consent** → **instructions** → **missions**.
7. **Recording**: read a sentence, answer a topic, or hold a conversation (one phone records, both
   speakers are credited). The app checks duration, level, clipping and silence before upload.
8. Each mission shows its state: to record, submitted, accepted, or **to redo** with the reason.

Only a pseudonymous **speaker ID** (for example `SPK-7Q2M9X4D`) travels with the audio, never a name.

## 2. Architecture

```
browser /campaign  ──►  Edge Function `campaigns`  ──►  dashboard /api/pwa/campaigns/*
 Google session          verifies the session,           checks Authorization: Bearer <secret>
                         holds BRIDGE_SECRET             (PWA_BRIDGE_SECRET on the dashboard)

browser  ──►  /api/audio-upload (existing proxy)  ──►  Sayari      (the audio itself)
```

- The browser **never holds the bridge secret** and **never says who it is**. The Edge Function reads
  the user id and the verified Google email from the signed-in session
  (`supabase/functions/_shared/campaigns.ts`) and drops any `user_id` / `email` the browser sends.
- Only the actions and fields listed in `ACTIONS` are forwarded: `claim`, `campaigns`, `profile`,
  `consent`, `withdraw`, `missions`, `submit`. Each field is checked first (type, length, allowed
  values, formats, recording metadata ranges, with the dashboard's limits); a bad request gets a 400
  `{ error, code: "invalid_input", fieldErrors: { <field>: <problem> } }` naming every bad field,
  and the profile form marks those fields.
- Audio goes straight to Sayari through the existing proxy. The dashboard receives only the recording's
  **metadata** (duration, level, peak, silence margins, sample rate, sha-256 of the file, Sayari id when
  Sayari returns one) and checks it again.
- The campaign area has its **own persistent Google session** (`src/lib/campaign/auth-client.ts`). The
  app's other Supabase client keeps no session on purpose (it identifies a device, not a person).
- The campaign area is outside the learning app's onboarding/consent gates.

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
| `src/app/campaign/**` | The screens: home/claim, campaign hub, recording |
| `src/components/campaign/**` | Screen components |
| `src/messages/campaign/*.{en,fr}.json` | Strings, one file per area, English and French |

## 7. Tests

```bash
npx vitest run --config vitest.campaign.config.ts
```

Covers the Edge Function handler (Deno and Supabase faked), identity and field rules, link-token handling,
audio measurements, error mapping, the screens' decision logic, and English/French key parity.

**Not covered by automated tests:** a real microphone, real Google sign-in, and the live Edge Function
runtime. Check those by hand (section 4).

## 8. Known limits

- Google is the only sign-in; the functional spec also asks for phone or email with a code. The bridge
  keys on the user id, so changing the sign-in method changes nothing on the dashboard side.
- Two-device capture (one channel per speaker) is not supported; conversations are one phone, mono.
- Recording status after upload (pre-annotated, accepted, rejected) is set by the dashboard; the app
  only shows it.
- A take that was recorded but not yet submitted is lost if the contributor leaves the screen.
- The french copy of the invitation and reminder emails (dashboard side) is not reviewed by a native speaker.
