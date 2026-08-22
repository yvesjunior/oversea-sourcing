// Connector #1: the AI web research, behind the standard contract.
//
// The agent itself (src/server/ai/research.ts) is unchanged — this module
// adapts the SearchBrief to the agent's context and the agent's candidates to
// the normalized SourceCandidate shape. It is the proof that the contract
// works with a real consumer: any later source (a registry API, an import)
// implements the same interface and the pipeline cannot tell the difference.

import { researchSuppliers } from "@/server/ai/research";
import type { CollectResult, SearchBrief, SupplierSourceConnector } from "@/server/sources/types";

export const globalWebConnector: SupplierSourceConnector = {
  meta: {
    code: "global_web",
    type: "global_web",
    name: "Recherche web mondiale (IA)",
  },
  async collect(brief: SearchBrief): Promise<CollectResult> {
    const { candidates, queries } = await researchSuppliers({
      title: brief.title,
      descriptionRaw: brief.descriptionRaw,
      locale: brief.locale,
      criteria: brief.criteria,
      ...(brief.attachmentText ? { attachmentText: brief.attachmentText } : {}),
      countryCodes: brief.countryCodes,
    });
    return {
      candidates: candidates.map((candidate) => ({
        name: candidate.name,
        countryCode: candidate.countryCode,
        website: candidate.website,
        descriptor: candidate.descriptor,
        description: candidate.description,
        confidence: candidate.confidence,
        sourceUrl: candidate.sourceUrl,
      })),
      queries,
    };
  },
};
