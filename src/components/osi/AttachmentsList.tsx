import { useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Loader2, Paperclip, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AttachmentView } from "@/lib/requests-fns";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Request attachments (E3): list + download links + add (own workspace only). */
export function AttachmentsList({
  requestId,
  attachments,
  canEdit,
}: {
  requestId: string;
  attachments: AttachmentView[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (attachments.length === 0 && !canEdit) return null;

  const upload = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("requestId", requestId);
      for (const file of Array.from(picked)) form.append("files", file);
      await fetch("/api/upload", { method: "POST", body: form });
      await router.invalidate();
    } finally {
      setUploading(false);
    }
  };

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
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv"
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}{" "}
            {t("detail.addAttachment")}
          </button>
        </>
      )}
    </div>
  );
}
