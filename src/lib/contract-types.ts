// Which contracts a deal requires, derived from WHO IS INVOLVED (brief §4
// step 3: "le système détermine les contrats requis selon les intervenants").
//
// A typed module rather than a table — the `taxonomy.ts` pattern. It becomes
// rows the day staff need to edit the mapping; until then a table would be
// ceremony around five lines of truth.
//
// V1 SHIPS TWO TYPES (owner 2026-08-29). The other five from brief §5 —
// transporteur, courtier en douane, inspection, NDA, annexes — are added by
// appending to CONTRACT_TYPE_SPECS with the party roles they need. Nothing
// that calls this file changes when they do; that is the point of expressing
// the rule as "which parties does this deal have".

import type { ContractPartyRole, ContractType } from "@/database/schema";

export type ContractTypeSpec = {
  type: ContractType;
  /** i18n key suffix — `contracts.type.<key>`. */
  key: string;
  /** Party roles this contract is between. The deal must be able to name
   *  every one of them, or the contract cannot be drafted. */
  parties: readonly ContractPartyRole[];
  /** Required on every deal, or only when its parties call for it? The two
   *  v1 types are unconditional; carrier and customs agreements will not be. */
  always: boolean;
};

export const CONTRACT_TYPE_SPECS: readonly ContractTypeSpec[] = [
  {
    // OSI's own mandate: what the client engages OSI to do, and on what terms.
    type: "mandate_osi_client",
    key: "mandate",
    parties: ["buyer", "osi"],
    always: true,
  },
  {
    // The commercial substance — what is bought, from whom, at what price.
    type: "purchase_order",
    key: "purchase_order",
    parties: ["buyer", "supplier"],
    always: true,
  },
];

export function contractTypeSpec(type: ContractType): ContractTypeSpec | undefined {
  return CONTRACT_TYPE_SPECS.find((spec) => spec.type === type);
}

/**
 * The contracts a deal requires, given the party roles it can name.
 *
 * Staff may add a contract this did not predict — the world has more shapes
 * than a mapping. What staff must NOT be able to do is silently miss one the
 * mapping requires, which is why `missingContracts` exists and the dossier
 * surfaces its result rather than leaving it to memory.
 */
export function requiredContracts(
  availableRoles: readonly ContractPartyRole[],
): readonly ContractTypeSpec[] {
  return CONTRACT_TYPE_SPECS.filter((spec) => {
    if (!spec.always) return spec.parties.every((role) => availableRoles.includes(role));
    return true;
  });
}

/** Required types that have no contract on the deal yet. */
export function missingContracts(
  availableRoles: readonly ContractPartyRole[],
  existing: readonly ContractType[],
): readonly ContractTypeSpec[] {
  return requiredContracts(availableRoles).filter((spec) => !existing.includes(spec.type));
}

/**
 * Contract numbers: `OSI-2026-0042` (brief §3.2). Per-year and
 * platform-global, like `request_id_seq` — a buyer quoting a number to OSI
 * should be unambiguous across every workspace.
 */
export function formatContractNumber(sequence: number, year: number): string {
  return `OSI-${year}-${String(sequence).padStart(4, "0")}`;
}
