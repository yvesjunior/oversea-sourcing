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
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Unzip, UnzipInflate } from "fflate";
import { CsvParser, headerIndex, NUMBERED_NAME } from "@/server/sources/csv";
import type { CollectResult, SearchBrief, SupplierSourceConnector } from "@/server/sources/types";

/** Registry-attested existence WITH a declared activity — above the federal
 *  name-only records (60), below AI research that read the company's site. */
const REGISTRY_QC_CONFIDENCE = 65;

/** Registration status code for an active (immatriculée) enterprise. */
const STATUS_ACTIVE = "IM";

/** Decode a sample strictly as UTF-8; fall back to windows-1252 when the
 *  file predates the registry's UTF-8 exports (accents would otherwise
 *  arrive as replacement chars and poison names and dedup keys). */
function pickDecoder(sample: Uint8Array): TextDecoder {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return new TextDecoder("utf-8");
  } catch {
    return new TextDecoder("windows-1252");
  }
}

/** Extract the wanted CSV entries of a ZIP to temp files, streaming — entry
 *  order in the archive is not ours to assume, so extract first, parse after. */
async function extractEntries(
  zipPath: string,
  wanted: string[],
  outDir: string,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    let pending = 0;
    let readDone = false;
    const finishMaybe = () => {
      if (readDone && pending === 0) resolve();
    };
    unzip.onfile = (file) => {
      const base = path.basename(file.name);
      const match = wanted.find((w) => base.toLowerCase() === w.toLowerCase());
      if (!match) return;
      const target = path.join(outDir, base);
      found.set(match, target);
      const out = createWriteStream(target);
      pending++;
      file.ondata = (err, chunk, final) => {
        if (err) {
          out.destroy();
          reject(err);
          return;
        }
        if (chunk) out.write(Buffer.from(chunk));
        if (final) {
          out.end(() => {
            pending--;
            finishMaybe();
          });
        }
      };
      file.start();
    };
    const stream = createReadStream(zipPath);
    stream.on("data", (chunk: string | Buffer) => {
      unzip.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : Buffer.from(chunk), false);
    });
    stream.on("end", () => {
      unzip.push(new Uint8Array(0), true);
      readDone = true;
      finishMaybe();
    });
    stream.on("error", reject);
  });
  return found;
}

/** Stream-parse a CSV file with encoding sniffing; rows via callback. */
async function parseCsvFile(filePath: string, onRow: (row: string[]) => void): Promise<void> {
  const parser = new CsvParser(onRow);
  let decoder: TextDecoder | null = null;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      decoder ??= pickDecoder(bytes.subarray(0, Math.min(bytes.length, 65536)));
      parser.write(decoder.decode(bytes, { stream: true }));
    });
    stream.on("end", () => {
      if (decoder) parser.write(decoder.decode());
      parser.end();
      resolve();
    });
    stream.on("error", reject);
  });
}

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
  },
  async collect(brief: SearchBrief): Promise<CollectResult> {
    if (!brief.fileKey) {
      throw new Error("registry-qc: aucun fichier téléversé — la source est alimentée par fichier");
    }
    const { getFileStream } = await import("@/server/storage");
    const workDir = await mkdtemp(path.join(tmpdir(), "registry-qc-"));
    try {
      // Land the upload in the workdir, then unzip the two CSVs we need.
      const zipPath = path.join(workDir, "upload.zip");
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(zipPath);
        getFileStream(brief.fileKey!)
          .on("error", reject)
          .pipe(out)
          .on("finish", () => resolve())
          .on("error", reject);
      });
      const entries = await extractEntries(zipPath, ["Entreprise.csv", "Nom.csv"], workDir);
      const enterprisePath = entries.get("Entreprise.csv");
      const nomPath = entries.get("Nom.csv");
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
