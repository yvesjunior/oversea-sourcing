// Searchable category picker over the ADR-001 taxonomy (S2 refinement) —
// a combobox, not a 78-option select. Search is accent-insensitive and
// matches BOTH locales plus each node's matching keywords, so typing
// "pump", "pompe" or "hydraulique" all land on the right node whatever the
// UI language. Reusable wherever a category is picked (form, future
// criteria editor, staff screens).

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeText } from "@/lib/match-tokens";
import { categoryLabel, childrenOf, rootCategories, type CategoryNode } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";

export function CategoryCombobox({
  value,
  onChange,
  triggerId,
}: {
  value: string;
  onChange: (categoryId: string) => void;
  /** Lets a <label htmlFor> target the trigger button. */
  triggerId?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const name = (node: CategoryNode) => (i18n.language.startsWith("fr") ? node.fr : node.en);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const item = (node: CategoryNode, label: string) => (
    <CommandItem
      key={node.id}
      value={node.id}
      // Both locales + the node's matching vocabulary: the search field
      // finds "Pompes" from "pump" and "Électrique" from "electrique".
      keywords={[node.fr, node.en, ...node.keywords]}
      onSelect={pick}
    >
      <Check className={cn("mr-2 size-4", value === node.id ? "opacity-100" : "opacity-0")} />
      {label}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between px-3 font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? categoryLabel(value, i18n.language) : t("home.form.categoryPlaceholder")}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <Command
          // Accent-insensitive contains-match over the id + keywords —
          // cmdk's default scorer is accent-sensitive, which would hide
          // "Électrique" from a buyer typing "electrique".
          filter={(itemValue, search, keywords) => {
            const haystack = normalizeText(`${itemValue} ${(keywords ?? []).join(" ")}`);
            return haystack.includes(normalizeText(search.trim())) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={t("home.form.categorySearch")} />
          <CommandList className="max-h-64">
            <CommandEmpty>{t("home.form.categoryNone")}</CommandEmpty>
            {rootCategories().map((sector) => (
              <CommandGroup key={sector.id} heading={name(sector)}>
                {item(sector, t("home.form.sectorGeneral", { name: name(sector) }))}
                {childrenOf(sector.id).map((node) => item(node, name(node)))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
