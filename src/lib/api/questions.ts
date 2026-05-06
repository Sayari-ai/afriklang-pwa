"use client";

/**
 * Per-question swap endpoint.
 *
 * Mirrors `lib/core/api/questions_api.dart` (kept in sync though the
 * Flutter app currently doesn't surface a swap UI).
 *
 *   - `swapQuestion(deviceId, cycle, levelId, qIndex)` →
 *     POST `question_swap`, body `{ device_id, cycle, level_id, q_index }`
 *
 * Server picks a random `path_questions` row at the same `level_id`
 * never previously served to this device (across all cycles + prior
 * swaps), persists the swap, and returns the replacement question in
 * `LevelQuestionData` shape with the **original** `q_index` preserved
 * so the audio filename slug `pNN-Lx-qy` keeps pointing at the slot.
 *
 * Throws `EdgeFunctionError`. Two non-success codes are meaningful to
 * the caller:
 *   - **409 swap_pool_exhausted** — every question at this level_id has
 *     already been served. Caller should fall back to plain skip.
 *   - **0 (network)** — offline / DNS / CORS. Caller should fall back
 *     to plain skip (the level page already does this when
 *     `navigator.onLine === false` *before* invoking).
 *
 * Online-only by design (no offline queue): the server is the source
 * of truth for "which questions has this device seen", so deferring
 * the pick to a queued runner would give stale answers.
 */

import { invokeEdge } from "./edge";
import {
  type LevelQuestionData,
  parseLevelQuestion,
} from "../content/models";

export async function swapQuestion(
  deviceId: string,
  cycle: number,
  levelId: number,
  qIndex: number,
): Promise<LevelQuestionData> {
  const data = await invokeEdge<unknown>("question_swap", {
    method: "POST",
    body: {
      device_id: deviceId,
      cycle,
      level_id: levelId,
      q_index: qIndex,
    },
  });
  return parseLevelQuestion(data);
}
