import { cn } from "@/lib/utils";

export function ScoreRing({
  valeur,
  taille = 40,
  className,
}: {
  valeur: number;
  taille?: number;
  className?: string;
}) {
  const r = (taille - 5) / 2;
  const c = 2 * Math.PI * r;

  return (
    <svg
      width={taille}
      height={taille}
      viewBox={`0 0 ${taille} ${taille}`}
      className={cn("shrink-0 -rotate-90", className)}
      role="img"
      aria-label={`${valeur}%`}
    >
      <circle
        cx={taille / 2}
        cy={taille / 2}
        r={r}
        fill="none"
        strokeWidth="4"
        className="stroke-muted"
      />
      <circle
        cx={taille / 2}
        cy={taille / 2}
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * valeur) / 100}
        className="stroke-success"
      />
    </svg>
  );
}
