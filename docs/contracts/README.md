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
* Creating a test with an existing `test_id` and the same source and missions **rotates the link** and answers
  `200` with the new one (a resend). For a `staff` test it answers `200` with the same body (a retry after a lost
  answer). Anything else is `409 test_exists`.
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
```

* Sayari is the source of truth for who reviews qualification tests: the dashboard takes this list instead of
  registering reviewers by hand.
* The list holds every **active** Sayari user whose role is `reviewer`. Admins are left out, even an admin whose role
  is also `reviewer`. Annotators and deactivated reviewers are left out.
* Sayari reviewers have no language scope: each one may review a test in **any** language. The answer says nothing
  about languages.
* `email` is lower-cased, one entry per email, the list sorted by `email`. `name` is the display name. Nothing else
  (no Sayari user id) is exposed.
* An empty list is a valid answer (`200 {"reviewers": []}`).

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

## Vocabulary shared by all three

| Field | Values |
|---|---|
| `status` (verdict) | `pre_annotated`, `accepted`, `rejected` |
| `reason` | `level`, `duration`, `silence`, `variety`, `banned_topic`, `reading_gap`, `speaker_balance`, `other` (`speaker_balance` is set by the dashboard only, never by Sayari) |
| `reject_detail.check` | `too_short` (s, min), `too_long` (s, max), `low_snr` (dB, min), `background_noise` (dBFS, max), `clipping` (ratio 0–1, max), `long_silence` (ratio 0–1, max), `wrong_format` (no measure), `processing_failed` (no measure). `measured` and `limit` are numbers in `unit`, or null; `bound` says whether `measured` must be `>= limit` (`min`) or `<= limit` (`max`) |
| `language` | ISO 639-3 (`wol`, `aka`, `ewe`, `fon`, `hau`, `ibo`, `swh`, `yor`, …) |
| `mission_type` | `read`, `spontaneous`, `conversational` |
| speaker id | `^SPK-[A-Z0-9]{8}$` |
