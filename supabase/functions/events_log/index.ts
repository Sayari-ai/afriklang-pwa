// POST /functions/v1/events_log
// Body (single):  { device_id: uuid, event: string, props?: object }
// Body (batched): { device_id: uuid, events: [{ event: string, props?: object }, ...] }
//
// Appends anonymous product-analytics events to `device_events`.
// Fire-and-forget from the client's perspective: the PWA never blocks
// UX on this call and drops events silently when offline.
//
// Guardrails (this endpoint is anon-invokable, so it validates hard):
//   * event names must match ^[a-z][a-z0-9_]{0,63}$ (also DB-checked);
//   * max 20 events per request;
//   * props must be a plain JSON object, ≤ 2 KB serialized otherwise
//     the props are dropped (event still logged) rather than rejected;
//   * timestamps are server-side only (client clocks are unreliable).
//
// Response: 200 { inserted: n }

import {
  corsHeaders,
  errorResponse,
  isUuid,
  jsonResponse,
  serviceClient,
} from "../_shared/util.ts";

const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_EVENTS_PER_REQUEST = 20;
const MAX_PROPS_BYTES = 2048;

interface IncomingEvent {
  event?: unknown;
  props?: unknown;
}

function sanitizeProps(props: unknown): Record<string, unknown> {
  if (
    props === null ||
    props === undefined ||
    typeof props !== "object" ||
    Array.isArray(props)
  ) {
    return {};
  }
  try {
    const serialized = JSON.stringify(props);
    if (serialized.length > MAX_PROPS_BYTES) return {};
    return props as Record<string, unknown>;
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "POST required", 405);
  }

  let payload: {
    device_id?: unknown;
    event?: unknown;
    props?: unknown;
    events?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return errorResponse("bad_json", "Body must be JSON", 400);
  }

  if (!isUuid(payload.device_id)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }

  // Normalise both call shapes into one list.
  const incoming: IncomingEvent[] = Array.isArray(payload.events)
    ? (payload.events as IncomingEvent[])
    : [{ event: payload.event, props: payload.props }];

  if (incoming.length === 0) {
    return errorResponse("no_events", "events array is empty", 400);
  }
  if (incoming.length > MAX_EVENTS_PER_REQUEST) {
    return errorResponse(
      "too_many_events",
      `at most ${MAX_EVENTS_PER_REQUEST} events per request`,
      400,
    );
  }

  const rows: {
    device_id: string;
    event: string;
    props: Record<string, unknown>;
  }[] = [];
  for (const item of incoming) {
    if (typeof item?.event !== "string" || !EVENT_NAME_RE.test(item.event)) {
      return errorResponse(
        "bad_event_name",
        "event must match ^[a-z][a-z0-9_]{0,63}$",
        400,
      );
    }
    rows.push({
      device_id: payload.device_id,
      event: item.event,
      props: sanitizeProps(item.props),
    });
  }

  const supabase = serviceClient();
  const { error } = await supabase.from("device_events").insert(rows);

  if (error) {
    console.error("device_events insert failed", error);
    return errorResponse("insert_failed", error.message, 500);
  }

  return jsonResponse({ inserted: rows.length });
});
