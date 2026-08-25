// Incremental RFC 4180 CSV parser shared by the registry connectors —
// handles quoted fields, escaped quotes and CRLF across chunk boundaries
// without ever holding a file as one string.

export class CsvParser {
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

/** Map a header row (BOM-stripped, trimmed) to column indexes. */
export function headerIndex(row: string[]): Record<string, number> {
  return Object.fromEntries(row.map((h, i) => [h.replace(/^\uFEFF/, "").trim(), i]));
}

/** Names that are just a corporation number ("9264-1234 QU\u00C9BEC INC.",
 *  "8660115 CANADA LTD") carry no searchable identity \u2014 and their digits
 *  false-match numeric criteria tokens like "ISO 9001". */
export const NUMBERED_NAME =
  /^\d[\d\s-]*(canada|ontario|quebec|qu\u00E9bec|alberta|b\.?c\.?)?\s*(inc|ltd|lt\u00E9e|ltee|corp|limited|incorporated)?\.?$/i;
