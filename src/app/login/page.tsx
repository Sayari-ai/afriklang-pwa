"use client";

/**
 * The app is the speaker app: its sign-in screen is /campaign ("Welcome to Afriklang recording").
 * This old address forwards there with the query and fragment, so a Google sign-in that Supabase
 * sends back to /login (?code=...) still completes on /campaign instead of being lost.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/campaign${window.location.search}${window.location.hash}`);
  }, [router]);
  return null;
}
