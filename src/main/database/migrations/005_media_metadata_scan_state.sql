-- Persist bounded image/video metadata scan attempts so gallery indexing
-- advances across app restarts instead of repeatedly retrying the same files.
ALTER TABLE media_assets
ADD COLUMN metadata_scan_attempted INTEGER NOT NULL DEFAULT 0
CHECK (metadata_scan_attempted IN (0, 1));

UPDATE media_assets
SET metadata_scan_attempted = 1
WHERE (width IS NOT NULL AND height IS NOT NULL)
   OR duration_ms IS NOT NULL;
