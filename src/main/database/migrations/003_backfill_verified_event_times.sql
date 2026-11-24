-- Backfill only timestamps that can be interpreted without guessing a timezone.
-- Localized Facebook HTML dates remain in event_time_raw until their timezone
-- and locale can be established from export evidence.

UPDATE records
SET event_time_utc = strftime(
  '%Y-%m-%dT%H:%M:%fZ',
  CAST(event_time_raw AS INTEGER),
  'unixepoch'
)
WHERE event_time_utc IS NULL
  AND section_key IN ('posts', 'comments', 'likes_and_reactions')
  AND length(event_time_raw) = 10
  AND event_time_raw NOT GLOB '*[^0-9]*'
  AND CAST(event_time_raw AS INTEGER) BETWEEN 946684800 AND 4102444800;

UPDATE records
SET event_time_utc = strftime(
  '%Y-%m-%dT%H:%M:%fZ',
  CAST(event_time_raw AS REAL) / 1000.0,
  'unixepoch'
)
WHERE event_time_utc IS NULL
  AND section_key IN ('posts', 'comments', 'likes_and_reactions')
  AND length(event_time_raw) = 13
  AND event_time_raw NOT GLOB '*[^0-9]*'
  AND CAST(event_time_raw AS INTEGER) BETWEEN 946684800000 AND 4102444800000;
