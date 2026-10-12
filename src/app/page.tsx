"use client";

/**
 * Entry point. The app is the speaker app: opening it goes straight to the speaker's missions
 * (which handles sign-in and the invitation link). The brand splash shows only for the moment
 * the redirect takes.
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function EntryPage() {
  const router = useRouter();
  useEffect(() => {
    // Keep the query and the fragment: an invitation link opened on "/" (#t=...), and Google's
    // sign-in code (?code=...) when Supabase sends the sign-in back to the site's root (its
    // "Site URL") instead of /campaign. Dropping the code there sent people back to the welcome
    // screen after choosing their Google account, every time.
    router.replace(`/campaign${window.location.search}${window.location.hash}`);
  }, [router]);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center" style={{ backgroundColor: "var(--color-brand-primary)" }}>
      <div className="w-[45vw] max-w-[280px]" style={{ transform: "translateY(-7.5%)" }}>
        <Image src="/logo/logo.png" alt="Afriklang" width={560} height={560} priority className="h-auto w-full object-contain" />
      </div>
    </div>
  );
}
