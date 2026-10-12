"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Older links to one mission now open the studio on that mission. */
export default function RecordMissionRedirect() {
  const { id, missionId } = useParams<{ id: string; missionId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/campaign/${id}/studio?m=${encodeURIComponent(missionId)}`);
  }, [id, missionId, router]);
  return null;
}
