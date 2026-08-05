import { cn } from "@/lib/utils";

export type EtapeEtat = "termine" | "encours" | "attente";

/** `titre` and `detail` are display strings — callers translate (details are
 *  often dynamic timestamps since E3). */
export type Etape = { titre: string; detail: string; etat: EtapeEtat };

const puces: Record<EtapeEtat, string> = {
  termine: "bg-success border-success",
  encours: "bg-gold border-gold",
  attente: "bg-card border-border",
};

export function Timeline({ etapes, className }: { etapes: Etape[]; className?: string }) {
  return (
    <ol className={cn("relative space-y-6", className)}>
      {etapes.map((etape, i) => (
        <li key={etape.titre} className="relative flex gap-4">
          <span className="relative flex flex-col items-center">
            <span className={cn("size-4 shrink-0 rounded-full border-2", puces[etape.etat])} />
            {i < etapes.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
          </span>
          <span className="min-w-0 pb-1">
            <span className="block truncate text-sm font-semibold">{etape.titre}</span>
            <span
              className={cn(
                "block truncate text-xs",
                etape.etat === "encours" ? "text-gold" : "text-muted-foreground",
              )}
            >
              {etape.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
