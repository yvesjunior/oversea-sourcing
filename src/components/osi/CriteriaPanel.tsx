import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Check, Loader2, Pencil, Plus, Rocket, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CRITERIA_CATEGORIES, type CriteriaCategory } from "@/database/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addCriterionFn, deleteCriterionFn, updateCriterionFn } from "@/lib/criteria-fns";
import { launchSearchFn } from "@/lib/requests-fns";
import type { Criterion } from "@/lib/requests-fns";

type Draft = {
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string;
  required: boolean;
};

const EMPTY_DRAFT: Draft = { category: "other", label: "", value: "", unit: "", required: false };

function CriterionForm({
  draft,
  onChange,
  onSave,
  onCancel,
  busy,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-gold/40 bg-card p-3">
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={draft.category}
          onValueChange={(category) =>
            onChange({ ...draft, category: category as CriteriaCategory })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRITERIA_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category} className="text-xs">
                {t(`criteriaCategories.${category}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={draft.unit}
          onChange={(e) => onChange({ ...draft, unit: e.target.value })}
          placeholder={t("detail.criterionUnit")}
          className="h-8 text-xs"
        />
      </div>
      <Input
        value={draft.label}
        onChange={(e) => onChange({ ...draft, label: e.target.value })}
        placeholder={t("detail.criterionLabel")}
        className="h-8 text-xs"
      />
      <Input
        value={draft.value}
        onChange={(e) => onChange({ ...draft, value: e.target.value })}
        placeholder={t("detail.criterionValue")}
        className="h-8 text-xs"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.required}
          onChange={(e) => onChange({ ...draft, required: e.target.checked })}
        />
        {t("detail.required")}
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("detail.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={busy || !draft.label.trim() || !draft.value.trim()}
        >
          {busy && <Loader2 className="size-3 animate-spin" />} {t("detail.save")}
        </Button>
      </div>
    </div>
  );
}

/** Criteria review/edit (E3). Criteria are parsed at intake and stay editable
 *  while the dossier is open; `showLaunch` only appears on legacy dossiers
 *  paused in "analyzing" (the pre-removal review flow). `editable` = own
 *  workspace + non-terminal status. */
export function CriteriaPanel({
  requestId,
  criteria,
  editable,
  showLaunch,
}: {
  requestId: string;
  criteria: Criterion[];
  editable: boolean;
  showLaunch: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);

  const allowWrites = editable;

  const refresh = () => router.invalidate();

  const startEdit = (criterion: Criterion) => {
    setAdding(false);
    setEditingId(criterion.id);
    setDraft({
      category: criterion.category,
      label: criterion.label,
      value: criterion.value,
      unit: criterion.unit ?? "",
      required: criterion.required,
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        requestId,
        category: draft.category,
        label: draft.label.trim(),
        value: draft.value.trim(),
        unit: draft.unit.trim() || null,
        required: draft.required,
      };
      if (editingId) {
        await updateCriterionFn({ data: { ...payload, id: editingId } });
      } else {
        await addCriterionFn({ data: payload });
      }
      setEditingId(null);
      setAdding(false);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteCriterionFn({ data: { requestId, id } });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    setLaunching(true);
    try {
      await launchSearchFn({ data: { id: requestId } });
      await refresh();
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-secondary/60 p-4">
      <h3 className="text-sm font-semibold">{t("detail.criteriaTitle")}</h3>

      <ul className="mt-3 space-y-2">
        {criteria.map((criterion) =>
          editingId === criterion.id ? (
            <li key={criterion.id}>
              <CriterionForm
                draft={draft}
                onChange={setDraft}
                onSave={() => void save()}
                onCancel={() => setEditingId(null)}
                busy={busy}
              />
            </li>
          ) : (
            <li key={criterion.id} className="group flex items-start gap-2 text-xs">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span className="min-w-0 flex-1 text-muted-foreground">
                <span className="font-medium text-foreground">{criterion.label}</span>
                {" : "}
                {criterion.value}
                {criterion.unit ? ` ${criterion.unit}` : ""}
                {criterion.required && (
                  <span className="ml-1.5 rounded-full bg-gold-soft px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                    {t("detail.required")}
                  </span>
                )}
                {criterion.source === "user" && (
                  <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t("detail.editedByYou")}
                  </span>
                )}
              </span>
              {allowWrites && (
                <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={t("detail.editCriterion")}
                    onClick={() => startEdit(criterion)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("detail.deleteCriterion")}
                    onClick={() => void remove(criterion.id)}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>

      {adding && (
        <div className="mt-3">
          <CriterionForm
            draft={draft}
            onChange={setDraft}
            onSave={() => void save()}
            onCancel={() => setAdding(false)}
            busy={busy}
          />
        </div>
      )}

      {allowWrites && !adding && !editingId && (
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY_DRAFT);
            setAdding(true);
          }}
          className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-3.5" /> {t("detail.addCriterion")}
        </button>
      )}

      {showLaunch && criteria.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">{t("detail.criteriaReadyHint")}</p>
          <Button
            variant="gold"
            size="sm"
            className="w-full"
            onClick={() => void launch()}
            disabled={launching}
          >
            {launching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}{" "}
            {t("detail.launchSearch")}
          </Button>
        </div>
      )}
    </div>
  );
}
