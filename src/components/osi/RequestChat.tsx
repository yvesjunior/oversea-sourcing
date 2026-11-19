import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { Check, Loader2, ScanSearch, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { askClarificationFn, resolveProposalFn } from "@/lib/chat-fns";
import { CLARIFY_MESSAGE_MAX } from "@/lib/clarification";
import type { ChatMessage, ProposalView } from "@/lib/requests-fns";
import { cn } from "@/lib/utils";

/**
 * The clarification before launch (Phase V · V18).
 *
 * The buyer asks the assistant to read a draft; it restates the need, asks
 * what is missing and PROPOSES criteria. Nothing it proposes is a criterion
 * until the buyer accepts it here, one proposal at a time.
 *
 * Three states, by what the buyer may still do:
 *   - `canAsk`      a draft, on a working seat: ask, answer, decide.
 *   - `canResolve`  launched but criteria still editable: the exchange is
 *                   closed, proposals left open can still be answered —
 *                   exactly as the edit form still works at that moment.
 *   - neither       a transcript.
 */
export function RequestChat({
  requestId,
  messages,
  canAsk,
  canResolve,
  frozen,
  turnsLeft,
}: {
  requestId: string;
  messages: ChatMessage[];
  canAsk: boolean;
  canResolve: boolean;
  /** The criteria can no longer change for anyone (the search answered, or
   *  the request is over): a proposal still pending will stay unanswered. */
  frozen: boolean;
  turnsLeft: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const started = messages.some((m) => m.role === "assistant");
  const mayAsk = canAsk && turnsLeft > 0;

  const ask = async (text: string | null) => {
    if (pending) return;
    setPending(true);
    setRefusal(null);
    try {
      const result = await askClarificationFn({
        data: { requestId, ...(text ? { content: text } : {}) },
      });
      // `unavailable` and `no_answer` already left a line in the transcript;
      // the others have nothing on the page to explain them.
      if (!result.ok && result.reason !== "unavailable" && result.reason !== "no_answer") {
        setRefusal(result.reason);
      }
      await router.invalidate();
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = content.trim();
    if (!text) return;
    setContent("");
    void ask(text);
  };

  const resolve = async (proposal: ProposalView, accept: boolean) => {
    if (resolving) return;
    setResolving(proposal.id);
    setRefusal(null);
    try {
      const result = await resolveProposalFn({
        data: { requestId, proposalId: proposal.id, accept },
      });
      if (!result.ok && result.reason !== "not_pending") setRefusal(result.reason);
      await router.invalidate();
    } finally {
      setResolving(null);
    }
  };

  return (
    <section className="card-surface overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-6 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScanSearch className="size-4 text-gold" /> {t("detail.assistant")}
        </h2>
        {canAsk && (
          <span className="text-xs text-muted-foreground">
            {t("clarify.turnsLeft", { count: turnsLeft })}
          </span>
        )}
      </div>
      <div className="space-y-4 p-6">
        {!started && !pending && canAsk && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("clarify.intro")}</p>
            <Button type="button" variant="gold" disabled={!mayAsk} onClick={() => void ask(null)}>
              <ScanSearch className="size-4" /> {t("clarify.ask")}
            </Button>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <p className="max-w-sm whitespace-pre-wrap rounded-xl bg-primary p-4 text-xs leading-relaxed text-primary-foreground">
                {message.content}
              </p>
            </div>
          ) : (
            <div key={message.id} className="max-w-xl space-y-3 rounded-xl bg-secondary p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>

              {message.questions && message.questions.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("clarify.questions")}
                  </h3>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                    {message.questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ol>
                </div>
              )}

              {message.proposals.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("clarify.proposals")}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {message.proposals.map((proposal) => (
                      <li
                        key={proposal.id}
                        className={cn(
                          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-background p-3",
                          proposal.status !== "pending" && "opacity-70",
                        )}
                      >
                        <div className="min-w-0 text-sm">
                          <span className="mr-2 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold">
                            {t(`clarify.op.${proposal.op}`)}
                          </span>
                          <span className="font-medium">{proposal.label}</span>
                          {" : "}
                          {proposal.previous && (
                            <span className="mr-1 text-muted-foreground line-through">
                              {proposal.previous}
                            </span>
                          )}
                          <span className={cn(proposal.op === "remove" && "line-through")}>
                            {proposal.value}
                          </span>
                          {/* A flipped obligation IS the change (sometimes the
                              only one), so it is said as a change; an
                              unchanged one is only a property of the row. */}
                          {proposal.requiredChange ? (
                            <span className="ml-2 text-[11px] font-semibold text-gold">
                              {t(`clarify.${proposal.requiredChange}`)}
                            </span>
                          ) : (
                            proposal.required &&
                            proposal.op !== "remove" && (
                              <span className="ml-2 text-[11px] text-muted-foreground">
                                {t("clarify.required")}
                              </span>
                            )
                          )}
                        </div>
                        {proposal.status === "pending" && canResolve ? (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="gold"
                              disabled={resolving !== null}
                              onClick={() => void resolve(proposal, true)}
                            >
                              {resolving === proposal.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Check className="size-3.5" />
                              )}
                              {t("clarify.accept")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={resolving !== null}
                              onClick={() => void resolve(proposal, false)}
                            >
                              <X className="size-3.5" /> {t("clarify.dismiss")}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {/* Still pending on a request whose criteria
                                are frozen: nobody will answer it now, and
                                "waiting" would promise that someone might. */}
                            {t(
                              `clarify.status.${proposal.status === "pending" && frozen ? "unanswered" : proposal.status}`,
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ),
        )}

        {pending && (
          <div className="flex max-w-lg items-center gap-2 rounded-xl bg-secondary p-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-gold" /> {t("detail.chatThinking")}
          </div>
        )}

        {refusal && (
          <p role="alert" className="text-xs text-destructive">
            {t(`clarify.refused.${refusal}`)}
          </p>
        )}

        {started && canAsk && turnsLeft === 0 && (
          <p className="text-xs text-muted-foreground">{t("clarify.limitReached")}</p>
        )}
        {started && !canAsk && (
          <p className="text-xs text-muted-foreground">{t("clarify.closed")}</p>
        )}

        {started && mayAsk && (
          <form
            onSubmit={onSubmit}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border px-4 py-2"
          >
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={pending}
              maxLength={CLARIFY_MESSAGE_MAX}
              placeholder={t("clarify.placeholder")}
              aria-label={t("clarify.placeholder")}
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
