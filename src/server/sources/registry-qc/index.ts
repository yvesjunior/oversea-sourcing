// Connector #3: the Quebec enterprise registry (Registraire des entreprises,
// données publiques — the only registry carrying ACTIVITY descriptions, so
// its records are genuinely matchable, unlike bare federal names).
//
// STATIC, FILE-FED source: the registry endpoint cannot be fetched
// autonomously, so staff downloads the ZIP in their own browser and uploads
// it on /interne/sources; the full pull parses the upload (brief.fileKey).
// ZIP layout (per the Registraire's guide, in-537 2025-11):
//   Entreprise.csv — one row per NEQ: registration status, activity codes +
//                    DESCRIPTIONS (the matching signal), juridical form
//   Nom.csv        — names per NEQ (legal name + other names, with status)
// Joined here by NEQ; persistence, dedup and promotion stay in the core.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { headerIndex, NUMBERED_NAME } from "@/server/sources/csv";
import { extractEntries, landUpload, parseCsvFile } from "@/server/sources/file-tools";
import type { CollectResult, SearchBrief, SupplierSourceConnector } from "@/server/sources/types";

/** Registry-attested existence WITH a declared activity — above the federal
 *  name-only records (60), below AI research that read the company's site. */
const REGISTRY_QC_CONFIDENCE = 65;

/** Registration status code for an active (immatriculée) enterprise. */
const STATUS_ACTIVE = "IM";

type ActiveEnterprise = {
  description: string | null;
  cae: string;
  forme: string;
  /** Non-legal name kept until (unless) a legal-type name shows up. */
  fallbackName?: string;
};

export const registryQcConnector: SupplierSourceConnector = {
  meta: {
    code: "registry-qc",
    type: "country_registry",
    countryCode: "CA",
    name: "Registre des entreprises du Québec",
    requiresFile: true,
    downloadUrl:
      "https://www.registreentreprises.gouv.qc.ca/RQAnonymeGR/GR/GR03/GR03A2_22A_PIU_RecupDonnPub_PC/FichierDonneesOuvertes.aspx",
  },
  async collect(brief: SearchBrief): Promise<CollectResult> {
    if (!brief.fileKey) {
      throw new Error("registry-qc: aucun fichier téléversé — la source est alimentée par fichier");
    }
    const workDir = await mkdtemp(path.join(tmpdir(), "registry-qc-"));
    try {
      const zipPath = path.join(workDir, "upload.zip");
      await landUpload(brief.fileKey, zipPath);
      const wanted = new Set(["entreprise.csv", "nom.csv"]);
      const entries = await extractEntries(
        zipPath,
        (base) => wanted.has(base.toLowerCase()),
        workDir,
      );
      const enterprisePath = [...entries.entries()].find(
        ([base]) => base.toLowerCase() === "entreprise.csv",
      )?.[1];
      const nomPath = [...entries.entries()].find(
        ([base]) => base.toLowerCase() === "nom.csv",
      )?.[1];
      if (!enterprisePath || !nomPath) {
        throw new Error(
          `registry-qc: ZIP inattendu — trouvé [${[...entries.keys()].join(", ")}], ` +
            "attendu Entreprise.csv et Nom.csv",
        );
      }

      // Pass 1 — active enterprises with their declared activities.
      const active = new Map<string, ActiveEnterprise>();
      let enterpriseHeader: Record<string, number> | null = null;
      let totalEnterprises = 0;
      await parseCsvFile(enterprisePath, (row) => {
        if (!enterpriseHeader) {
          enterpriseHeader = headerIndex(row);
          return;
        }
        totalEnterprises++;
        const cell = (name: string) => row[enterpriseHeader![name] ?? -1]?.trim() ?? "";
        if (cell("COD_STAT_IMMAT") !== STATUS_ACTIVE) return;
        const neq = cell("NEQ");
        if (!neq) return;
        const descriptions = [cell("DESC_ACT_ECON_ASSUJ"), cell("DESC_ACT_ECON_ASSUJ2")]
          .filter(Boolean)
          .join(" · ");
        active.set(neq, {
          description: descriptions ? descriptions.slice(0, 400) : null,
          cae: cell("COD_ACT_ECON_CAE"),
          forme: cell("COD_FORME_JURI"),
        });
      });

      // Pass 2 — names. First legal-type in-force name wins; any other
      // in-force name stands in when no legal-type one exists for the NEQ.
      const candidates: CollectResult["candidates"] = [];
      let nomHeader: Record<string, number> | null = null;
      let skippedNumbered = 0;
      const emit = (neq: string, name: string, enterprise: ActiveEnterprise) => {
        candidates.push({
          name,
          countryCode: "CA",
          website: null,
          descriptor: null,
          description: enterprise.description,
          confidence: REGISTRY_QC_CONFIDENCE,
          sourceUrl: null,
          raw: { neq, cae: enterprise.cae, forme: enterprise.forme },
        });
      };
      await parseCsvFile(nomPath, (row) => {
        if (!nomHeader) {
          nomHeader = headerIndex(row);
          return;
        }
        const cell = (name: string) => row[nomHeader![name] ?? -1]?.trim() ?? "";
        const neq = cell("NEQ");
        const enterprise = active.get(neq);
        if (!enterprise) return;
        if (cell("DAT_FIN_NOM_ASSUJ")) return; // retired name
        const statNom = cell("STAT_NOM");
        if (statNom && statNom.startsWith("A")) return; // antérieur
        const name = cell("NOM_ASSUJ");
        if (!name) return;
        if (NUMBERED_NAME.test(name)) {
          skippedNumbered++;
          return;
        }
        if (cell("TYP_NOM_ASSUJ") === "N") {
          emit(neq, name, enterprise);
          active.delete(neq); // settled — legal name found
        } else if (!enterprise.fallbackName) {
          enterprise.fallbackName = name;
        }
      });
      for (const [neq, enterprise] of active) {
        if (enterprise.fallbackName) emit(neq, enterprise.fallbackName, enterprise);
      }

      console.log(
        `registry-qc: ${totalEnterprises} enterprises read — ` +
          `${candidates.length} active named candidates, ${skippedNumbered} numbered names skipped`,
      );
      return { candidates, queries: [`fichier téléversé: ${brief.fileKey}`] };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  },
};
