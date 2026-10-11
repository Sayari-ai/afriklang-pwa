"use client";

import { useTranslations } from "next-intl";
import { useCampaignList, type Loaded } from "@/lib/campaign/hooks";
import type { CampaignList } from "@/lib/campaign/api";
import { CampaignCardView } from "./CampaignCardView";
import { useFailureText } from "./CampaignHubParts";
import { ClaimNotLinked, ClaimSpinner } from "./ClaimNotice";

/** The list of campaigns. `data` is passed when a claim just returned it; otherwise it is fetched. */
export function ClaimCampaignList({ data }: { data?: CampaignList }) {
  return data ? <Cards data={data} /> : <FetchedList />;
}

function FetchedList() {
  const t = useTranslations("campaign.claim.home");
  const failureText = useFailureText();
  const common = useTranslations("campaign.common");
  const list: Loaded<CampaignList> = useCampaignList();
  const { state } = list;

  if (state === "ready") return <Cards data={list.data} />;
  if (state === "error") {
    if (list.error.code === "not_linked") return <ClaimNotLinked />;
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("errorTitle")}</h1>
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900">
          {failureText(list.error)}
        </p>
        <button type="button" onClick={list.reload} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">
          {common("retry")}
        </button>
      </section>
    );
  }
  return <ClaimSpinner title={t("loadingList")} />;
}

function Cards({ data }: { data: CampaignList }) {
  const t = useTranslations("campaign.claim.home");
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("greeting")}</h1>
        <p className="text-sm text-slate-600">{t("intro")}</p>
      </div>
      {data.campaigns.length === 0 ? (
        <div role="status" className="rounded-2xl bg-slate-50 px-4 py-8 text-center">
          <p className="text-base font-semibold text-slate-800">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-slate-600">{t("emptyBody")}</p>
        </div>
      ) : (
        data.campaigns.map((card) => <CampaignCardView key={card.assignment_id} card={card} />)
      )}
    </section>
  );
}
