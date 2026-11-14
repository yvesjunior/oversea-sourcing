// The contacts OSI holds for one supplier (Phase V · V02) — staff only.
//
// Loaded when the dialog opens rather than with the directory: the list is
// every supplier in the pool, and shipping every address to the browser to
// show a count would be shipping far more than the screen needs.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTACT_LOCALES, type ContactLocale } from "@/database/schema";
import {
  addSupplierContactFn,
  getSupplierContactsFn,
  removeSupplierContactFn,
  setPrimarySupplierContactFn,
  type ContactMutationResult,
  type SupplierContactView,
} from "@/lib/supplier-fns";

const EMPTY_FORM = { email: "", name: "", role: "", phone: "", locale: "en" as ContactLocale };

export function SupplierContactsDialog({
  supplier,
  onClose,
  onChanged,
}: {
  /** Null = closed. */
  supplier: { id: string; name: string } | null;
  onClose: () => void;
  /** The directory's count is stale after any change. */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<SupplierContactView[] | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<
    Exclude<ContactMutationResult, { ok: true }>["reason"] | null
  >(null);
  const supplierId = supplier?.id ?? null;

  const load = useCallback(async (id: string) => {
    const result = await getSupplierContactsFn({ data: { supplierId: id } });
    setContacts(result.contacts);
  }, []);

  useEffect(() => {
    setContacts(null);
    setForm(EMPTY_FORM);
    setProblem(null);
    if (supplierId) void load(supplierId);
  }, [supplierId, load]);

  const run = async (action: () => Promise<ContactMutationResult>): Promise<boolean> => {
    if (!supplierId) return false;
    setBusy(true);
    setProblem(null);
    try {
      const result = await action();
      if (!result.ok) {
        setProblem(result.reason);
        return false;
      }
      await load(supplierId);
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!supplierId) return;
    const added = await run(() =>
      addSupplierContactFn({
        data: {
          supplierId,
          email: form.email,
          name: form.name || null,
          role: form.role || null,
          phone: form.phone || null,
          locale: form.locale,
        },
      }),
    );
    if (added) setForm(EMPTY_FORM);
  };

  return (
    <Dialog open={supplier !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("contacts.title", { supplier: supplier?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("contacts.subtitle")}</DialogDescription>
        </DialogHeader>

        {contacts === null ? (
          <p className="text-sm text-muted-foreground">{t("contacts.loading")}</p>
        ) : contacts.length === 0 ? (
          <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
            {t("contacts.none")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {contacts.map((contact) => (
              <li
                key={contact.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <a
                      href={`mailto:${contact.email}`}
                      className="truncate underline-offset-2 hover:underline"
                    >
                      {contact.email}
                    </a>
                    {contact.isPrimary ? (
                      <span className="rounded bg-gold-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        {t("contacts.primary")}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      contact.name,
                      contact.role,
                      contact.phone,
                      contact.locale.toUpperCase(),
                      t(`contacts.source.${contact.source}`),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!contact.isPrimary ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      title={t("contacts.makePrimary")}
                      aria-label={`${t("contacts.makePrimary")} — ${contact.email}`}
                      onClick={() =>
                        void run(() => setPrimarySupplierContactFn({ data: { id: contact.id } }))
                      }
                    >
                      <Star className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    title={t("contacts.remove")}
                    aria-label={`${t("contacts.remove")} — ${contact.email}`}
                    onClick={() =>
                      void run(() => removeSupplierContactFn({ data: { id: contact.id } }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-3 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("contacts.addTitle")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="contact-email" className="text-xs text-muted-foreground">
                {t("contacts.email")}
              </Label>
              <Input
                id="contact-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="h-8"
              />
            </div>
            <div>
              <Label htmlFor="contact-name" className="text-xs text-muted-foreground">
                {t("contacts.name")}
              </Label>
              <Input
                id="contact-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-8"
              />
            </div>
            <div>
              <Label htmlFor="contact-role" className="text-xs text-muted-foreground">
                {t("contacts.role")}
              </Label>
              <Input
                id="contact-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="h-8"
              />
            </div>
            <div>
              <Label htmlFor="contact-phone" className="text-xs text-muted-foreground">
                {t("contacts.phone")}
              </Label>
              <Input
                id="contact-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="h-8"
              />
            </div>
            <div>
              <Label htmlFor="contact-locale" className="text-xs text-muted-foreground">
                {t("contacts.locale")}
              </Label>
              <select
                id="contact-locale"
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value as ContactLocale })}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {CONTACT_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`contacts.locales.${locale}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {problem ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {t(`contacts.problem.${problem}`)}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !form.email.trim()}>
              <Mail className="size-4" />
              {t("contacts.add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
