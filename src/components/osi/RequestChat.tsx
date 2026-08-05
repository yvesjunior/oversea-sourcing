import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { Loader2, ScanSearch, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { postChatMessageFn } from "@/lib/chat-fns";
import type { ChatMessage } from "@/lib/requests-fns";

/** Per-request AI chat (E3). Messages persist in request_message; sending
 *  triggers the assistant inline, then the loader is invalidated. */
export function RequestChat({
  requestId,
  messages,
  canChat,
}: {
  requestId: string;
  messages: ChatMessage[];
  canChat: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = content.trim();
    if (!text || pending) return;
    setPending(true);
    setContent("");
    try {
      await postChatMessageFn({ data: { requestId, content: text } });
      await router.invalidate();
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card-surface overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScanSearch className="size-4 text-gold" /> {t("detail.assistant")}
        </h2>
      </div>
      <div className="space-y-4 p-6">
        {messages.length === 0 && !pending && canChat && (
          <p className="text-xs text-muted-foreground">{t("detail.chatEmpty")}</p>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <p className="max-w-sm whitespace-pre-wrap rounded-xl bg-primary p-4 text-xs leading-relaxed text-primary-foreground">
                {message.content}
              </p>
            </div>
          ) : (
            <div
              key={message.id}
              className="max-w-lg whitespace-pre-wrap rounded-xl bg-secondary p-4 text-xs leading-relaxed text-muted-foreground"
            >
              {message.content}
            </div>
          ),
        )}
        {pending && (
          <div className="flex max-w-lg items-center gap-2 rounded-xl bg-secondary p-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-gold" /> {t("detail.chatThinking")}
          </div>
        )}
        {canChat && (
          <form
            onSubmit={(e) => void onSubmit(e)}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border px-4 py-2"
          >
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={pending}
              placeholder={t("detail.chatPlaceholder")}
              className="min-w-0 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={pending}
              aria-label={t("detail.send")}
            >
              <Send className="size-4 text-gold" />
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
