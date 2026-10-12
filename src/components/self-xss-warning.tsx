"use client";

import { useEffect } from "react";

import { printSelfXssWarning } from "@/lib/security/self-xss-warning";

/** Prints the console warning against self-XSS once the app mounts. Renders nothing. */
export function SelfXssWarning() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") printSelfXssWarning();
  }, []);
  return null;
}
