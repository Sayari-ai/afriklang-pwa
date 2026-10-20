/**
 * What a dashboard may leave empty on a campaign card, filled at the API boundary so no screen
 * shows a blank ("Say this in ___", "(topic: )"). An older dashboard sends no language name for
 * languages outside its built-in list (N-7): the code, in capitals, stands in.
 */

import type { CampaignCard } from "./types";

export function filledCard(card: CampaignCard): CampaignCard {
  const name = typeof card.language?.name === "string" && card.language.name.trim() ? card.language.name : (card.language?.code ?? "").toUpperCase();
  const domain = typeof card.topic?.domain === "string" ? card.topic.domain : "";
  if (name === card.language?.name && domain === card.topic?.domain) return card;
  return { ...card, language: { ...card.language, name }, topic: { ...card.topic, domain } };
}
