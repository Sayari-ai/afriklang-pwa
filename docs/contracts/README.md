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

**Secret:** `SAYARI_VERDICT_SECRET`, distinct from the ticket secret.

## 3. Status pull (dashboard → Sayari)

`POST <sayari>/api/campaign-audio/status`, `{ "ids": ["48211", ...] }` (at most 500), authenticated with a Sayari API
key that has only the `campaign_status_read` permission. The answer is defined by
[campaign-audio-status.schema.json](campaign-audio-status.schema.json).

## Vocabulary shared by all three

| Field | Values |
|---|---|
| `status` (verdict) | `pre_annotated`, `accepted`, `rejected` |
| `reason` | `level`, `duration`, `silence`, `variety`, `banned_topic`, `reading_gap`, `speaker_balance`, `other` (`speaker_balance` is set by the dashboard only, never by Sayari) |
| `language` | ISO 639-3 (`wol`, `aka`, `ewe`, `fon`, `hau`, `ibo`, `swh`, `yor`, …) |
| `mission_type` | `read`, `spontaneous`, `conversational` |
| speaker id | `^SPK-[A-Z0-9]{8}$` |
