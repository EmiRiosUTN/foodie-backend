import { z } from "zod";

export const preferredFeatureSchema = z.enum([
  "nearWindow",
  "nearColumn",
  "nearWall",
  "nearCorridor",
  "hasWindowView"
]);

export const preferredFeaturesSchema = z.array(preferredFeatureSchema).max(4).optional().default([]);

export type PreferredFeature = z.infer<typeof preferredFeatureSchema>;

export type TableFeatures = Record<PreferredFeature, boolean>;

type TableMetadata = {
  derivedFeatures?: Partial<Pick<TableFeatures, "nearWindow" | "nearColumn" | "nearWall" | "nearCorridor">>;
  manualFeatures?: {
    hasWindowView?: boolean;
  };
};

type SelectableTable = {
  metadata?: unknown;
};

export function getTableFeatures(table: SelectableTable): TableFeatures {
  const metadata = (table.metadata || {}) as TableMetadata;

  return {
    nearWindow: metadata.derivedFeatures?.nearWindow === true,
    nearColumn: metadata.derivedFeatures?.nearColumn === true,
    nearWall: metadata.derivedFeatures?.nearWall === true,
    nearCorridor: metadata.derivedFeatures?.nearCorridor === true,
    hasWindowView: metadata.manualFeatures?.hasWindowView === true
  };
}

export function tableMatchesPreferredFeatures(table: SelectableTable, preferredFeatures: PreferredFeature[]) {
  return preferredFeatures.every((feature) => getTableFeatures(table)[feature]);
}

export function getSharedTableFeatures(tables: SelectableTable[]): TableFeatures {
  const features = tables.map(getTableFeatures);
  return {
    nearWindow: features.every((item) => item.nearWindow),
    nearColumn: features.every((item) => item.nearColumn),
    nearWall: features.every((item) => item.nearWall),
    nearCorridor: features.every((item) => item.nearCorridor),
    hasWindowView: features.every((item) => item.hasWindowView)
  };
}
