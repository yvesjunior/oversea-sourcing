// Connector #5: Japan's corporate-number registry (Hōjin Bangō, National Tax
// Agency). ~5M corporations — names (kanji, sometimes an official English
// name), addresses, no activity data.
//
// STATIC, FILE-FED source: the NTA download is a session-token form POST
// (probed 2026-08-25 — CSRF token per page), so autonomous fetching is out.
// Staff downloads the "全件データ" Unicode CSV ZIPs (published as ~15 chunks;
// upload them one by one — each pull is an idempotent partial sync that
// accumulates in the store) and later the monthly diff files the same way.
//
// File format (NTA spec): headerless CSV, 30 fixed positions. Kept when the
// row is the latest record (col 24), not closed (col 19 empty), displayed
// (col 30 ≠ 1), and not a government body (kind 101/201). Name = official
// English name when present, else the registered (kanji) name — the dedup
// key tokenizer is Unicode-aware since 2026-08-25 exactly for this.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractEntries, isZip, landUpload, parseCsvFile } from "@/server/sources/file-tools";
import type { CollectResult, SearchBrief, SupplierSourceConnector } from "@/server/sources/types";

/** Registry-attested existence, zero product evidence — like registry-ca. */
const REGISTRY_JP_CONFIDENCE = 60;

// NTA zenken CSV positions (0-based).
const COL = {
  corporateNumber: 1,
  name: 6,
  kind: 8,
  prefecture: 9,
  city: 10,
  postCode: 15,
  closeDate: 18,
  latest: 23,
  enName: 24,
  hihyoji: 29,
} as const;

/** 国の機関 (101) and 地方公共団体 (201) — government bodies, not suppliers. */
const GOVERNMENT_KINDS = new Set(["101", "201"]);

export const registryJpConnector: SupplierSourceConnector = {
  meta: {
    code: "registry-jp",
    type: "country_registry",
    countryCode: "JP",
    name: "Registre des sociétés du Japon (NTA)",
    requiresFile: true,
    downloadUrl: "https://www.houjin-bangou.nta.go.jp/download/zenken/",
  },
  async collect(brief: SearchBrief): Promise<CollectResult> {
    if (!brief.fileKey) {
      throw new Error("registry-jp: aucun fichier téléversé — la source est alimentée par fichier");
    }
    const workDir = await mkdtemp(path.join(tmpdir(), "registry-jp-"));
    try {
      const uploadPath = path.join(workDir, "upload.bin");
      await landUpload(brief.fileKey, uploadPath);

      // The NTA publishes ZIPs each holding one CSV; accept a bare CSV too.
      let csvPaths: string[];
      if (await isZip(uploadPath)) {
        await extractEntries(uploadPath, (base) => base.toLowerCase().endsWith(".csv"), workDir);
        csvPaths = (await readdir(workDir))
          .filter((f) => f.toLowerCase().endsWith(".csv"))
          .map((f) => path.join(workDir, f));
        if (csvPaths.length === 0) {
          throw new Error("registry-jp: aucune entrée CSV dans le ZIP téléversé");
        }
      } else {
        csvPaths = [uploadPath];
      }

      const candidates: CollectResult["candidates"] = [];
      let totalRows = 0;
      let skipped = 0;
      for (const csvPath of csvPaths) {
        await parseCsvFile(csvPath, (row) => {
          totalRows++;
          const cell = (index: number) => row[index]?.trim() ?? "";
          if (cell(COL.latest) !== "1") return;
          if (cell(COL.closeDate)) return; // closed corporation
          if (cell(COL.hihyoji) === "1") return; // suppressed record
          if (GOVERNMENT_KINDS.has(cell(COL.kind))) {
            skipped++;
            return;
          }
          const name = cell(COL.enName) || cell(COL.name);
          if (!name) return;
          const corp = cell(COL.corporateNumber);
          candidates.push({
            name,
            countryCode: "JP",
            website: null,
            descriptor: null,
            // No fabrication: the registry says nothing about what they make.
            description: null,
            confidence: REGISTRY_JP_CONFIDENCE,
            sourceUrl: corp
              ? `https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=${encodeURIComponent(corp)}`
              : null,
            raw: {
              corp,
              kind: cell(COL.kind),
              prefecture: cell(COL.prefecture),
              city: cell(COL.city),
              postal: cell(COL.postCode),
            },
          });
        });
      }

      console.log(
        `registry-jp: ${totalRows} rows across ${csvPaths.length} file(s) — ` +
          `${candidates.length} active corporations kept, ${skipped} government bodies skipped`,
      );
      return { candidates, queries: [`fichier téléversé: ${brief.fileKey}`] };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  },
};
