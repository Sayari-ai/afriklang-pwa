# Campaigns in the app: setup and how it works

Contributors receive an email from the Afriklang dashboard with a personal link. The link opens
`<app>/campaign#t=<token>`; they sign in with Google, the dashboard checks that the Google email is
the one the invitation was sent to, and the app then walks them through profile, consents and
recording. The dashboard side and the full contract live in `afriklang-landing-page`
(`docs/CAMPAIGN_BRIDGE_CONTRACT.md`).

```
browser /campaign  ->  Edge Function `campaigns`  ->  dashboard /api/pwa/campaigns/*
 Google session        verifies the session,          checks Authorization: Bearer <secret>
                       holds BRIDGE_SECRET            (PWA_BRIDGE_SECRET on the dashboard)
```

The browser never holds the bridge secret and never says who it is: the Edge Function reads
the user id and the **verified** Google email from the session (`supabase/functions/_shared/campaigns.ts`).
Audio goes from the app straight to Sayari through the existing `/api/audio-upload` proxy; only the
recording's metadata goes to the dashboard.

## Setup, in order

1. **Google sign-in** (this Supabase project: Authentication -> Providers -> Google): enable, paste the
   Google OAuth client ID and secret. In Authentication -> URL Configuration add
   `https://<app>/campaign` to **Redirect URLs** (and `http://localhost:3000/campaign` for local work).
2. **Secrets** (Edge Functions -> Secrets, or `supabase secrets set NAME=value`):
   - `BRIDGE_SECRET`: a long random value (`openssl rand -hex 32`). The same value goes into the
     dashboard as `PWA_BRIDGE_SECRET`. Never paste it in chat, tickets or commits.
   - `DASHBOARD_URL`: the dashboard's https origin, no path (for example `https://afriklang.com`).
3. **Deploy the function** (JWT verification must stay ON, the default). Either:
   - CLI: `supabase functions deploy campaigns --project-ref <ref>`; or
   - Dashboard: Edge Functions -> Deploy a new function -> Via Editor, name it `campaigns`, paste the whole of
     `deploy/campaigns-single-file.ts` (generated: `node scripts/build-campaigns-single-file.mjs`; a test fails
     when it is stale), deploy, then check the function's **Verify JWT** setting is ON.
4. **Dashboard side**: `PWA_BRIDGE_SECRET` (same value), `PWA_APP_URL` (this app's https origin),
   `CAMPAIGN_REPLY_TO`, SES, `CRON_SECRET`; migrations 0044-0053 applied. See the dashboard's
   `docs/CAMPAIGNS_DEPLOYMENT_CHECKLIST.md`.
5. **Build env**: no new variables here. `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SAYARI_*` are the existing ones.

## What lives where

| Path | What |
|---|---|
| `supabase/functions/campaigns/` | the Edge Function (single door to the dashboard) |
| `supabase/functions/_shared/campaigns.ts` | pure logic: allowed actions/fields, verified identity |
| `src/lib/campaign/` | auth client (persistent Google session), bridge API client, link-token handling, hooks |
| `src/lib/audio/analyze.ts` | level, peak, silence and sha-256 of a take; the same checks the dashboard applies |
| `src/app/campaign/**` | the screens: landing/home, campaign hub, recording |
| `src/messages/campaign/*.{en,fr}.json` | the screens' strings (one file per area, English and French) |

The campaign area is deliberately outside the learning app's onboarding/consent gates, and it keeps its
own persistent Google session (`src/lib/campaign/auth-client.ts`); the app's other Supabase client keeps
no session on purpose.

## Tests

```bash
npx vitest run --config vitest.campaign.config.ts
```

Covers the Edge Function handler (with Deno and Supabase faked), identity/field rules, link-token
handling, audio measurements, error mapping, the screens' decision logic and en/fr message parity.
What is **not** covered by automated tests: a real microphone, real Google sign-in, and the live
Edge Function runtime. Test those by hand before launch (see the dry-run step in the dashboard checklist).
