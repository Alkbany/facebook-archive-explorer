import initialSchema from './001_initial_schema.sql?raw';
import accountNames from './002_account_names.sql?raw';
import verifiedEventTimes from './003_backfill_verified_event_times.sql?raw';
import fallbackParserKeys from './004_backfill_fallback_parser_keys.sql?raw';
import mediaMetadataScanState from './005_media_metadata_scan_state.sql?raw';
import searchPreferences from './006_search_preferences.sql?raw';
import semanticSearch from './007_semantic_search.sql?raw';
import aiAssistant from './008_ai_assistant.sql?raw';
import type { SqlMigration } from '../connection';

export const DATABASE_MIGRATIONS: readonly SqlMigration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: initialSchema
  },
  {
    version: 2,
    name: 'unique_account_display_names',
    sql: accountNames
  },
  {
    version: 3,
    name: 'backfill_verified_event_times',
    sql: verifiedEventTimes
  },
  {
    version: 4,
    name: 'backfill_fallback_parser_keys',
    sql: fallbackParserKeys
  },
  {
    version: 5,
    name: 'media_metadata_scan_state',
    sql: mediaMetadataScanState
  },
  {
    version: 6,
    name: 'search_preferences',
    sql: searchPreferences
  },
  {
    version: 7,
    name: 'semantic_search',
    sql: semanticSearch
  },
  {
    version: 8,
    name: 'ai_assistant',
    sql: aiAssistant
  }
];
