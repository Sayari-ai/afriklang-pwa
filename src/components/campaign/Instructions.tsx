"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { withdrawConsent } from "@/lib/campaign/api";
import type { CampaignCard, CampaignFailure } from "@/lib/campaign/types";
import { FailureMessage, buttonSecondary } from "./CampaignHubParts";

const SPEECH_ORDER = ["read", "spontaneous", "conversational"] as const;

/** The rules and per-type guidance. Open the first time, collapsed afterwards (remembered per campaign on this device). */
export function Instructions({ card, onWithdrawn }: { card: CampaignCard; onWithdrawn: () => void }) {
  const t = useTranslations("campaign.flow.instructions");
  const storeKey = `afriklang.instructions.seen.${card.campaign_id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storeKey) === null;
    } catch {
      return true;
    }
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // a second tap before the re-render must not send twice
  const [failure, setFailure] = useState<CampaignFailure | null>(null);

  const rec = card.instructions.recording;
  const mic = rec.mic_distance_cm;
  const micText = mic?.min != null && mic?.max != null ? t("mic", { min: mic.min, max: mic.max }) : mic?.min != null ? t("micMin", { min: mic.min }) : mic?.max != null ? t("micMax", { max: mic.max }) : null;

  // Shown open on the first visit, then collapsed on later ones.
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, "1");
    } catch {
      // storage unavailable: it just stays open next time
    }
  }, [storeKey]);

  async function withdraw() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const res = await withdrawConsent(card.campaign_id);
      if (res.ok) onWithdrawn();
      else setFailure(res);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const types = SPEECH_ORDER.flatMap((type) => card.instructions.speech_types.filter((s) => s.type === type));

  return (
    <section className="space-y-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="instr-body" className="flex min-h-12 w-full items-center justify-between rounded-xl bg-slate-100 px-4 text-left text-base font-bold text-slate-900">
        {t("toggle")}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div id="instr-body" className="space-y-4 text-sm text-slate-700">
          <div>
            <h2 className="mb-1 text-base font-bold text-slate-900">{t("rules")}</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("quiet")}</li>
              {rec.background ? <li>{t("background", { text: rec.background })}</li> : null}
              {micText ? <li>{micText}</li> : null}
              <li>{t("level", { level: rec.min_level_dbfs })}</li>
              <li>{t("silence", { s: rec.silence_margin_s })}</li>
            </ul>
          </div>
          {types.length ? (
            <div>
              <h2 className="mb-1 text-base font-bold text-slate-900">{t("byType")}</h2>
              <ul className="space-y-3">
                {types.map((s) => (
                  <li key={s.type} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-bold text-slate-900">{t(`types.${s.type}.name`)} · {t("duration", { min: s.duration_min_s, max: s.duration_max_s })}</p>
                    <p>{t(`types.${s.type}.help`)}</p>
                    {s.missions_per_session ? <p className="text-slate-500">{t("perSession", s.missions_per_session)}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-slate-200 pt-4">
        {confirming ? (
          <div role="alertdialog" aria-labelledby="wd-title" aria-describedby="wd-body" className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <h2 id="wd-title" className="text-base font-bold text-red-900">{t("withdrawTitle")}</h2>
            <p id="wd-body" className="text-sm text-red-900">{t("withdrawBody")}</p>
            {failure ? <FailureMessage failure={failure} /> : null}
            <div className="flex flex-col gap-2">
              <button type="button" onClick={withdraw} disabled={busy} className="min-h-12 rounded-xl bg-red-700 px-4 text-base font-bold text-white disabled:opacity-50">
                {busy ? t("withdrawing") : t("withdrawConfirm")}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} autoFocus className={buttonSecondary}>{t("cancel")}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="min-h-11 text-sm font-semibold text-red-700 underline underline-offset-2">
            {t("withdraw")}
          </button>
        )}
      </div>
    </section>
  );
}
