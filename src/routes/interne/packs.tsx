// The release queue (Phase V · V11) — every Decision Pack awaiting a decision,
// the one that has waited longest first, with whose desk it is on.
//
// The diagram's step 10 happens here: nothing reaches a buyer until a person
// has looked. So the two things this page must make impossible to miss are a
// pack that has waited too long, and a pack nobody has taken. The four
// actions themselves live on the dossier, beside the offers they are about;
// this page is the desk, and its one act is taking a pack onto it.

import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronRight, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { formatDayTime } from "@/lib/instant";
import { assignPackFn, getPackQueueFn, type PackQueueData, type QueuedPack } from "@/lib/pack-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/interne/packs")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "deals"),
  head: () => ({
    meta: [{ title: "Decision Packs | OSI" }, { name: "robots", content: "noindex" }],
  }),
  loader: async (): Promise<PackQueueData> => (await getPackQueueFn()) ?? { packs: [], me: "" },
  component: PackQueue,
});

/** "3 h", "2 j 4 h" — how long a pack has waited on a person. Rendered from
 *  the loader's instant, so the server and the browser print the same text. */
function waited(since: string | null, now: number): string {
  if (!since) return "—";
  const hours = Math.max(0, Math.floor((now - new Date(since).getTime()) / 3_600_000));
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function PackRowView({
  pack,
  me,
  now,
  onChanged,
}: {
  pack: QueuedPack;
  me: string;
  now: number;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const mine = pack.assignedTo === me;

  const assign = async (take: boolean) => {
    setBusy(true);
    try {
      await assignPackFn({ data: { packId: pack.packId, take } });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <Link
          to="/demandes/$id"
          params={{ id: pack.requestId }}
          className="group flex items-center gap-2 text-sm font-semibold transition-colors hover:text-gold"
        >
          <span className="truncate">
            #{pack.requestId} — {pack.requestTitle}
          </span>
          <ChevronRight className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {pack.organizationName} ·{" "}
          {pack.items === 0 ? (
            <span className="font-medium text-warning">{t("packQueue.empty")}</span>
          ) : (
            t("packQueue.items", { count: pack.items })
          )}
        </p>
        <p className="mt-1 text-xs">
          {pack.state === "review" ? (
            <>
              <span className="font-semibold tabular-nums">
                {t("packQueue.waiting", { age: waited(pack.waitingSince, now) })}
              </span>
              {pack.waitingSince && (
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {t("packQueue.since", { date: formatDayTime(pack.waitingSince, i18n.language) })}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">{t("packQueue.relaunched")}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {pack.assignedToName ? (
          <span className="text-xs">{t("pack.onDeskOf", { name: pack.assignedToName })}</span>
        ) : (
          // An unassigned pack must LOOK unassigned — it is the one nobody
          // is going to open.
          <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" />
            {t("pack.unassigned")}
          </span>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void assign(!mine)}>
          {t(mine ? "pack.putBackAction" : "pack.take")}
        </Button>
      </div>
    </li>
  );
}

function PackQueue() {
  const { t } = useTranslation();
  const router = useRouter();
  const { packs, me } = Route.useLoaderData();
  // One instant for the whole render, taken once per load.
  const [now] = useState(() => Date.now());
  const refresh = () => void router.invalidate();
  const review = packs.filter((pack) => pack.state === "review");
  const relaunched = packs.filter((pack) => pack.state === "relaunched");

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("packQueue.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("packQueue.subtitle")}</p>
      </header>

      <section className="card-surface p-5">
        <h2 className="mb-3 text-base font-bold">
          {t("packQueue.review", { count: review.length })}
        </h2>
        {review.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <PackageCheck className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">{t("packQueue.none")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {review.map((pack) => (
              <PackRowView key={pack.packId} pack={pack} me={me} now={now} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      {relaunched.length > 0 && (
        <section className={cn("card-surface p-5")}>
          <h2 className="mb-1 text-base font-bold">
            {t("packQueue.relaunchedTitle", { count: relaunched.length })}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("packQueue.relaunchedHint")}</p>
          <ul className="space-y-2">
            {relaunched.map((pack) => (
              <PackRowView key={pack.packId} pack={pack} me={me} now={now} onChanged={refresh} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
