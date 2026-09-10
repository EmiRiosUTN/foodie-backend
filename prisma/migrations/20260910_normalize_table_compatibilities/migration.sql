-- TableCombination now represents a symmetric compatibility edge. Normalize
-- historical edges so A-B and B-A cannot coexist after a layout is saved.
DELETE FROM "TableCombination" AS duplicate
USING "TableCombination" AS canonical
WHERE duplicate.id > canonical.id
  AND LEAST(duplicate."parentTableId", duplicate."childTableId") = LEAST(canonical."parentTableId", canonical."childTableId")
  AND GREATEST(duplicate."parentTableId", duplicate."childTableId") = GREATEST(canonical."parentTableId", canonical."childTableId");

UPDATE "TableCombination"
SET "parentTableId" = LEAST("parentTableId", "childTableId"),
    "childTableId" = GREATEST("parentTableId", "childTableId");
