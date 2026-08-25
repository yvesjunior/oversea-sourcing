// data_source.code → connector module. The core never imports a connector
// directly — only through here — and a `data_source` row with no registered
// connector is simply store-only (registries refreshed by admin trigger, or a
// code that isn't implemented yet): getConnector returns undefined, never throws.

import type { SupplierSourceConnector } from "@/server/sources/types";
import { globalWebConnector } from "@/server/sources/global-web";
import { registryCaConnector } from "@/server/sources/registry-ca";
import { registryQcConnector } from "@/server/sources/registry-qc";

const CONNECTORS: readonly SupplierSourceConnector[] = [
  globalWebConnector,
  registryCaConnector,
  registryQcConnector,
];

const byCode = new Map(CONNECTORS.map((connector) => [connector.meta.code, connector]));

export function getConnector(code: string): SupplierSourceConnector | undefined {
  return byCode.get(code);
}
