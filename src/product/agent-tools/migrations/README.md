# Agent-tools schema migrations

Apply `../schema.sql` for greenfield installs.

For existing databases, re-apply `schema.sql` (it uses `IF NOT EXISTS`) or run numbered files in order:

1. `001_baseline.sql` — identical to the current baseline table
2. Future changes land as `002_*.sql`, `003_*.sql`, …

Track applied versions in ops notes until a formal migrator ships.
