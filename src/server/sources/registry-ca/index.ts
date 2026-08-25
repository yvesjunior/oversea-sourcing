// Connector #2: the Canadian federal corporations registry (Corporations
// Canada bulk open data — Open Government Licence, commercial use OK; the
// route selected by the C2 investigation, README §9).
//
// STATIC source: `collect` is a FULL PULL of the "Active business
// corporations" CSV (~640k rows, ~100 MB, refreshed daily upstream) — the
// brief is ignored, dedup makes every pull idempotent. Streamed and parsed
// here (self-contained RFC 4180 parser — a connector brings its own tooling),
// normalized to SourceCandidate; persistence, dedup and promotion belong to
// the platform core, never to this module.
//
// Registry data carries NO product/activity information — a record here can
// only ever match a request by company-NAME tokens. Its real value is
// existence/attestation (E10 verification); as a discovery source it is
// deliberately conservative: confidence 60, no description, and
// numbered companies ("9001234 CANADA INC.") are skipped — a name that is
// just digits can never be a meaningful match but WOULD false-match numeric
// criteria tokens like "ISO 9001".

import type { CollectResult, SearchBrief, SupplierSourceConnector } from "@/server/sources/types";

const CSV_URL = "https://d4bf66bykfyaf.cloudfront.net/corporations-active-cbca-en.csv";

/** Registry-attested existence, zero product evidence — below every
 *  AI-researched candidate that carries an actual description. */
const REGISTRY_CONFIDENCE = 60;

/** Incremental RFC 4180 parser — handles quoted fields, escaped quotes and
 *  CRLF across chunk boundaries without ever holding the file as one string. */
class CsvParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  /** Set when the previous chunk ended on a quote inside a quoted field. */
  private pendingQuote = false;

  constructor(private readonly onRow: (row: string[]) => void) {}

  write(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false;
        // fall through: ch is a regular delimiter/char after a closing quote
      }
      if (this.inQuotes) {
        if (ch === '"') {
          if (i + 1 < chunk.length) {
            if (chunk[i + 1] === '"') {
              this.field += '"';
              i++;
            } else {
              this.inQuotes = false;
            }
          } else {
            this.pendingQuote = true; // resolved by the next chunk
          }
        } else {
          this.field += ch;
        }
        continue;
      }
      if (ch === '"' && this.field === "") {
        this.inQuotes = true;
      } else if (ch === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (ch === "\n") {
        this.row.push(this.field.endsWith("\r") ? this.field.slice(0, -1) : this.field);
        this.field = "";
        this.onRow(this.row);
        this.row = [];
      } else {
        this.field += ch;
      }
    }
  }

  end(): void {
    if (this.field !== "" || this.row.length > 0) {
      this.row.push(this.field.endsWith("\r") ? this.field.slice(0, -1) : this.field);
      this.onRow(this.row);
      this.row = [];
      this.field = "";
    }
  }
}

/** Names that are just a corporation number carry no searchable identity —
 *  and their digits false-match numeric criteria tokens. */
const NUMBERED_NAME =
  /^\d[\d\s-]*(canada|ontario|quebec|québec|alberta|b\.?c\.?)?\s*(inc|ltd|ltée|ltee|corp|limited|incorporated)?\.?$/i;

export const registryCaConnector: SupplierSourceConnector = {
  meta: {
    code: "registry-ca",
    type: "country_registry",
    countryCode: "CA",
    name: "Registre fédéral canadien (Corporations Canada)",
  },
  async collect(_brief: SearchBrief): Promise<CollectResult> {
    const response = await fetch(CSV_URL);
    if (!response.ok || !response.body) {
      throw new Error(`registry-ca: CSV download failed (HTTP ${response.status})`);
    }

    const candidates: CollectResult["candidates"] = [];
    let header: string[] | null = null;
    let col: Record<string, number> = {};
    let skippedNumbered = 0;

    const parser = new CsvParser((row) => {
      if (!header) {
        // Strip the BOM the file starts with before mapping columns.
        header = row.map((h) => h.replace(/^\uFEFF/, "").trim());
        col = Object.fromEntries(header.map((h, i) => [h, i]));
        return;
      }
      const cell = (name: string) => row[col[name] ?? -1]?.trim() ?? "";
      const name = cell("Corporate name - form 1") || cell("Corporate name - form 2");
      if (!name) return;
      if (NUMBERED_NAME.test(name)) {
        skippedNumbered++;
        return;
      }
      const corp = cell("Corporation number");
      candidates.push({
        name,
        countryCode: (cell("Country") || "CA").toUpperCase(),
        website: null,
        descriptor: null,
        // No fabrication: the registry says nothing about what they make.
        description: null,
        confidence: REGISTRY_CONFIDENCE,
        sourceUrl: corp
          ? `https://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?corpId=${encodeURIComponent(corp)}`
          : null,
        raw: {
          corp,
          bn: cell("Business number (BN)"),
          statusDetail: cell("Status Detail"),
          city: cell("City/town"),
          province: cell("Province/territory"),
          postal: cell("Postal code"),
        },
      });
    });

    const decoder = new TextDecoder("utf-8");
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.write(decoder.decode(value, { stream: true }));
    }
    parser.write(decoder.decode());
    parser.end();

    console.log(
      `registry-ca: parsed ${candidates.length + skippedNumbered} active corporations — ` +
        `${candidates.length} kept, ${skippedNumbered} numbered names skipped`,
    );
    return { candidates, queries: [CSV_URL] };
  },
};
