-- Retain the identity of generic parsers so a later reviewed parser can
-- safely promote those completed files and replace their fallback records.
UPDATE source_files
SET parser_key = 'json_fallback'
WHERE parser_key IS NULL
  AND detected_format = 'json'
  AND status IN ('completed', 'empty')
  AND (
    source_files.status = 'empty'
    OR EXISTS (
      SELECT 1 FROM records
      WHERE records.source_file_id = source_files.id
        AND records.record_type = 'json_item'
    )
  );

UPDATE source_files
SET parser_key = 'html_fallback'
WHERE parser_key IS NULL
  AND detected_format = 'html'
  AND status IN ('completed', 'empty')
  AND (
    source_files.status = 'empty'
    OR EXISTS (
      SELECT 1 FROM records
      WHERE records.source_file_id = source_files.id
        AND records.record_type = 'html_item'
    )
  );

UPDATE source_files
SET parser_key = 'text_fallback'
WHERE parser_key IS NULL
  AND detected_format = 'text'
  AND status IN ('completed', 'empty')
  AND (
    source_files.status = 'empty'
    OR EXISTS (
      SELECT 1 FROM records
      WHERE records.source_file_id = source_files.id
        AND records.record_type = 'text_item'
    )
  );
