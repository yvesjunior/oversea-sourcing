import { describe, expect, it } from "vitest";
import {
  PARTY_ROLE_OF,
  documentAudience,
  documentChains,
  dossierIsLive,
  isSatisfaction,
  mayConfirmReception,
  mayRaiseIssue,
  mayRead,
  maySeeIssue,
  mayUpload,
  openIssues,
  projectDossier,
  threadParties,
  type DossierAudience,
  type DossierDocument,
  type FullDossier,
} from "@/lib/dossier";
import { PARTNER_KINDS } from "@/lib/partners";

// One dossier, with everything in it. The four readers below open THIS.
const BUYER = "p-buyer";
const OSI = "p-osi";
const SUPPLIER = "p-supplier";
const CARRIER = "p-carrier";
const INSPECTOR = "p-inspector";

const doc = (id: string, sharedWith: string[], patch: Partial<DossierDocument> = {}) => ({
  id,
  fileId: `f-${id}`,
  filename: `${id}.pdf`,
  size: 1000,
  label: null,
  version: 1,
  supersedesId: null,
  sharedWith,
  uploadedByName: "Dana (OSI)",
  createdAt: "2026-11-19T10:00:00.000Z",
  ...patch,
});

const message = (id: string, partyId: string | null, authorName: string) => ({
  id,
  authorName,
  authorRole: (partyId === BUYER ? "buyer" : partyId === SUPPLIER ? "supplier" : "osi") as
    "buyer" | "supplier" | "osi",
  authorPartyId: partyId,
  body: `message ${id}`,
  createdAt: "2026-11-19T10:00:00.000Z",
});

const dossier = (buyerDisclosedAt: string | null = "2026-11-19T09:00:00.000Z"): FullDossier => ({
  deal: {
    id: "deal-1",
    title: "Roulements à billes",
    status: "open",
    openedAt: "2026-11-19T09:00:00.000Z",
    requestId: "3049",
    buyerDisclosedAt,
  },
  offer: {
    amountCents: 98000,
    currency: "USD",
    incoterm: "FOB Shanghai",
    quantity: "20 000",
    moq: "5 000",
    leadTimeDays: 30,
    paymentTerms: "30 % à la commande",
  },
  facts: {
    goods: { title: "Roulements à billes", lines: ["Diamètre : 12 mm"] },
    quantity: "20 000",
    origin: "CN",
    incoterm: "FOB Shanghai",
    lead_time: 30,
    goods_value: { amountCents: 98000, currency: "USD" },
    supplier_identity: "Changzhou Huari",
  },
  parties: [
    { id: BUYER, role: "buyer", name: "Atelier Boréal", partnerKind: null },
    { id: OSI, role: "osi", name: "OSI", partnerKind: null },
    { id: SUPPLIER, role: "supplier", name: "Changzhou Huari", partnerKind: null },
    { id: CARRIER, role: "carrier", name: "Transit Boréal", partnerKind: "transport" },
    { id: INSPECTOR, role: "inspector", name: "Inspect North", partnerKind: "inspection" },
  ],
  documents: [
    doc("proforma", [BUYER, SUPPLIER]),
    doc("mandate", [BUYER]),
    doc("booking", [CARRIER]),
    doc("internal", []),
  ],
  threads: [
    {
      id: "t-buyer",
      subject: "Question sur le délai",
      parties: [BUYER],
      createdAt: "2026-11-19T10:00:00.000Z",
      lastMessageAt: "2026-11-19T11:00:00.000Z",
      messages: [message("m1", BUYER, "Camille Roy"), message("m2", null, "Dana Staff")],
    },
    {
      id: "t-supplier",
      subject: "Emballage",
      parties: [SUPPLIER],
      createdAt: "2026-11-19T10:00:00.000Z",
      lastMessageAt: "2026-11-19T10:30:00.000Z",
      messages: [message("m3", SUPPLIER, "Li Wei")],
    },
    {
      id: "t-all",
      subject: "Date d'enlèvement",
      parties: [SUPPLIER, CARRIER],
      createdAt: "2026-11-19T10:00:00.000Z",
      lastMessageAt: "2026-11-19T12:00:00.000Z",
      messages: [message("m4", null, "Dana Staff")],
    },
  ],
});

const staff: DossierAudience = { kind: "staff" };
const buyer: DossierAudience = { kind: "buyer", partyId: BUYER };
const supplier: DossierAudience = { kind: "supplier", partyId: SUPPLIER };
const carrier: DossierAudience = { kind: "partner", partyId: CARRIER, partnerKind: "transport" };
const inspector: DossierAudience = {
  kind: "partner",
  partyId: INSPECTOR,
  partnerKind: "inspection",
};

const names = (view: ReturnType<typeof projectDossier>) =>
  Object.fromEntries(view.parties.map((p) => [p.id, p.name]));
const ids = (list: Array<{ id: string }>) => list.map((item) => item.id).sort();

// V25's acceptance: "Buyer, staff, supplier and a partner each open the same
// dossier and see four different pages."
describe("four readers, four pages", () => {
  const full = dossier();
  const views = {
    staff: projectDossier(full, staff),
    buyer: projectDossier(full, buyer),
    supplier: projectDossier(full, supplier),
    carrier: projectDossier(full, carrier),
  };

  it("gives no two of them the same page", () => {
    const pages = Object.values(views).map((view) => JSON.stringify(view));
    expect(new Set(pages).size).toBe(4);
  });

  it("shows staff everything, everyone named", () => {
    expect(names(views.staff)).toEqual({
      [BUYER]: "Atelier Boréal",
      [OSI]: "OSI",
      [SUPPLIER]: "Changzhou Huari",
      [CARRIER]: "Transit Boréal",
      [INSPECTOR]: "Inspect North",
    });
    expect(ids(views.staff.documents)).toEqual(["booking", "internal", "mandate", "proforma"]);
    expect(ids(views.staff.threads)).toEqual(["t-all", "t-buyer", "t-supplier"]);
    expect(views.staff.offer?.amountCents).toBe(98000);
  });

  it("shows the buyer the supplier by name and a partner by what it does", () => {
    expect(names(views.buyer)).toEqual({
      [BUYER]: "Atelier Boréal",
      [OSI]: "OSI",
      [SUPPLIER]: "Changzhou Huari",
      // Listed — the buyer should know someone ships — and not named.
      [CARRIER]: null,
      [INSPECTOR]: null,
    });
    expect(views.buyer.parties.find((p) => p.id === CARRIER)?.partnerKind).toBe("transport");
    expect(JSON.stringify(views.buyer)).not.toContain("Transit Boréal");
    expect(ids(views.buyer.documents)).toEqual(["mandate", "proforma"]);
    expect(ids(views.buyer.threads)).toEqual(["t-buyer"]);
    expect(views.buyer.offer?.amountCents).toBe(98000);
  });

  it("shows the supplier its own offer, OSI, and no partner at all", () => {
    expect(names(views.supplier)).toEqual({
      [BUYER]: "Atelier Boréal",
      [OSI]: "OSI",
      [SUPPLIER]: "Changzhou Huari",
    });
    expect(JSON.stringify(views.supplier)).not.toContain("Transit Boréal");
    expect(JSON.stringify(views.supplier)).not.toContain("Inspect North");
    expect(ids(views.supplier.documents)).toEqual(["proforma"]);
    expect(ids(views.supplier.threads)).toEqual(["t-all", "t-supplier"]);
    expect(views.supplier.offer?.amountCents).toBe(98000);
    // The request is the buyer's and staff's to follow.
    expect("requestId" in views.supplier.deal).toBe(false);
  });

  it("shows a carrier what moving the goods takes — no price, no buyer, no supplier", () => {
    expect(names(views.carrier)).toEqual({ [OSI]: "OSI", [CARRIER]: "Transit Boréal" });
    expect(views.carrier.offer).toBeUndefined();
    expect(Object.keys(views.carrier.facts ?? {}).sort()).toEqual(
      ["goods", "incoterm", "lead_time", "origin", "quantity"].sort(),
    );
    const page = JSON.stringify(views.carrier);
    expect(page).not.toContain("98000");
    expect(page).not.toContain("Atelier Boréal");
    expect(page).not.toContain("Changzhou");
    expect(page).not.toContain("Inspect North");
    expect(ids(views.carrier.documents)).toEqual(["booking"]);
    expect(ids(views.carrier.threads)).toEqual(["t-all"]);
  });

  it("names the supplier to an inspector, who goes there — and still no price, no buyer", () => {
    const view = projectDossier(full, inspector);
    expect(names(view)).toEqual({
      [OSI]: "OSI",
      [SUPPLIER]: "Changzhou Huari",
      [INSPECTOR]: "Inspect North",
    });
    expect(JSON.stringify(view)).not.toContain("98000");
    expect(JSON.stringify(view)).not.toContain("Atelier Boréal");
  });

  it("marks the reader's own party, and only that one", () => {
    expect(views.buyer.parties.filter((p) => p.you).map((p) => p.id)).toEqual([BUYER]);
    expect(views.supplier.parties.filter((p) => p.you).map((p) => p.id)).toEqual([SUPPLIER]);
    expect(views.carrier.parties.filter((p) => p.you).map((p) => p.id)).toEqual([CARRIER]);
    expect(views.staff.parties.filter((p) => p.you)).toEqual([]);
  });
});

// "A thread between buyer and staff is invisible to the supplier."
describe("threads", () => {
  it("hides a buyer–OSI thread from the supplier, and the reverse", () => {
    const full = dossier();
    const supplierPage = JSON.stringify(projectDossier(full, supplier));
    expect(supplierPage).not.toContain("Question sur le délai");
    expect(supplierPage).not.toContain("message m1");
    const buyerPage = JSON.stringify(projectDossier(full, buyer));
    expect(buyerPage).not.toContain("Emballage");
    expect(buyerPage).not.toContain("Date d'enlèvement");
  });

  it("says which SIDE wrote a message — a person's name is staff's alone", () => {
    const full = dossier();
    const forBuyer = projectDossier(full, buyer).threads[0]!;
    expect(forBuyer.messages.map((m) => [m.role, m.mine])).toEqual([
      ["buyer", true],
      ["osi", false],
    ]);
    expect(JSON.stringify(forBuyer)).not.toContain("Dana Staff");
    expect(JSON.stringify(forBuyer)).not.toContain("Camille Roy");
    const forStaff = projectDossier(full, staff).threads.find((t) => t.id === "t-buyer")!;
    expect(forStaff.messages.map((m) => [m.authorName, m.mine])).toEqual([
      ["Camille Roy", false],
      ["Dana Staff", true],
    ]);
  });

  it("names a thread's other participants by the reader's own rule", () => {
    const shared = projectDossier(dossier(), supplier).threads.find((t) => t.id === "t-all")!;
    // The carrier is in the thread; the supplier is not told WHO it is…
    expect(shared.parties.map((p) => p.id)).toEqual([SUPPLIER]);
    // …but is told that someone else reads it: a shared conversation is
    // never mistaken for a private one.
    expect(shared.alsoParties).toBe(1);
    const forCarrier = projectDossier(dossier(), carrier).threads.find((t) => t.id === "t-all")!;
    expect(forCarrier.parties.map((p) => p.id)).toEqual([CARRIER]);
    expect(forCarrier.alsoParties).toBe(1);
    // Staff are told everything: nobody is left unnamed.
    expect(projectDossier(dossier(), staff).threads.every((t) => t.alsoParties === 0)).toBe(true);
    // A thread that really is with OSI alone says so.
    expect(projectDossier(dossier(), buyer).threads[0]!.alsoParties).toBe(0);
  });

  it("lets only staff put two sides in one conversation", () => {
    const { parties } = dossier();
    expect(threadParties(staff, [BUYER, SUPPLIER], parties)).toEqual([BUYER, SUPPLIER]);
    // Whatever a side asks for, its thread is with OSI alone.
    expect(threadParties(buyer, [SUPPLIER], parties)).toEqual([BUYER]);
    expect(threadParties(supplier, [BUYER, SUPPLIER], parties)).toEqual([SUPPLIER]);
    expect(threadParties(carrier, [], parties)).toEqual([CARRIER]);
  });

  it("refuses a staff thread with nobody, with OSI, or with an unknown party", () => {
    const { parties } = dossier();
    expect(threadParties(staff, [], parties)).toBeNull();
    expect(threadParties(staff, [OSI], parties)).toBeNull();
    expect(threadParties(staff, [BUYER, "nope"], parties)).toBeNull();
  });
});

// Decision D6: the buyer's identity is disclosed when the deal opens — by a
// step, not by a join.
describe("the buyer's identity", () => {
  it("is not named to the supplier until it has been disclosed", () => {
    const before = projectDossier(dossier(null), supplier);
    expect(names(before)[BUYER]).toBeNull();
    expect(JSON.stringify(before)).not.toContain("Atelier Boréal");
    expect(before.buyerDisclosedAt).toBeNull();

    const after = projectDossier(dossier(), supplier);
    expect(names(after)[BUYER]).toBe("Atelier Boréal");
    expect(after.buyerDisclosedAt).toBe("2026-11-19T09:00:00.000Z");
  });

  it("is never named to a partner, disclosed or not", () => {
    for (const kind of PARTNER_KINDS) {
      const view = projectDossier(dossier(), {
        kind: "partner",
        partyId: CARRIER,
        partnerKind: kind,
      });
      expect(JSON.stringify(view), kind).not.toContain("Atelier Boréal");
    }
  });

  it("tells staff where the disclosure stands, and not the buyer or a partner", () => {
    expect(projectDossier(dossier(null), staff).buyerDisclosedAt).toBeNull();
    expect("buyerDisclosedAt" in projectDossier(dossier(), buyer)).toBe(false);
    expect("buyerDisclosedAt" in projectDossier(dossier(), carrier)).toBe(false);
  });
});

// "Uploading a new version keeps the old one readable."
describe("document versions", () => {
  const v1 = doc("spec-v1", [BUYER, SUPPLIER], { createdAt: "2026-11-19T10:00:00.000Z" });
  const v2 = doc("spec-v2", [BUYER, SUPPLIER], {
    version: 2,
    supersedesId: "spec-v1",
    createdAt: "2026-11-19T11:00:00.000Z",
  });
  const v3 = doc("spec-v3", [BUYER, SUPPLIER], {
    version: 3,
    supersedesId: "spec-v2",
    createdAt: "2026-11-19T12:00:00.000Z",
  });

  it("shows the latest as current and keeps every earlier one, newest first", () => {
    const chains = documentChains([v1, v2, v3], buyer);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.current.id).toBe("spec-v3");
    expect(chains[0]!.earlier.map((d) => d.id)).toEqual(["spec-v2", "spec-v1"]);
  });

  it("keeps the earlier file's own address in the projected page", () => {
    const view = projectDossier({ ...dossier(), documents: [v1, v2] }, supplier);
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0]!.fileId).toBe("f-spec-v2");
    expect(view.documents[0]!.earlier.map((d) => d.fileId)).toEqual(["f-spec-v1"]);
  });

  it("stops the history at a version the reader was not given", () => {
    // v1 was OSI's draft, never shared with the supplier; v2 was.
    const draft = { ...v1, sharedWith: [] };
    const chains = documentChains([draft, v2], supplier);
    expect(chains[0]!.current.id).toBe("spec-v2");
    expect(chains[0]!.earlier).toEqual([]);
    expect(documentChains([draft, v2], staff)[0]!.earlier.map((d) => d.id)).toEqual(["spec-v1"]);
  });

  it("does not loop on a chain that points at itself", () => {
    const loop = { ...v1, supersedesId: "spec-v2" };
    expect(() => documentChains([loop, v2], staff)).not.toThrow();
  });

  it("says a document is read by others the reader is not told about", () => {
    const shared = doc("plan", [SUPPLIER, CARRIER, INSPECTOR]);
    const view = projectDossier({ ...dossier(), documents: [shared] }, supplier);
    expect(view.documents[0]!.sharedWith.map((p) => p.id)).toEqual([SUPPLIER]);
    expect(view.documents[0]!.alsoSharedWith).toBe(2);
    // The buyer is shown partners by role, so nobody is hidden from it.
    const forBuyer = projectDossier(
      { ...dossier(), documents: [doc("x", [BUYER, CARRIER])] },
      buyer,
    );
    expect(forBuyer.documents[0]!.alsoSharedWith).toBe(0);
  });

  it("tells who uploaded a document to staff alone", () => {
    const full = { ...dossier(), documents: [v1] };
    expect(projectDossier(full, staff).documents[0]!.uploadedByName).toBe("Dana (OSI)");
    expect("uploadedByName" in projectDossier(full, buyer).documents[0]!).toBe(false);
  });
});

describe("sharing a document", () => {
  const { parties } = dossier();

  it("is read by the parties listed, and by staff whatever the list", () => {
    expect(mayRead(staff, [])).toBe(true);
    expect(mayRead(buyer, [SUPPLIER])).toBe(false);
    expect(mayRead(buyer, [BUYER])).toBe(true);
  });

  it("lets staff choose the audience, an empty one included", () => {
    expect(documentAudience(staff, [BUYER, CARRIER], parties)).toEqual([BUYER, CARRIER]);
    expect(documentAudience(staff, [], parties)).toEqual([]);
    expect(documentAudience(staff, ["nope"], parties)).toBeNull();
    expect(documentAudience(staff, [OSI], parties)).toBeNull();
  });

  it("shares a buyer's upload with the buyer, whatever was asked", () => {
    expect(documentAudience(buyer, [SUPPLIER], parties)).toEqual([BUYER]);
  });

  it("gives a supplier and a partner no upload in this version", () => {
    expect(documentAudience(supplier, [SUPPLIER], parties)).toBeNull();
    expect(mayUpload(supplier)).toBe(false);
    expect(mayUpload(carrier)).toBe(false);
    expect(mayUpload(buyer)).toBe(true);
    expect(mayUpload(staff)).toBe(true);
  });
});

describe("the vocabulary", () => {
  it("gives every kind of partner a role on a dossier", () => {
    for (const kind of PARTNER_KINDS) expect(PARTY_ROLE_OF[kind], kind).toBeTruthy();
    expect(PARTY_ROLE_OF.transport).toBe("carrier");
    expect(PARTY_ROLE_OF.customs).toBe("customs_broker");
    expect(PARTY_ROLE_OF.inspection).toBe("inspector");
  });

  it("closes a dossier to new exchanges once it is closed or cancelled", () => {
    expect(dossierIsLive("open")).toBe(true);
    expect(dossierIsLive("delivered")).toBe(true);
    expect(dossierIsLive("closed")).toBe(false);
    expect(dossierIsLive("cancelled")).toBe(false);
  });
});

// V27: every reader follows the dossier's execution; what differs is who may
// record it and who reads the supplier's own words and photos.
describe("milestones on the page", () => {
  const withProduction = (): FullDossier => ({
    ...dossier(),
    deal: { ...dossier().deal, status: "in_production" },
    milestones: [
      {
        id: "m-start",
        kind: "production_started",
        plannedAt: "2026-12-01T00:00:00.000Z",
        completedAt: "2026-12-02T09:00:00.000Z",
        note: "Ligne 3 lancée",
        channel: "portal",
        updatedByName: "Mei Lin",
        updatedAt: "2026-12-02T09:00:00.000Z",
      },
    ],
    documents: [
      doc("photo", [BUYER, SUPPLIER], { milestoneId: "m-start" }),
      doc("proforma", [BUYER]),
    ],
  });

  it("lists every milestone to every reader, recorded or not, in order", () => {
    for (const audience of [staff, buyer, supplier, carrier]) {
      const view = projectDossier(withProduction(), audience);
      expect(view.milestones.map((m) => m.kind)).toEqual([
        "production_started",
        "production_finished",
        "inspection",
        "booking",
        "shipped",
        "customs_cleared",
        "delivered",
      ]);
      expect(view.milestones[0]!.completedAt).toBe("2026-12-02T09:00:00.000Z");
      expect(view.milestones[1]!.completedAt).toBeNull();
    }
  });

  // "A supplier marks production started with a photo → the buyer sees it,
  // dated, with who recorded it."
  it("shows the buyer the date, the photo and which side recorded it — not the person", () => {
    const first = projectDossier(withProduction(), buyer).milestones[0]!;
    expect(first.channel).toBe("portal");
    expect(first.owner).toBe("supplier");
    expect(first.note).toBe("Ligne 3 lancée");
    expect(first.proofs.map((p) => p.id)).toEqual(["photo"]);
    expect("recordedByName" in first).toBe(false);
    expect(projectDossier(withProduction(), staff).milestones[0]!.recordedByName).toBe("Mei Lin");
  });

  it("keeps a proof under its milestone, out of the general documents list", () => {
    const view = projectDossier(withProduction(), buyer);
    expect(view.documents.map((d) => d.id)).toEqual(["proforma"]);
  });

  it("tells a partner what happened and when — not the supplier's words or photos", () => {
    const first = projectDossier(withProduction(), carrier).milestones[0]!;
    expect(first.completedAt).toBe("2026-12-02T09:00:00.000Z");
    expect("note" in first).toBe(false);
    expect(first.proofs).toEqual([]);
    expect(JSON.stringify(projectDossier(withProduction(), carrier))).not.toContain("Ligne 3");
  });

  // Found in V28's live run: an inspector could not see the report it had
  // just uploaded, nor its own note.
  it("shows a partner the note and the proofs of its OWN milestone", () => {
    const inspected: FullDossier = {
      ...withProduction(),
      milestones: [
        ...withProduction().milestones!,
        {
          id: "m-insp",
          kind: "inspection",
          plannedAt: null,
          completedAt: "2026-12-05T09:00:00.000Z",
          note: "3 lots contrôlés",
          channel: "portal",
          updatedByName: "Ana Reyes",
          updatedAt: "2026-12-05T09:00:00.000Z",
        },
      ],
      documents: [
        doc("photo", [BUYER, SUPPLIER], { milestoneId: "m-start" }),
        doc("report", [BUYER, INSPECTOR], { milestoneId: "m-insp" }),
      ],
    };
    const own = projectDossier(inspected, inspector).milestones.find(
      (m) => m.kind === "inspection",
    )!;
    expect(own.note).toBe("3 lots contrôlés");
    expect(own.proofs.map((p) => p.id)).toEqual(["report"]);
    // Still not the supplier's production note or photo…
    const production = projectDossier(inspected, inspector).milestones[0]!;
    expect("note" in production).toBe(false);
    expect(production.proofs).toEqual([]);
    // …and the supplier does not read the inspection report about its goods.
    const forSupplier = projectDossier(inspected, supplier).milestones.find(
      (m) => m.kind === "inspection",
    )!;
    expect(forSupplier.proofs).toEqual([]);
    expect("note" in forSupplier).toBe(false);
    // Its own production note it does read.
    expect(projectDossier(inspected, supplier).milestones[0]!.note).toBe("Ligne 3 lancée");
    // The buyer reads both.
    const forBuyer = projectDossier(inspected, buyer).milestones;
    expect(forBuyer[0]!.proofs.map((p) => p.id)).toEqual(["photo"]);
    expect(forBuyer.find((m) => m.kind === "inspection")!.proofs.map((p) => p.id)).toEqual([
      "report",
    ]);
  });

  it("lets each side record its own steps, staff every one, the buyer none", () => {
    const can = (audience: DossierAudience) =>
      projectDossier(withProduction(), audience).milestones.map((m) => m.canRecord);
    //                      start finish inspect booking shipped customs delivered
    expect(can(supplier)).toEqual([true, true, false, false, false, false, false]);
    expect(can(inspector)).toEqual([false, false, true, false, false, false, false]);
    expect(can(carrier)).toEqual([false, false, false, true, true, false, true]);
    expect(can(staff)).toEqual([true, true, true, true, true, true, true]);
    expect(can(buyer)).toEqual([false, false, false, false, false, false, false]);
  });

  // V29: a transit agent that both ships and clears is two partners and one
  // person. That person reads and records as each of them.
  it("gives one account holding two partner roles the union of both", () => {
    const BROKER = "p-broker";
    const full: FullDossier = {
      ...withProduction(),
      parties: [
        ...withProduction().parties,
        { id: BROKER, role: "customs_broker", name: "Transit Boréal", partnerKind: "customs" },
      ],
      documents: [doc("bl", [BUYER, CARRIER]), doc("entry", [BUYER, BROKER]), doc("x", [SUPPLIER])],
      threads: [],
    };
    const agent: DossierAudience = {
      kind: "partner",
      partyId: CARRIER,
      partnerKind: "transport",
      also: [{ partyId: BROKER, partnerKind: "customs" }],
    };
    const view = projectDossier(full, agent);
    // Both of its parties are marked as its own.
    expect(
      view.parties
        .filter((p) => p.you)
        .map((p) => p.id)
        .sort(),
    ).toEqual([CARRIER, BROKER].sort());
    // The documents of either role, and not the supplier's.
    expect(ids(view.documents)).toEqual(["bl", "entry"]);
    // What either kind of work needs: the value, which customs is computed
    // from — and still not the supplier, nor the buyer.
    expect(view.facts?.goods_value).toEqual({ amountCents: 98000, currency: "USD" });
    expect(view.facts?.lead_time).toBe(30);
    expect("supplier_identity" in (view.facts ?? {})).toBe(false);
    expect(JSON.stringify(view)).not.toContain("Atelier Boréal");
    // And the milestones of both roles.
    expect(view.milestones.filter((m) => m.canRecord).map((m) => m.kind)).toEqual([
      "booking",
      "shipped",
      "customs_cleared",
      "delivered",
    ]);
    // The carrier alone does not get the value.
    expect("goods_value" in (projectDossier(full, carrier).facts ?? {})).toBe(false);
  });

  it("lets nobody record on a dossier that is delivered or closed", () => {
    const delivered = {
      ...withProduction(),
      deal: { ...dossier().deal, status: "delivered" as const },
    };
    expect(projectDossier(delivered, staff).milestones.every((m) => !m.canRecord)).toBe(true);
  });
});

// V28: something is not as agreed. Who reads it, who raises it, and what it
// does to closing.
describe("issues", () => {
  const withIssues = (): FullDossier => ({
    ...dossier(),
    issues: [
      {
        id: "i-insp",
        kind: "nonconformity",
        description: "Dureté hors tolérance sur 3 lots",
        status: "open",
        raisedByName: "Ana Inspector",
        raisedByRole: "inspector",
        raisedByPartyId: INSPECTOR,
        resolution: null,
        resolvedAt: null,
        createdAt: "2026-12-05T10:00:00.000Z",
      },
      {
        id: "i-buyer",
        kind: "shortfall",
        description: "2 cartons manquants",
        status: "resolved",
        raisedByName: "Camille Roy",
        raisedByRole: "buyer",
        raisedByPartyId: BUYER,
        resolution: "Avoir émis par le fournisseur",
        resolvedAt: "2026-12-20T10:00:00.000Z",
        createdAt: "2026-12-18T10:00:00.000Z",
      },
    ],
  });

  // "A gap becomes an issue the buyer sees."
  it("shows the buyer and staff every issue", () => {
    expect(ids(projectDossier(withIssues(), buyer).issues)).toEqual(["i-buyer", "i-insp"]);
    expect(ids(projectDossier(withIssues(), staff).issues)).toEqual(["i-buyer", "i-insp"]);
  });

  it("shows a partner the issues it raised, and no other", () => {
    expect(ids(projectDossier(withIssues(), inspector).issues)).toEqual(["i-insp"]);
    expect(projectDossier(withIssues(), carrier).issues).toEqual([]);
  });

  // What an inspector found reaches the supplier through OSI.
  it("shows the supplier none of them", () => {
    const page = projectDossier(withIssues(), supplier);
    expect(page.issues).toEqual([]);
    expect(JSON.stringify(page)).not.toContain("Dureté");
    expect(page.canRaiseIssue).toBe(false);
  });

  it("says which side raised an issue — the person is staff's to know", () => {
    const forBuyer = projectDossier(withIssues(), buyer).issues;
    expect(forBuyer.map((i) => [i.raisedByRole, i.mine])).toEqual([
      ["buyer", true],
      ["inspector", false],
    ]);
    expect(JSON.stringify(forBuyer)).not.toContain("Ana Inspector");
    expect(projectDossier(withIssues(), staff).issues[1]!.raisedByName).toBe("Ana Inspector");
  });

  it("lets staff, the buyer and a partner raise one — until the dossier is closed", () => {
    for (const audience of [staff, buyer, inspector, carrier]) {
      expect(mayRaiseIssue(audience, "in_production")).toBe(true);
      // A buyer finds damage after delivery, not before.
      expect(mayRaiseIssue(audience, "delivered")).toBe(true);
      expect(mayRaiseIssue(audience, "closed")).toBe(false);
      expect(mayRaiseIssue(audience, "cancelled")).toBe(false);
    }
    expect(mayRaiseIssue(supplier, "in_production")).toBe(false);
  });

  it("leaves settling to staff", () => {
    expect(projectDossier(withIssues(), staff).canSettleIssues).toBe(true);
    for (const audience of [buyer, supplier, inspector]) {
      expect(projectDossier(withIssues(), audience).canSettleIssues).toBe(false);
    }
  });

  // "The dossier cannot be closed while one is open."
  it("counts what stands in the way of closing: the open ones, not the disputed", () => {
    expect(openIssues(withIssues().issues!)).toBe(1);
    expect(openIssues([{ status: "resolved" }, { status: "disputed" }])).toBe(0);
    expect(openIssues([])).toBe(0);
  });

  it("is read only by its own party once raised", () => {
    expect(maySeeIssue(inspector, { raisedByPartyId: INSPECTOR })).toBe(true);
    expect(maySeeIssue(carrier, { raisedByPartyId: INSPECTOR })).toBe(false);
    expect(maySeeIssue(supplier, { raisedByPartyId: null })).toBe(false);
  });
});

// V30: "Only a buyer seat confirms… Staff cannot confirm for the buyer — the
// rule is two acts by two actors."
describe("confirming reception", () => {
  it("is the buyer's, on a delivered dossier, and nobody else's", () => {
    expect(mayConfirmReception(buyer, "delivered")).toBe(true);
    for (const audience of [staff, supplier, carrier, inspector]) {
      expect(mayConfirmReception(audience, "delivered")).toBe(false);
    }
  });

  it("waits for the delivery, and happens once", () => {
    for (const status of ["open", "contracting", "in_production", "shipping"] as const) {
      expect(mayConfirmReception(buyer, status), status).toBe(false);
    }
    // Once confirmed the dossier is `reviewed`: there is nothing to confirm.
    for (const status of ["reviewed", "closed", "cancelled"] as const) {
      expect(mayConfirmReception(buyer, status), status).toBe(false);
    }
  });

  it("takes a whole number from 1 to 5 and nothing else", () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isSatisfaction(value)).toBe(true);
    for (const value of [0, 6, 3.5, "4", null, undefined, Number.NaN]) {
      expect(isSatisfaction(value)).toBe(false);
    }
  });

  it("offers the act to the buyer's page only, and shows what was said to buyer and staff", () => {
    const delivered: FullDossier = {
      ...dossier(),
      deal: { ...dossier().deal, status: "delivered" },
    };
    expect(projectDossier(delivered, buyer).canConfirmReception).toBe(true);
    expect(projectDossier(delivered, staff).canConfirmReception).toBe(false);
    expect(projectDossier(delivered, supplier).canConfirmReception).toBe(false);

    const reviewed: FullDossier = {
      ...dossier(),
      deal: {
        ...dossier().deal,
        status: "reviewed",
        review: {
          satisfaction: 4,
          comment: "Conforme, un jour de retard",
          reviewedAt: "2026-12-30T10:00:00.000Z",
        },
      },
    };
    expect(projectDossier(reviewed, buyer).review?.satisfaction).toBe(4);
    expect(projectDossier(reviewed, staff).review?.comment).toBe("Conforme, un jour de retard");
    // What a buyer thinks of a supplier is not a page the supplier opens.
    for (const audience of [supplier, carrier, inspector]) {
      const page = projectDossier(reviewed, audience);
      expect("review" in page).toBe(false);
      expect(JSON.stringify(page)).not.toContain("un jour de retard");
    }
  });
});
