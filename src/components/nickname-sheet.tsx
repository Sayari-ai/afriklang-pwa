"use client";

/**
 * Nickname picker sheet.
 *
 * Shared UI for two surfaces:
 *   - First-visit modal on `/home` (mode: `"first-run"`).
 *   - Profile-tab edit affordance (mode: `"edit"`).
 *
 * The two modes only differ in copy and dismiss semantics:
 *   - `"first-run"` shows a "Maybe later" button that calls
 *     `markPrompted()` without setting a name. The user won't be
 *     re-prompted on next cold start.
 *   - `"edit"` shows a "Cancel" button that just closes the sheet.
 *
 * Built on the shared `<Sheet>` shell (white bottom card, scrim,
 * drag handle, body lock, Escape-to-close).
 *
 * Persistence: the sheet writes the local store synchronously
 * (optimistic), then fires the backend `setNickname()`. On backend
 * failure we keep the local value and surface a snackbar the
 * server-side row is best-effort until the Edge Function ships.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { setNickname } from "@/lib/api/nickname";
import { EdgeFunctionError } from "@/lib/api/edge";
import { track } from "@/lib/api/events";
import { useDeviceIdentity } from "@/stores/device-identity";
import {
  NICKNAME_MAX_LENGTH,
  validateNickname,
  useNickname,
} from "@/stores/nickname";
import { useSnackbar } from "@/stores/snackbar";

export type NicknameSheetMode = "first-run" | "edit";

export function NicknameSheet({
  mode,
  onClose,
}: {
  mode: NicknameSheetMode;
  onClose: () => void;
}) {
  const t = useTranslations();
  const initial = useNickname((s) => s.value) ?? "";
  const persistLocal = useNickname((s) => s.set);
  const markPrompted = useNickname((s) => s.markPrompted);

  const [draft, setDraft] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  // Auto-focus the input when the sheet opens. We do this once via
  // ref rather than `autoFocus` because Safari iOS tends to ignore
  // `autoFocus` on dynamically inserted inputs.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validation = validateNickname(draft);
  const canSubmit = validation.ok && !submitting;

  const submit = async () => {
    if (!validation.ok || submitting) return;
    setSubmitting(true);

    // Optimistic local persistence. Done *before* the network so a
    // mid-request reload still surfaces the chosen name; the server
    // round-trip is best-effort until the function is deployed.
    persistLocal(validation.value);
    if (mode === "first-run") markPrompted();

    const deviceId = useDeviceIdentity.getState().deviceId;
    if (!deviceId) {
      // Identity not hydrated yet extremely unlikely on `/home` or
      // `/profile`, both of which sit behind the route guard. Bail
      // gracefully rather than POSTing with `device_id: ""`.
      onClose();
      return;
    }

    try {
      const echoed = await setNickname({
        deviceId,
        nickname: validation.value,
      });
      // If the server normalised the value (e.g. extra trim,
      // case-fold), reflect that locally so the next read matches
      // what other devices will see.
      if (echoed !== validation.value) persistLocal(echoed);
      track("nickname_saved", { mode });
      onClose();
    } catch (err) {
      // Surface a snackbar; keep the local value. The user can
      // re-open the profile row to retry.
      const isNetwork =
        err instanceof EdgeFunctionError && err.status === 0;
      useSnackbar
        .getState()
        .show(
          isNetwork
            ? t("nicknameSaveOfflineSnack")
            : t("nicknameSaveFailedSnack"),
        );
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const dismissLabel =
    mode === "first-run"
      ? t("nicknameSheetMaybeLater")
      : t("commonCancel");
  const submitLabel = submitting
    ? t("nicknameSheetSaving")
    : t("nicknameSheetSave");

  const errorCopy: string | null = (() => {
    if (validation.ok) return null;
    if (validation.reason === "empty" && draft.length === 0) {
      // Don't shout at the user before they've typed anything.
      return null;
    }
    if (validation.reason === "too_short")
      return t("nicknameErrorTooShort");
    if (validation.reason === "too_long")
      return t("nicknameErrorTooLong");
    return t("nicknameErrorEmpty");
  })();

  // Soft cap the input via maxLength. This is on top of
  // `validateNickname` (which is the authoritative gate) without
  // it, mobile keyboards happily let the user paste 5 KB of emoji.
  // Use a slightly larger limit than NICKNAME_MAX_LENGTH because
  // surrogate pairs count for 2 in `maxLength` but 1 in our
  // code-point validator.
  const maxLengthAttr = NICKNAME_MAX_LENGTH * 2;

  const handleSubmit = () => {
    void submit();
  };

  return (
    <Sheet
      title={
        mode === "first-run"
          ? t("nicknameSheetTitleFirstRun")
          : t("nicknameSheetTitleEdit")
      }
      onClose={onClose}
      dismissible={!submitting}
    >
      <p className="px-5 text-[14px] font-semibold text-text-muted">
        {t("nicknameSheetSubtitle")}
      </p>
      <div className="h-3" />

      <div className="px-5">
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          maxLength={maxLengthAttr}
          placeholder={t("nicknameSheetPlaceholder")}
          disabled={submitting}
          className="w-full rounded-2xl border-2 border-border bg-bg-subtle px-4 py-3 text-[16px] font-bold text-text placeholder:text-text-faint outline-none transition-colors focus:border-blue-border focus:bg-blue-light/40"
        />
        <div className="h-1.5" />
        <div className="flex min-h-[16px] items-center justify-between">
          <span className="text-[12px] font-bold text-red">
            {errorCopy ?? ""}
          </span>
          <span className="text-[12px] font-semibold text-text-faint">
            {[...draft.replace(/\s+/g, " ").trim()].length}/
            {NICKNAME_MAX_LENGTH}
          </span>
        </div>
      </div>

      <div className="h-4" />

      <div className="flex items-center justify-end gap-3 px-5">
        <button
          type="button"
          onClick={() => {
            if (submitting) return;
            if (mode === "first-run") markPrompted();
            onClose();
          }}
          disabled={submitting}
          className="rounded-xl px-4 py-2 text-[14px] font-extrabold uppercase tracking-[0.8px] text-text-faint transition-opacity active:opacity-60 disabled:opacity-50"
        >
          {dismissLabel}
        </button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
        >
          {submitLabel}
        </Button>
      </div>
      <div className="h-1" />
    </Sheet>
  );
}
