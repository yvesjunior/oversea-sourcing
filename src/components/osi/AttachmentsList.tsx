import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AttachmentView } from "@/lib/requests-fns";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Request attachments — read-only, and only when there are any.
 *
 * Adding a file here used to be possible, but it did nothing: research runs
 * once during the `searching` stage and the `research_run` guard blocks a
 * re-run, so a late upload was stored and never opened. Attachments are
 * therefore part of *creating* a request (the hero prompt), not of editing one;
 * this list exists to show which documents the criteria came from.
 */
export function AttachmentsList({ attachments }: { attachments: AttachmentView[] }) {
  const { t } = useTranslation();
  if (attachments.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">{t("detail.attachments")}</h3>
      <ul className="mt-2 space-y-1.5">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex items-center gap-2 text-xs">
            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
            <a
              href={`/api/files/${attachment.fileId}`}
              className="min-w-0 truncate text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {attachment.filename}
            </a>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatSize(attachment.size)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
