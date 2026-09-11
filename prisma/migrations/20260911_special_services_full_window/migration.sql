-- A special service is a single sellable slot. Its full window is reserved by
-- the first booking, so legacy duration/interval values are normalized here.
UPDATE "SpecialService"
SET
  "intervalMin" = EXTRACT(EPOCH FROM ("endTime"::time - "startTime"::time))::integer / 60,
  "durationMinutes" = EXTRACT(EPOCH FROM ("endTime"::time - "startTime"::time))::integer / 60,
  "turnoverMinutes" = 0
WHERE "endTime"::time > "startTime"::time;
