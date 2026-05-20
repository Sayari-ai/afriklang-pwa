// GET /functions/v1/paths_get?device_id=<uuid>[&multicycle=1]
//
// Without `multicycle=1` (legacy, used by the Flutter mobile app):
//   Returns the device's TOP per-device cycle, in the original
//   single-cycle response shape:
//     { device_id, path_id, cycle, levels: [...] }
//
// With `multicycle=1` (used by the PWA):
//   Returns every cycle the device has ever been issued, in order:
//     {
//       device_id,
//       top_cycle: number,
//       cycles: [
//         { cycle: 1, path_id: 1, levels: [...] },
//         { cycle: 2, path_id: 4, levels: [...] },
//         ...
//       ]
//     }
//
// In both cases each `levels[]` entry has shape
// { level_id, theme, points_reward, questions: [...] }.

import {
  corsHeaders,
  errorResponse,
  isUuid,
  jsonResponse,
  pointsRewardForLevel,
  serviceClient,
} from "../_shared/util.ts";

interface QuestionRow {
  level_id: number;
  q_index: number;
  theme: string;
  prompt_en: string;
  image_url: string;
}

interface LevelOut {
  level_id: number;
  theme: string;
  points_reward: number;
  questions: {
    q_index: number;
    prompt_en: string;
    image_url: string;
    language: "wo";
  }[];
}

function rowsToLevels(rows: QuestionRow[]): LevelOut[] {
  const map = new Map<number, LevelOut>();
  for (const row of rows) {
    let lvl = map.get(row.level_id);
    if (!lvl) {
      lvl = {
        level_id: row.level_id,
        theme: row.theme,
        points_reward: pointsRewardForLevel(row.level_id),
        questions: [],
      };
      map.set(row.level_id, lvl);
    }
    lvl.questions.push({
      q_index: row.q_index,
      prompt_en: row.prompt_en,
      image_url: row.image_url,
      language: "wo",
    });
  }
  return Array.from(map.values()).sort((a, b) => a.level_id - b.level_id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", "GET required", 405);
  }

  const url = new URL(req.url);
  const deviceId = url.searchParams.get("device_id");
  if (!isUuid(deviceId)) {
    return errorResponse("bad_device_id", "device_id must be a UUID", 400);
  }
  const multicycle = url.searchParams.get("multicycle") === "1";

  const supabase = serviceClient();

  // Pull every (cycle, path_id) the device has been issued. For legacy
  // callers we'll then reduce to the top one.
  const { data: dpRows, error: dpErr } = await supabase
    .from("device_paths")
    .select("path_id, cycle")
    .eq("device_id", deviceId)
    .order("cycle", { ascending: true });

  if (dpErr) {
    console.error("device_paths select failed", dpErr);
    return errorResponse("query_failed", dpErr.message, 500);
  }
  if (!dpRows || dpRows.length === 0) {
    return errorResponse(
      "not_assigned",
      "Device has no path assignment; call paths_assign first",
      404,
    );
  }

  // Fetch all questions for every distinct path_id the device has been
  // issued, in one query. (Two devices on the same path share rows in
  // path_questions; pulling them once avoids N round-trips.)
  const distinctPathIds = Array.from(
    new Set(dpRows.map((r) => r.path_id)),
  );
  const { data: qRows, error: qErr } = await supabase
    .from("path_questions")
    .select("path_id, level_id, q_index, theme, prompt_en, image_url")
    .in("path_id", distinctPathIds)
    .order("level_id", { ascending: true })
    .order("q_index", { ascending: true });

  if (qErr) {
    console.error("path_questions select failed", qErr);
    return errorResponse("query_failed", qErr.message, 500);
  }

  // Group questions by path_id once.
  const byPath = new Map<number, QuestionRow[]>();
  for (const row of (qRows ?? []) as (QuestionRow & { path_id: number })[]) {
    const list = byPath.get(row.path_id) ?? [];
    list.push(row);
    byPath.set(row.path_id, list);
  }

  // Pull every persisted question swap for this device and build a
  // lookup keyed by (cycle, level_id, original q_index). When we
  // assemble levels below, we replace the prompt/image of any matching
  // base question with the swap's replacement row from path_questions.
  // The original q_index is preserved on the response so the audio
  // filename slug (pNN-Lx-qy) keeps pointing at the slot, never the
  // replacement's identity.
  const { data: swapRows, error: swapErr } = await supabase
    .from("device_question_swaps")
    .select("cycle, level_id, q_index, replacement_path_id, replacement_q_index")
    .eq("device_id", deviceId);

  if (swapErr) {
    console.error("device_question_swaps select failed", swapErr);
    return errorResponse("query_failed", swapErr.message, 500);
  }

  const swapKey = (cycle: number, levelId: number, qIndex: number): string =>
    `${cycle}|${levelId}|${qIndex}`;
  const swaps = new Map<
    string,
    { replacement_path_id: number; replacement_q_index: number }
  >();
  for (const sw of swapRows ?? []) {
    swaps.set(swapKey(sw.cycle, sw.level_id, sw.q_index), {
      replacement_path_id: sw.replacement_path_id,
      replacement_q_index: sw.replacement_q_index,
    });
  }

  // Look up a replacement's (prompt_en, image_url) given its identity.
  // Replacement rows live in path_questions just like the base rows; we
  // already loaded the base rows for the device's own path_ids, but a
  // replacement may come from ANY path_id, so build a separate map of
  // replacement path_ids the device has actually swapped to.
  const replacementPathIds = new Set<number>();
  for (const sw of swapRows ?? []) {
    if (!byPath.has(sw.replacement_path_id)) {
      replacementPathIds.add(sw.replacement_path_id);
    }
  }
  const replacementByKey = new Map<
    string,
    { theme: string; prompt_en: string; image_url: string }
  >();
  if (replacementPathIds.size > 0) {
    const { data: rRows, error: rErr } = await supabase
      .from("path_questions")
      .select("path_id, level_id, q_index, theme, prompt_en, image_url")
      .in("path_id", Array.from(replacementPathIds));
    if (rErr) {
      console.error("replacement path_questions select failed", rErr);
      return errorResponse("query_failed", rErr.message, 500);
    }
    for (const r of rRows ?? []) {
      replacementByKey.set(`${r.path_id}|${r.level_id}|${r.q_index}`, {
        theme: r.theme,
        prompt_en: r.prompt_en,
        image_url: r.image_url,
      });
    }
  }
  // Also index the device's own path_questions by (path_id, level_id,
  // q_index) so a replacement that happens to live in one of those
  // already-loaded paths can be looked up without a second round-trip.
  for (const [pathId, rows] of byPath.entries()) {
    for (const r of rows) {
      replacementByKey.set(`${pathId}|${r.level_id}|${r.q_index}`, {
        theme: r.theme,
        prompt_en: r.prompt_en,
        image_url: r.image_url,
      });
    }
  }

  // Resolve the question array for a given (cycle, path_id) by starting
  // from the base path_questions rows, then overlaying any swap on top.
  function resolveLevelsFor(cycle: number, pathId: number): LevelOut[] {
    const base = byPath.get(pathId) ?? [];
    const levels = rowsToLevels(base);
    if (swaps.size === 0) return levels;
    for (const lvl of levels) {
      for (let i = 0; i < lvl.questions.length; i++) {
        const q = lvl.questions[i];
        const sw = swaps.get(swapKey(cycle, lvl.level_id, q.q_index));
        if (!sw) continue;
        const repl = replacementByKey.get(
          `${sw.replacement_path_id}|${lvl.level_id}|${sw.replacement_q_index}`,
        );
        if (!repl) continue;
        lvl.questions[i] = {
          q_index: q.q_index, // preserve original slot index
          prompt_en: repl.prompt_en,
          image_url: repl.image_url,
          language: "wo",
        };
      }
    }
    return levels;
  }

  if (!multicycle) {
    // Legacy single-cycle response: top cycle only.
    const top = dpRows[dpRows.length - 1];
    const levels = resolveLevelsFor(top.cycle, top.path_id);
    return jsonResponse({
      device_id: deviceId,
      path_id: top.path_id,
      cycle: top.cycle,
      levels,
    });
  }

  // Multi-cycle response.
  const cycles = dpRows.map((dp) => ({
    cycle: dp.cycle,
    path_id: dp.path_id,
    levels: resolveLevelsFor(dp.cycle, dp.path_id),
  }));

  return jsonResponse({
    device_id: deviceId,
    top_cycle: dpRows[dpRows.length - 1].cycle,
    cycles,
  });
});
