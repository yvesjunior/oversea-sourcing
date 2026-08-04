import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The employee view pattern: every data page splits into "Vue globale"
 *  (all buyers' data) and "Mes données" (the employee's own). */
export function EmployeeTabs({
  global,
  mine,
  globalCount,
  mineCount,
}: {
  global: ReactNode;
  mine: ReactNode;
  globalCount?: number;
  mineCount?: number;
}) {
  const { t } = useTranslation();
  const label = (key: string, count?: number) =>
    count === undefined ? t(key) : `${t(key)} (${count})`;

  return (
    <Tabs defaultValue="tous">
      <TabsList>
        <TabsTrigger value="tous">{label("home.tabAll", globalCount)}</TabsTrigger>
        <TabsTrigger value="miens">{label("home.tabMine", mineCount)}</TabsTrigger>
      </TabsList>
      <TabsContent value="tous" className="mt-5">
        {global}
      </TabsContent>
      <TabsContent value="miens" className="mt-5">
        {mine}
      </TabsContent>
    </Tabs>
  );
}

/** Truthful empty state for a "Mes données" tab without content yet. */
export function MineEmpty() {
  const { t } = useTranslation();
  return (
    <p className="card-surface border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
      {t("tabs.nothingMine")}
    </p>
  );
}
