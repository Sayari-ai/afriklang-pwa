---
name: uuid
description: RFC 9562/4122 UUID generation. USE FOR: generating v4 (random) device IDs, file/upload identifiers, opaque keys; v1/v6/v7 timestamp UUIDs for sortable IDs; v3/v5 namespace UUIDs for deterministic hashing; validate(), version(), parse()/stringify() helpers; NIL/MAX constants. DO NOT USE FOR: short user-facing codes (use nanoid), cryptographic secrets (use crypto.getRandomValues directly), database primary keys without coordinating with backend (Postgres has gen_random_uuid()).
---

# uuid@^11.1.1

## When to use

The project uses `uuid` to generate **stable opaque identifiers** in the browser:
- The `device_id` UUID issued on first launch and persisted across sessions (sent in every Edge Function payload as the auth/identity surrogate).
- Per-recording IDs embedded in audio upload filenames (`Lang_Speaker_Date_Topic.wav` plus a UUID).
- Any other opaque "I need a globally-unique handle" — queue IDs, in-flight request IDs, etc.

`v4` (cryptographically-random) is the canonical choice in this codebase. Reach for the others only when you have a specific reason:
- **v1 / v6 / v7** — sortable by creation time (v7 is RFC 9562's recommended modern choice).
- **v3 / v5** — deterministic from `(name, namespace)`. v5 (SHA-1) is preferred over v3 (MD5).
- **NIL / MAX** — sentinel values for "no UUID" / "any UUID".

Don't use `uuid` for:
- Short shareable codes (use `nanoid` — UUIDs are 36 chars and ugly)
- Cryptographic secrets (UUIDs leak version + variant bits)
- Database primary keys generated server-side (let Postgres do `gen_random_uuid()`)

## API reference

`uuid@11` is **ESM-only** with **named imports only** (no default export). TypeScript types ship with the package — do **not** install `@types/uuid` (uninstall if present).

```ts
import { v4 as uuidv4 } from "uuid";              // standard
import { v4, v5, validate, version, NIL } from "uuid";  // multi
```

CommonJS `require()` still works in Node but pure-ESM environments (browsers, modern bundlers) only see ESM.

### `v4(options?, buffer?, offset?): string | Uint8Array`

Random UUID. The default and the one this project uses everywhere.

```ts
import { v4 as uuidv4 } from "uuid";
uuidv4(); // "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
```

Options (rarely needed):
- `random: Uint8Array` — 16 pre-generated random bytes.
- `rng: () => Uint8Array` — alternative source of 16 random bytes.

If `buffer` is supplied, the binary form is written into it and the buffer is returned.

### `v1(options?, buffer?, offset?): string | Uint8Array`

Timestamp + random node UUID. Sortable-ish by time, but the timestamp is at the **end** of the high bits — string-sorting doesn't match time order. Prefer v6 or v7 if you need sortability.

Options: `node`, `clockseq`, `msecs`, `nsecs`, `random`, `rng`. See README.

### `v3(name, namespace, buffer?, offset?): string | Uint8Array`

MD5-based deterministic UUID. **Use v5 instead** unless you need v3 for legacy compatibility.

### `v5(name, namespace, buffer?, offset?): string | Uint8Array`

SHA-1-based deterministic UUID. Same `(name, namespace)` always produces the same UUID — useful for derived IDs.

```ts
import { v5 as uuidv5 } from "uuid";
const NS = "1b671a64-40d5-491e-99b0-da01ff1f3341";
uuidv5("hello", NS); // deterministic
uuidv5("hello", uuidv5.URL); // built-in URL namespace
uuidv5("hello", uuidv5.DNS); // built-in DNS namespace
```

### `v6(options?, buffer?, offset?): string | Uint8Array`

v1 with the timestamp bytes reordered so string comparison matches time order. Same options as v1.

### `v7(options?, buffer?, offset?): string | Uint8Array`

Unix-epoch-millisecond + random. **The modern RFC 9562 recommendation for new sortable IDs.** Lexicographically sortable, monotonic within a single tick (when the package's internal sequence counter is used).

```ts
import { v7 as uuidv7 } from "uuid";
uuidv7(); // "01695553-c90c-705a-b56d-778dfbbd4bed"
```

Options: `msecs`, `random`, `rng`, `seq`.

### `v1ToV6(uuid)` / `v6ToV1(uuid)`

Convert between v1 and v6 representations of the same logical timestamp UUID.

### `validate(str): boolean`

```ts
import { validate as uuidValidate } from "uuid";
uuidValidate("not a uuid");                              // false
uuidValidate("6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b");    // true
```

Accepts NIL and MAX as valid.

### `version(str): number`

```ts
import { version as uuidVersion } from "uuid";
uuidVersion("6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b"); // 4
```

Throws `TypeError` on an invalid UUID. Returns `0` for NIL, `15` for MAX.

Combine for per-version validation:

```ts
const isV4 = (s: string) => uuidValidate(s) && uuidVersion(s) === 4;
```

### `parse(str): Uint8Array`

UUID string → 16-byte `Uint8Array`. Throws `TypeError` if not valid.

### `stringify(arr, offset?): string`

16-byte `Uint8Array` → UUID string. Inverse of `parse`.

### `NIL`, `MAX`

```ts
import { NIL, MAX } from "uuid";
NIL; // "00000000-0000-0000-0000-000000000000"
MAX; // "ffffffff-ffff-ffff-ffff-ffffffffffff"
```

Sentinels — useful for "absent" or "wildcard" semantics.

## Common patterns (project-specific)

### Persistent device id

```ts
import { v4 as uuidv4 } from "uuid";

function ensureDeviceId(): string {
  const existing = localStorage.getItem("device_id");
  if (existing && uuidValidate(existing)) return existing;
  const fresh = uuidv4();
  localStorage.setItem("device_id", fresh);
  return fresh;
}
```

The real implementation lives in the `useDeviceIdentity` Zustand store (see `src/stores/device-identity.ts`) — same idea, gated by `safe-storage` for SSR.

### Audio upload filename

```ts
const recordingId = uuidv4();
const filename = `${langIso}_${speakerId}_${dateStamp}_${topic}_${recordingId}.wav`;
```

### Parse / stringify round-trip (rare)

When passing UUIDs through a binary protocol or storing as raw bytes:

```ts
import { parse, stringify } from "uuid";
const bytes = parse("6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b"); // Uint8Array(16)
const back = stringify(bytes);                                // same string
```

### Validating user-supplied ids

```ts
function isValidV4(s: unknown): s is string {
  return typeof s === "string" && validate(s) && version(s) === 4;
}
```

## Gotchas

### v11 breaking changes (from v9/v10)

- **ESM-only.** No more CommonJS-first build. Bundlers that don't honor `exports` field fail. Modern Next/Vite are fine.
- **Named imports only — no default export.** `import uuid from "uuid"` is broken. Use `import { v4 } from "uuid"`.
- **TypeScript types are bundled.** Remove `@types/uuid` from `devDependencies`; it conflicts.
- **Binary UUIDs are now `Uint8Array`** (was `Buffer`-or-Array). Affects callers of `parse()`, `stringify()`, and `options.buf`/`buffer` arguments.
- **Node-only build removed.** The package detects environment from `globalThis.crypto` rather than shipping separate browser/node bundles.
- **Timestamp UUID `options` semantics changed.** When you pass `options` to `v1/v6/v7`, the package's internal monotonicity state is bypassed (defaults are applied per-call). Only relevant if you supply `msecs`, `random`, or `seq`.

### General

- **No `@types/uuid` in v11.** Remove if it lingers — type collisions otherwise.
- **`v4()` requires `crypto.getRandomValues`.** Available in modern browsers and Node ≥ 16. React Native needs `react-native-get-random-values` imported **before** `uuid`.
- **UUID strings are 36 characters** (32 hex + 4 dashes). Don't truncate — collision rates skyrocket.
- **v4 is **not** sortable.** Two UUIDs minted a millisecond apart can sort in either order. Use v7 if you need sortable.
- **`version()` throws on invalid input.** Always pre-check with `validate()`.
- **`parse()` throws on invalid input** too.
- **Don't use UUIDs as cryptographic tokens.** They embed version (4 bits) and variant (2 bits) — only 122 bits of randomness in v4. Use `crypto.getRandomValues(new Uint8Array(32))` for secrets.
- **Server-side generation is preferable for DB PKs.** `gen_random_uuid()` in Postgres avoids client clock skew (matters for v1/v6/v7).

## References

- Local: `node_modules/uuid/README.md`
- Changelog: `node_modules/uuid/CHANGELOG.md`
- Project usage: device-id store at `src/stores/device-identity.ts`; audio filenames in `src/lib/audio/`
- Upstream: https://github.com/uuidjs/uuid#readme
- RFC 9562: https://www.rfc-editor.org/rfc/rfc9562.html
- React Native polyfill: https://github.com/LinusU/react-native-get-random-values#readme
