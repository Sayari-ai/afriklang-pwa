"use client";

/**
 * Frame of the speaker app: a brand header with the account button, the page, and two tabs
 * (Missions, History) once signed in. The studio takes the whole screen, without this frame.
 *
 * The shell also keeps the outbox sending in the background for the signed-in speaker, and says
 * when the phone is offline (screens then show the saved copy of their data).
 */

import { ClipboardList, CloudOff, History, LogOut, UserRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LocalePicker } from "@/components/locale-picker";
import { signOut } from "@/lib/campaign/auth-client";
import { campaignCache } from "@/lib/campaign/cache";
import { useCampaignList, useCampaignSession } from "@/lib/campaign/hooks";
import { saveOfflinePages } from "@/lib/campaign/offline-pages";
import { useOutbox, useOutboxRunner } from "@/lib/campaign/outbox-client";

const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);

export function CampaignShell({ children }: { children: ReactNode }) {
  const session = useCampaignSession();
  const pathname = usePathname() ?? "";
  const userId = session.status === "signedIn" ? session.userId : null;
  useOutboxRunner(userId);
  useOfflinePages();

  // The studio is a full-screen, focused space.
  if (/^\/campaign\/[^/]+\/studio/.test(pathname)) return <>{children}</>;
  return <Frame signedIn={session.status === "signedIn"} email={session.status === "signedIn" ? session.email : null}>{children}</Frame>;
}

/** Keep the speaker's pages saved on the phone so the app opens offline (offline-pages.ts). */
function useOfflinePages() {
  const list = useCampaignList();
  const online = useOnline();
  const ids = list.state === "ready" ? list.data.campaigns.map((c) => c.campaign_id).join("\n") : null;
  useEffect(() => {
    if (ids === null || !online) return;
    // After the page has settled: never compete with what the speaker is loading.
    const t = setTimeout(() => void saveOfflinePages(ids ? ids.split("\n") : []), 3000);
    return () => clearTimeout(t);
  }, [ids, online]);
}

function Frame({ children, signedIn, email }: { children: ReactNode; signedIn: boolean; email: string | null }) {
  const t = useTranslations("campaign.home.shell");
  const pathname = usePathname() ?? "";
  const online = useOnline();
  const [account, setAccount] = useState(false);
  const tabs = [
    { href: "/campaign", label: t("missions"), Icon: ClipboardList, active: pathname === "/campaign" || (/^\/campaign\/[^/]+/.test(pathname) && !pathname.startsWith("/campaign/history")) },
    { href: "/campaign/history", label: t("history"), Icon: History, active: pathname.startsWith("/campaign/history") },
  ];

  return (
    <div className="flex h-dvh flex-col bg-slate-100 text-slate-900">
      <header className="flex items-center justify-between gap-3 bg-primary px-4 pt-[max(env(safe-area-inset-top),10px)] pb-3 text-white">
        <Link href="/campaign" className="flex items-center gap-2 font-black tracking-tight">
          <Image src="/icons/Logo.svg" alt="" width={28} height={28} className="rounded-lg bg-white p-0.5" />
          <span>Afriklang</span>
        </Link>
        {signedIn ? (
          <button type="button" onClick={() => setAccount(true)} aria-label={t("account")} aria-haspopup="dialog" className="grid size-10 place-items-center rounded-full bg-white/15 hover:bg-white/25">
            <UserRound size={20} aria-hidden />
          </button>
        ) : null}
      </header>
      {!online ? (
        <p role="status" className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-semibold text-amber-900">
          <CloudOff size={14} aria-hidden /> {t("offline")}
        </p>
      ) : null}
      {/* The app's root frame clips overflow, so this area scrolls itself. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-6">{children}</div>
      </main>
      {signedIn ? (
        <nav aria-label={t("missions")} className="border-t border-slate-200 bg-white px-6 pt-1.5 pb-[max(env(safe-area-inset-bottom),8px)]">
          <ul className="flex justify-around">
            {tabs.map(({ href, label, Icon, active }) => (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={`flex min-h-12 min-w-24 flex-col items-center justify-center rounded-xl px-3 text-xs font-bold ${active ? "text-primary" : "text-slate-500"}`}>
                  <span className={`mb-0.5 grid h-7 w-14 place-items-center rounded-full transition-colors ${active ? "bg-primary/10" : ""}`}>
                    <Icon size={20} strokeWidth={active ? 2.6 : 2} aria-hidden />
                  </span>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {account ? <AccountSheet email={email} onClose={() => setAccount(false)} /> : null}
    </div>
  );
}

function AccountSheet({ email, onClose }: { email: string | null; onClose: () => void }) {
  const t = useTranslations("campaign.home.shell");
  const list = useCampaignList();
  const box = useOutbox();
  const closeRef = useRef<HTMLButtonElement>(null);
  const speakerId = list.state === "ready" ? list.data.contributor.speaker_id : null;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function leave() {
    const waiting = box.items.length;
    if (waiting > 0 && !window.confirm(t("signOutPending", { n: waiting }))) return;
    campaignCache.clear();
    void signOut().finally(() => window.location.assign("/campaign"));
  }

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-[480px] items-end bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="acct-title" onClick={(e) => e.stopPropagation()} className="afk-pop w-full rounded-t-3xl bg-primary px-5 pt-4 pb-[max(env(safe-area-inset-bottom),20px)] text-white">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="acct-title" className="text-lg font-black">{t("account")}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("close")} className="grid size-10 place-items-center rounded-full bg-white/15">
            <X size={20} aria-hidden />
          </button>
        </div>
        {speakerId ? (
          <div className="mb-4 rounded-2xl bg-white/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{t("speakerId")}</p>
            <p className="font-mono text-2xl font-bold tracking-wide">{speakerId}</p>
            <p className="mt-1 text-xs text-white/75">{t("speakerIdHelp")}</p>
          </div>
        ) : null}
        {email ? <p className="mb-4 text-sm text-white/85">{t("signedInAs", { email })}</p> : null}
        <p className="mb-2 text-sm font-semibold">{t("language")}</p>
        <LocalePicker className="mb-6" />
        <button type="button" onClick={leave} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-bold text-primary">
          <LogOut size={18} aria-hidden /> {t("signOut")}
        </button>
      </div>
    </div>
  );
}
