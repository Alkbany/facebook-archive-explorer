CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_display_name ON accounts(display_name COLLATE NOCASE);
