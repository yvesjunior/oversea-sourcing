import { describe, expect, it } from "vitest";
import {
  absentBasics,
  CLARIFY_MAX_TURNS,
  clarifyTurnsLeft,
  normalizeProposals,
  normalizeQuestions,
  supersededAdds,
  PROPOSALS_PER_TURN,
  QUESTIONS_PER_TURN,
  type ExistingCriterion,
} from "./clarification";

const criteria: ExistingCriterion[] = [
  {
    id: "c1",
    category: "material",
    label: "Matériau",
    value: "Inox 316L",
    unit: null,
    required: true,
  },
  { id: "c2", category: "pressure", label: "Pression", value: "16", unit: "bar", required: false },
];

describe("absentBasics", () => {
  it("names the basics a draft does not carry", () => {
    expect(absentBasics(criteria)).toEqual(["quantity", "lead_time"]);
  });

  it("stops naming one once a criterion carries it", () => {
    expect(absentBasics([...criteria, { category: "quantity", value: "500" }])).toEqual([
      "lead_time",
    ]);
  });

  it("does not count an empty value as an answer", () => {
    expect(absentBasics([{ category: "quantity", value: "  " }])).toContain("quantity");
  });
});

describe("clarifyTurnsLeft", () => {
  it("counts down and never goes below zero", () => {
    expect(clarifyTurnsLeft(0)).toBe(CLARIFY_MAX_TURNS);
    expect(clarifyTurnsLeft(CLARIFY_MAX_TURNS - 1)).toBe(1);
    expect(clarifyTurnsLeft(CLARIFY_MAX_TURNS + 3)).toBe(0);
  });
});

describe("normalizeProposals", () => {
  it("keeps an addition as the full criterion it would create", () => {
    const [p] = normalizeProposals(
      [
        {
          op: "add",
          category: "quantity",
          label: " Quantité ",
          value: "500",
          unit: "pièces",
          required: true,
        },
      ],
      criteria,
    );
    expect(p).toEqual({
      op: "add",
      criterionId: null,
      category: "quantity",
      label: "Quantité",
      value: "500",
      unit: "pièces",
      required: true,
      previous: null,
      previousRequired: null,
    });
  });

  it("drops an addition with no label or no value", () => {
    expect(
      normalizeProposals(
        [
          { op: "add", label: "Quantité", value: "" },
          { op: "add", label: null, value: "500" },
        ],
        criteria,
      ),
    ).toEqual([]);
  });

  it("drops an addition that repeats an existing criterion, or one made a line earlier", () => {
    const proposals = normalizeProposals(
      [
        { op: "add", label: "pression", value: "16", unit: "bar" },
        { op: "add", label: "Quantité", value: "500" },
        { op: "add", label: "quantité", value: "500" },
      ],
      criteria,
    );
    expect(proposals.map((p) => p.label)).toEqual(["Quantité"]);
  });

  it("files an unknown category under other", () => {
    const [p] = normalizeProposals(
      [{ op: "add", category: "packaging", label: "Emballage", value: "palette" }],
      criteria,
    );
    expect(p?.category).toBe("other");
  });

  it("merges an update over the row it changes, and remembers what the value was", () => {
    const [p] = normalizeProposals([{ op: "update", id: "c2", value: "25" }], criteria);
    expect(p).toEqual({
      op: "update",
      criterionId: "c2",
      category: "pressure",
      label: "Pression",
      value: "25",
      unit: "bar",
      required: false,
      previous: "16 bar",
      previousRequired: null,
    });
  });

  it("reads a null unit as not mentioned and an empty one as cleared", () => {
    const [kept] = normalizeProposals(
      [{ op: "update", id: "c2", value: "25", unit: null }],
      criteria,
    );
    expect(kept?.unit).toBe("bar");
    const [cleared] = normalizeProposals([{ op: "update", id: "c2", unit: "" }], criteria);
    expect(cleared?.unit).toBeNull();
    expect(cleared?.previous).toBe("16 bar");
  });

  it("has no previous value when only the flag changes", () => {
    const [p] = normalizeProposals([{ op: "update", id: "c2", required: true }], criteria);
    expect(p?.required).toBe(true);
    expect(p?.previous).toBeNull();
    expect(p?.previousRequired).toBe(false);
  });

  it("drops an update that changes nothing", () => {
    expect(
      normalizeProposals(
        [{ op: "update", id: "c1", value: "Inox 316L", required: true }],
        criteria,
      ),
    ).toEqual([]);
  });

  it("drops an update or a removal aimed at an id that is not this request's", () => {
    expect(
      normalizeProposals(
        [
          { op: "update", id: "c9", value: "x" },
          { op: "remove", id: "nope" },
          { op: "remove", id: null },
        ],
        criteria,
      ),
    ).toEqual([]);
  });

  it("keeps a removal as the row as it stood", () => {
    const [p] = normalizeProposals([{ op: "remove", id: "c1" }], criteria);
    expect(p).toMatchObject({
      op: "remove",
      criterionId: "c1",
      label: "Matériau",
      value: "Inox 316L",
    });
  });

  it("lets only the first operation on a criterion through", () => {
    const proposals = normalizeProposals(
      [
        { op: "update", id: "c2", value: "25" },
        { op: "remove", id: "c2" },
      ],
      criteria,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.op).toBe("update");
  });

  it("does not propose again what is already waiting for an answer", () => {
    const proposals = normalizeProposals(
      [
        { op: "add", label: "Quantité", value: "500", unit: "pièces" },
        { op: "update", id: "c2", value: "25" },
        { op: "add", label: "Délai", value: "6 semaines" },
      ],
      criteria,
      [
        {
          op: "add",
          criterionId: null,
          label: "quantité",
          value: "500",
          unit: "pièces",
          required: true,
          status: "pending",
        },
        {
          op: "remove",
          criterionId: "c2",
          label: "Pression",
          value: "16",
          unit: "bar",
          required: false,
          status: "pending",
        },
      ],
    );
    expect(proposals.map((p) => p.label)).toEqual(["Délai"]);
  });

  it("does not bring back what the buyer declined", () => {
    const declined = [
      {
        op: "add" as const,
        criterionId: null,
        label: "Type de commande",
        value: "manuelle par levier",
        unit: null,
        required: true,
        status: "dismissed" as const,
      },
      {
        op: "update" as const,
        criterionId: "c2",
        label: "Pression",
        value: "25",
        unit: "bar",
        required: false,
        status: "dismissed" as const,
      },
      {
        op: "remove" as const,
        criterionId: "c1",
        label: "Matériau",
        value: "Inox 316L",
        unit: null,
        required: true,
        status: "dismissed" as const,
      },
    ];
    expect(
      normalizeProposals(
        [
          { op: "add", label: "Type de commande", value: "Manuelle par levier" },
          { op: "update", id: "c2", value: "25" },
          { op: "remove", id: "c1" },
        ],
        criteria,
        declined,
      ),
    ).toEqual([]);
  });

  it("still lets a declined criterion be changed another way", () => {
    const proposals = normalizeProposals([{ op: "update", id: "c2", value: "10" }], criteria, [
      {
        op: "update",
        criterionId: "c2",
        label: "Pression",
        value: "25",
        unit: "bar",
        required: false,
        status: "dismissed",
      },
    ]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.value).toBe("10");
  });

  it("ignores an operation it does not know", () => {
    expect(normalizeProposals([{ op: "replace", id: "c1", value: "x" }], criteria)).toEqual([]);
  });

  it("cuts labels, values and units to what the edit form accepts", () => {
    const [p] = normalizeProposals(
      [{ op: "add", label: "L".repeat(300), value: "V".repeat(300), unit: "U".repeat(60) }],
      criteria,
    );
    expect(p?.label).toHaveLength(200);
    expect(p?.value).toHaveLength(200);
    expect(p?.unit).toHaveLength(30);
  });

  it("keeps at most a turn's worth", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      op: "add",
      label: `Critère ${i}`,
      value: "x",
    }));
    expect(normalizeProposals(many, criteria)).toHaveLength(PROPOSALS_PER_TURN);
  });
});

describe("supersededAdds", () => {
  const earlier = [
    {
      id: "p1",
      op: "add" as const,
      criterionId: null,
      label: "Délai de livraison",
      value: "8",
      unit: "semaines",
      required: true,
      status: "pending" as const,
    },
    {
      id: "p2",
      op: "add" as const,
      criterionId: null,
      label: "Certification",
      value: "NSF/ANSI 61",
      unit: null,
      required: true,
      status: "pending" as const,
    },
    {
      id: "p3",
      op: "add" as const,
      criterionId: null,
      label: "Délai de livraison",
      value: "6",
      unit: "semaines",
      required: true,
      status: "dismissed" as const,
    },
  ];

  it("withdraws a waiting addition that a new one replaces, and nothing else", () => {
    const proposals = normalizeProposals(
      [{ op: "add", label: "délai de livraison", value: "10", unit: "semaines" }],
      criteria,
      earlier,
    );
    expect(proposals).toHaveLength(1);
    expect(supersededAdds(proposals, earlier)).toEqual(["p1"]);
  });

  it("withdraws nothing when the new turn only updates", () => {
    const proposals = normalizeProposals(
      [{ op: "update", id: "c2", value: "10" }],
      criteria,
      earlier,
    );
    expect(supersededAdds(proposals, earlier)).toEqual([]);
  });
});

describe("normalizeQuestions", () => {
  it("trims, drops the empty and the repeated, and stops at the limit", () => {
    expect(
      normalizeQuestions(["  Quelle quantité ? ", "", "quelle quantité ?", "Quel délai ?"]),
    ).toEqual(["Quelle quantité ?", "Quel délai ?"]);
    expect(
      normalizeQuestions(Array.from({ length: 12 }, (_, i) => `Question ${i} ?`)),
    ).toHaveLength(QUESTIONS_PER_TURN);
  });
});
