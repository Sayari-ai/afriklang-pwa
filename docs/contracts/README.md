# Cross-platform contracts: campaign audio

The dashboard (`afriklang-landing-page`), the speaker app (`afriklang-pwa`) and Sayari exchange two signed messages
for campaign audio. This folder is the single source for their format. Each repo copies this folder at a pinned
commit, and validates its fixtures against the schemas in CI. [test-vectors.json](test-vectors.json) must be
reproduced byte for byte by every implementation.

Background: [../CAMPAIGN_PIPELINE_COMPLETION_PLAN.md](../CAMPAIGN_PIPELINE_COMPLETION_PLAN.md), §3 (tickets) and §5
(verdicts).

## 1. Upload ticket (dashboard → app → Sayari)

The dashboard signs a ticket for exactly one file of one mission. The app passes it to Sayari unchanged, in the
`X-Campaign-Ticket` header of the upload. Sayari trusts the campaign fields of the ticket, never the form fields of
the upload.

**Format:** `base64url(payload_json) "." base64url(HMAC-SHA256(SAYARI_TICKET_SECRET, base64url(payload_json)))`

- base64url without padding (RFC 4648 §5).
- The MAC covers the **encoded** payload string. A verifier never re-serialises the JSON.
- The payload is defined by [upload-ticket.schema.json](upload-ticket.schema.json).
- Lifetime: `exp` is about 30 minutes after issue. Verifiers allow 60 s of clock skew.
- `jti` is single-use **per file**: a second use with a different `source_sha256` is refused (`409 ticket_used`).
  A retry of the same file is accepted and answered as a duplicate.
- `source_sha256` must equal the sha-256 of the uploaded bytes (`422 sha_mismatch`).
- The whole file (silence padding included) must last between `duration_min_s` − 0.5 s and `duration_max_s` + 0.5 s
  (`422 too_short` / `422 too_long`, nothing stored): the same rule as the app's capture check and the dashboard's
  metadata check. `duration_min_s` is optional in the ticket; the dashboard always sends it.
- `sample_consent` is optional: `true` only when the speaker has a non-withdrawn "samples" consent at ticket time (§5).
  Absent, `false` or `null` mean the take is never played as a sample. When present it comes just before `purpose`.
- `purpose` is optional and absent for collection campaigns. `"qualification"` marks a qualification-test take (§4).
  It is the last key of the payload when present.
- Product limits per speech type (hard, enforced by the dashboard's campaign validation): read 3–15 s, spontaneous
  15–30 s, conversational 30–45 s. A campaign may narrow them, never widen them.
- Compare MACs in constant time. Every failure answers `401 invalid_ticket`, without saying which check failed.
- Secret: `SAYARI_TICKET_SECRET`, held by the dashboard and Sayari only. The app and the Edge Function never hold it.

## 2. Verdict push (Sayari → dashboard)

`POST <dashboard>/api/sayari/verdicts`, body defined by [verdict-request.schema.json](verdict-request.schema.json),
answer by [verdict-response.schema.json](verdict-response.schema.json).

**Headers:**
```
X-Sayari-Timestamp: <unix seconds>
X-Sayari-Signature: v1=<hex HMAC-SHA256(SAYARI_VERDICT_SECRET, timestamp + "." + raw_body)>
```

**Checks:**
- The receiver refuses a timestamp outside ±300 s, and compares in constant time over the **raw** bytes it read.
- The body is at most 256 KB and carries at most 200 events.

**Delivery:**
- An event is delivered once its `event_id` has an outcome.
- A non-2xx answer or a network error means "retry the whole batch".
- `event_id` makes retries idempotent.

**Rejection detail (optional, `rejected` only):**
- `reject_detail`: what Sayari measured when its automatic check refused the take, as
  `{ check, measured, limit, unit, bound }` (see the vocabulary table). The `limit` is the one in force when the
  check ran. Absent on `pre_annotated` and `accepted` events, and absent when the rejection came from a reviewer
  rather than a measurement. A receiver that does not know the field ignores it; it never changes the verdict.

**Secret:** `SAYARI_VERDICT_SECRET`, distinct from the ticket secret.

## 3. Status pull (dashboard → Sayari)

`POST <sayari>/api/campaign-audio/status`, `{ "ids": ["48211", ...] }` (at most 500), authenticated with a Sayari API
key that has only the `campaign_status_read` permission. The answer is defined by
[campaign-audio-status.schema.json](campaign-audio-status.schema.json). Each item may carry the same optional
`reject_detail` as a verdict event (§2), or `null`.

## 4. Qualification tests (dashboard → Sayari)

Background: [../QUALIFICATION_TEST_PLAN.md](../QUALIFICATION_TEST_PLAN.md). A speaker candidate records 10 takes
through the normal ticketed upload, with `purpose: "qualification"` in the ticket. Sayari runs its checks and its
pre-annotation as for any campaign take, then **holds** the take: qualification audio never enters the annotators'
queue. The dashboard decides who looks at it, with the calls below. All of them are JSON (`POST`, except the reviewer
list of §4.4, a `GET`), authenticated with a Sayari service API key that has only the `qualification_manage`
permission (`X-API-Key`), 30 requests/min per key.

### 4.1 Create a test: `POST <sayari>/api/qualification/tests`

Body ([qualification-test-request.schema.json](qualification-test-request.schema.json)):

```jsonc
{ "test_id": "<uuid>",                 // picked by the dashboard for this hand-out, kept on its attempt; a new hand-out gets a new id
  "source": "clips" | "reference" | "staff",
  "language": "sna",                   // ISO 639-3
  "translation_language": "en" | "fr", // clips / reference: the language the candidate translates into
  "mission_ids": ["<uuid>", ...],      // clips / staff: exactly the 10 missions of one speaker attempt
  "expires_at": "2026-10-28T12:00:00Z" // clips / reference: when the candidate's link stops working
}
```

* `clips`: an **annotator candidate** annotates these 10 takes (transcript, translation, proposed verdict and
  reason), then lists 5 pitfalls of the language. A staff reviewer then validates every take.
* `reference`: the same, on 10 takes Sayari picks from the language's **reference set** (audio a reviewer marked as
  reference; its own annotation is the reviewer's starting point). No campaign verdict comes out of it.
* `staff`: no candidate; the 10 takes go straight to the reviewers' Qualification queue.
* Answer `201` ([qualification-test-response.schema.json](qualification-test-response.schema.json)):
  `{ "test_id", "status": "open" | "submitted", "items": 10, "link": "https://<sayari-web>/qualification#t=<token>" | null, "expires_at" | null }`.
  `link` (clips and reference only) is the candidate's personal access: the dashboard emails it and never logs it.
  Sayari stores only its hash.
* Creating a test with an existing `test_id` and the same source, while that test is still `open`, **rotates the
  link** and answers `200` with the new one (a resend). The `mission_ids` of a resend are not compared: the test keeps
  the items it was created with (a mission re-recorded since the hand-out must not block a resend; 2026-11-24). For a
  `staff` test with the same missions it answers `200` with the same body (a retry after a lost answer). Anything
  else is `409 test_exists`.
* `409 clips_not_ready`: a mission has no take in Sayari, or its take is not pre-annotated yet.
  `409 clips_taken`: a take already belongs to another live test. `409 clips_language`: a take is not in `language`. `409 reference_short`: fewer than 10 reference takes
  in that language. `422 invalid`: a malformed body.

### 4.2 Status: `POST <sayari>/api/qualification/tests/status`

`{ "test_ids": ["<uuid>", ...] }` (at most 200) → ([qualification-status-response.schema.json](qualification-status-response.schema.json))

```jsonc
{ "tests": [{ "test_id", "source", "status": "open" | "submitted" | "reviewed" | "cancelled",
              "items": 10, "annotated": 7, "reviewed_items": 0,
              "result": null | { "agree": 9, "total": 10, "cer": 0.083, "pitfalls_ok": true } }],
  "unknown": ["<uuid>", ...] }
```

* `open`: the candidate is working. `submitted`: the candidate sent everything (a `staff` test is submitted at once);
  waiting for a reviewer. `reviewed`: final.
* `submitted_at` (optional): when the candidate sent the test (staff tests: when they were created), null while
  `open`.
* `result` (clips and reference, once reviewed): `agree` = takes where the candidate's proposed verdict equals the
  reviewer's; `cer` = character error rate of the candidate's transcripts against the reviewer's, over the takes the
  reviewer transcribed (null when none); `pitfalls_ok` = the reviewer accepted the 5 pitfalls. `staff` tests have no
  result.
* Takes of `clips` and `staff` tests get their campaign verdicts (§2) when the reviewer completes the test:
  `accepted`, or `rejected` with the reviewer's reason.

### 4.3 Cancel: `POST <sayari>/api/qualification/tests/cancel`

`{ "test_id": "<uuid>" }` → `{ "test_id", "status": "cancelled" }`. The link stops working; the takes are held again
(the dashboard may hand them to another test). A reviewed test cannot be cancelled (`409 test_reviewed`).

### 4.4 Reviewers: `GET <sayari>/api/qualification/reviewers`

No body → ([qualification-reviewers-response.schema.json](qualification-reviewers-response.schema.json))

```jsonc
{ "reviewers": [{ "email": "ama@example.com", "name": "Ama Mensah" }, ...] }
// with ?include=test_reviewers:
{ "reviewers": [
  { "email": "ada@example.com", "name": "Ada Obi", "languages": ["ha", "hau", "yo", "yor"] },
  { "email": "ama@example.com", "name": "Ama Mensah", "languages": null }
] }
```

* Sayari is the source of truth for who reviews qualification tests: the dashboard takes this list instead of
  registering reviewers by hand.
* The list holds every **active** Sayari user whose role is `reviewer`. Admins are left out, even an admin whose role
  is also `reviewer`. Annotators and deactivated reviewers are left out.
* Sayari reviewers have no language scope: each one may review a test in **any** language.
* **Test reviewers** (role `test_reviewer`, nov. 2026) review the tests of their own languages only, and reach nothing
  else in Sayari. They are listed **only** when the caller asks `?include=test_reviewers`: a caller that does not
  read `languages` would otherwise take them for reviewers of every language. With `include`, every entry has
  `languages`: `null` for a reviewer (every language), else every spelling of the test reviewer's languages
  (Sayari's stored code and its ISO aliases, e.g. `["yo", "yor"]`), so the caller matches its own code. A test
  reviewer without a language is left out. Without `include` the answer is exactly as before (no `languages`).
* `email` is lower-cased, one entry per email (a reviewer wins over a test reviewer with the same email), the list
  sorted by `email`. `name` is the display name. Nothing else (no Sayari user id) is exposed.
* An empty list is a valid answer (`200 {"reviewers": []}`).

### 4.5 Erase test data: `POST <sayari>/api/qualification/erase`

([qualification-erase-request.schema.json](qualification-erase-request.schema.json) →
[qualification-erase-response.schema.json](qualification-erase-response.schema.json)). Same service key as §4.1
(`qualification_manage`). Called when a speaker withdraws the test consent in the app (test notice v3: "your test
stops and we delete your test recordings") and for an erasure request.

```jsonc
{ "speaker_ids": ["SPK-ABCDEFGH"], "mission_ids": ["<uuid>", ...], "test_ids": ["<uuid>", ...] }   // at least one id
→ { "erased": [812, 813], "held": [{ "audio_id": 814, "test_id": "<uuid>", "test_status": "submitted" }],
    "pending": [{ "audio_id": 815, "reason": "processing" }], "errors": [{ "audio_id": 816, "error": "blob_delete_failed" }],
    "remaining": 0, "tests": [{ "test_id": "<uuid>", "status": "cancelled" }], "unknown_tests": [], "complete": false }
```

* **Takes** (`speaker_ids`, `mission_ids`, union): the speaker's **qualification** takes only (`purpose:
  "qualification"`; campaign takes are never touched). Each is deleted for good: audio blob(s), the take's rows, every
  test item that uses it (any candidate's work and the reviewer's verdict on it) and its transcript checks.
* **Tests** (`test_ids`): an annotator candidate's tests. A test still `open` or `submitted` is cancelled (link
  revoked); the candidate's work is cleared (transcripts, translations, proposed verdicts, notes, pitfalls). The takes
  inside belong to the speaker and stay, with the reviewer's verdicts. A reviewed test keeps its result.
* **Held, never swapped**: a take inside another candidate's `open` or `submitted` test is left alone and listed in
  `held`. The dashboard cancels that test (§4.3) and calls again. Tests named in `test_ids` are handled first, so a
  candidate annotating their own clips is erased in one call.
* `pending`: a take Sayari is processing right now; `errors`: a take whose blob or rows could not be deleted (its row
  stays so the next call finds it); `remaining`: takes beyond this call's limit (200).
* `complete` is true only when `held`, `pending` and `errors` are empty and `remaining` is 0: call again until then.
  Idempotent: an erased take is no longer found. Afterwards the status pull (§3) answers `unknown` for an erased id;
  the dashboard marks those recordings erased first, so they are not quarantined.
* `422 invalid` when no id is given or one is malformed.

## 5. Sample consent (dashboard → app → Sayari)

A speaker may opt in, separately from the required consent, to "my recordings may be played as samples to
prospective customers". It is never required and never blocks recording.

* The dashboard sets `sample_consent: true` in the upload ticket (§1) when the speaker holds a non-withdrawn
  `samples` consent. Sayari stores it per take; `/v1/samples` plays only takes with `sample_consent = true`.
* Withdrawal: `POST <sayari>/api/campaign-audio/sample-consent`, body `sample-consent-request.schema.json`
  (`{"speaker_ids": [...], "sample_consent": false}`), with a Sayari service API key holding the
  `sample_consent_write` permission. Sets false on every take of those speakers; idempotent; answers `{"updated": n}`.
  `true` is refused (`400`): consent is only ever given through a new ticket.

## 6. QC limits (dashboard ← Sayari)

`GET <sayari>/api/campaign-audio/qc-limits`, with the service key used for the status pull (`campaign_status_read`),
answers `qc-limits-response.schema.json`: the limits Sayari's automatic check applies now. The dashboard caches them
(10 min) and passes them to the app on the campaign card (`qc_limits`), so the app's take advice matches what Sayari
refuses. The app falls back to its built-in defaults when the card has none.

## 7. Person erasure (dashboard → Sayari)

`POST <sayari>/api/erasure/person` ([person-erase-request.schema.json](person-erase-request.schema.json) →
[person-erase-response.schema.json](person-erase-response.schema.json)), with a Sayari service key holding the
`person_erase` permission (a separate permission: this route deletes paid data and user accounts). Called by the
dashboard's full erasure of a contributor (owner decisions D1–D7, lp `docs/CONTRIBUTOR_ERASURE_DECISIONS.md`), **after**
§4.5 has completed for the same person (test takes are not handled here).

```jsonc
{ "speaker_ids": ["SPK-ABCDEFGH"], "emails": ["person@example.com"] }   // at least one; ≤ 10 speaker ids, ≤ 5 emails
→ { "campaign": { "erased": [901], "kept_delivered": [902], "pending": [{ "audio_id": 903, "reason": "processing" }],
                  "errors": [], "remaining": 0 },
    "zips_deleted": 2,
    "users": [{ "uid": "<firebase uid>", "status": "erased", "firebase": "deleted" }],
    "unknown_emails": 0, "complete": false }
```

* **Campaign takes** (`speaker_ids`): every `purpose: "campaign"` take whose speaker ids hold one of them, a
  conversation take with a partner included (D5).
  * `kept_delivered` (D4, untouched): a take a customer may already hold, that is an `api_deliveries` row, a `/v1`
    item read of it, or an `annotated` take whose language a customer key listed or downloaded (`/v1/datasets/<lang>/
    items` or `/download`, HTTP 200) after it was annotated.
  * Every other take is deleted for good (D3): blob(s), rows, annotations, verdict outbox, transcript checks.
    `pending`: a take the pipeline holds right now; `errors`: a take not deleted (its row stays for the next call);
    `remaining`: takes beyond this call's limit (200).
  * Cached delivery ZIPs (`zips/<prefix>/sayari-<lang>-…`) of every language the speaker has a campaign take in are
    deleted first (`zips_deleted`): the next download builds them again.
* **User accounts** (`emails`, matched lower-cased): the Sayari user with that email (D6). The Firebase account is
  deleted (`firebase`: `deleted`, `not_found`, or `skipped` on dev where Firebase is shared with prod), the uid is
  replaced by `erased-user` wherever work or logs name it (claims and locks are cleared), the email is removed from the
  audit log, then the user row is deleted. `status`: `erased`, `refused_admin` (an admin account is never erased this
  way: a person handles it), or `failed` (Firebase or database error, nothing changed: call again). `uid` is returned so
  the dashboard can delete the PostHog person (Sayari identifies by uid). An email with no user counts in
  `unknown_emails` (an erased user is no longer found, so a repeat answers `unknown_emails` and no `users`).
* `complete` is true when `pending`, `errors` and `remaining` are empty and no user is `failed`. Idempotent: call again
  until then. Afterwards the status pull (§3) answers `unknown` for an erased take: the dashboard marks it erased first.
* `422 invalid` when nothing is named or an id or email is malformed.

## 8. Account erasure (dashboard → app)

`POST <app supabase>/functions/v1/erase-account`, header `Authorization: Bearer <ERASE_SECRET>`, body
`{ "user_id": "<app auth uid>" }`. Deployed with `--no-verify-jwt` (the dashboard holds no app session); the secret is
its own (app secret `ERASE_SECRET` = dashboard `PWA_ERASE_SECRET`), not the bridge secret of §1, so a leak of the
bridge secret cannot delete accounts. Deletes the app's sign-in account (Supabase `auth.users`; identities and
sessions go with it). Answers `200 {"deleted": true}`, or `200 {"deleted": false, "reason": "not_found"}` when there
is no such account (a repeat). `401` on a wrong secret, `422` on a malformed id, `500 server_misconfigured` when the
secret is not set. The app holds no audio, consent or profile of its own: those are in Sayari and the dashboard.

## Vocabulary shared by all three

| Field | Values |
|---|---|
| `status` (verdict) | `pre_annotated`, `accepted`, `rejected` |
| `reason` | `level`, `duration`, `silence`, `variety`, `banned_topic`, `reading_gap`, `speaker_balance`, `other` (`speaker_balance` is set by the dashboard only, never by Sayari) |
| `reject_detail.check` | `too_short` (s, min), `too_long` (s, max), `low_snr` (dB, min), `background_noise` (dBFS, max), `clipping` (ratio 0–1, max), `long_silence` (ratio 0–1, max), `wrong_format` (no measure), `processing_failed` (no measure). `measured` and `limit` are numbers in `unit`, or null; `bound` says whether `measured` must be `>= limit` (`min`) or `<= limit` (`max`) |
| `language` | ISO 639-3 (`wol`, `aka`, `ewe`, `fon`, `hau`, `ibo`, `swh`, `yor`, …) |
| `mission_type` | `read`, `spontaneous`, `conversational` |
| speaker id | `^SPK-[A-Z0-9]{8}$` |
