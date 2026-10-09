# Neon seed transaction fix

The old `Store.save()` ran a full snapshot as sequential per-row upserts inside an interactive transaction with a 30,000 ms timeout. Seeding writes the hospital, floors, 37 nodes, departments, rooms and edges before reaching 37 QR checkpoints, followed by users, profiles, journeys, stages, tickets and clinic statuses. Network round trips to Neon can exhaust the shared transaction budget before the QR upsert. P2028 at that line is consistent with an expired/lost transaction; that line is not evidence of invalid QR data. No Neon server trace or credentials were available here to confirm the precise remote elapsed time or exclude a separate network disconnect.

## Changes

- `server/store.ts`: `save({seed:true})` selects an initial-seed path, prepares data before opening the transaction, and uses 120,000 ms execution timeout plus 15,000 ms acquisition wait. Ordinary application saves retain their upsert logic, 30,000 ms timeout and 2,000 ms acquisition wait. Explicit timeout values are checked before starting a transaction; invalid/nonpositive/over-600,000 ms values fail safely.
- `server/seed-store.ts`: one hospital create plus twelve `createMany` operations, ordered by foreign-key dependencies. It inserts all 37 checkpoints in a single batch. There are no per-record database reads/upserts, no `skipDuplicates`, no deletes and no separate commits for partial batches. A PostgreSQL transaction-scoped advisory lock serializes seed attempts; staff/hospital checks inside the locked transaction refuse existing data. Unexpected conflicts/errors roll back all seed inserts. Notifications/history are not silently overwritten or imported by this initial-only path.
- `prisma/seed.ts`: invokes the bulk path; bcrypt hashing and fixture preparation remain outside the transaction. It always disconnects in `finally`, including errors/refusals. Error output contains a validated Prisma error code or a known safe refusal message, rather than raw Prisma arguments, connection URLs or credential-bearing stacks. Failure exits with status 1.
- `tests/seed.test.ts`: verifies bulk operation order/options, complete checkpoint metadata, transactional failure/retry, refusal to overwrite existing staff/hospital data, invalid timeout rejection, and the real seed CLI against isolated file-demo data. Mocked PostgreSQL transaction tests do not claim live Neon validation.

The schema, both migrations, normal application features and private environment files are unchanged.

## Run on your Neon database

Keep your existing private Neon `DATABASE_URL` and `DEMO_PASSWORD` in your local `.env`, with `STORAGE_MODE=postgres`. After replacing the updated source files, run:

```sh
npm run db:seed
```

Both migrations are already deployed; do not reset/drop the database or redeploy altered migrations. No new dependency or migration is required. If network latency remains unusually high, optional local settings are:

```dotenv
SEED_TRANSACTION_TIMEOUT_MS=180000
SEED_TRANSACTION_MAX_WAIT_MS=20000
```

These are milliseconds; they do not replace Neon connection settings or fix unavailable/authentication-failed database connections. Leave them unset to use the 120-second/15-second defaults. A successful command prints the existing completion message without the password. P2028 or another failed transaction can be retried by running the same command. Random fixture IDs cannot leave duplicate rows after a rolled-back attempt because all tables commit together. If a connection fails around commit and its outcome is uncertain, retry refuses an already populated database, protecting committed data. A completed seed is intentionally not rerun over existing data.

If the command refuses existing hospital/staff records, preserve them and inspect the existing data; this repair does not reset or overwrite an initialized database. Do not run two different initialization scripts against the same database. The advisory lock coordinates this seed command's simultaneous invocations.

## Verification scope

TypeScript, automated tests and production build are run locally. Available private environment files point to a local PostgreSQL configuration, not Neon, so no remote Neon seed was executed and no credentials were requested or printed. Retry and batching tests cover the application logic; a successful `npm run db:seed` on your configured Neon endpoint is the final integration confirmation.

Prisma v6 distinguishes acquisition `maxWait` from transaction execution `timeout` and notes that `Promise.all` does not parallelize queries on a transaction's single connection. The repair uses bulk writes instead. [Prisma v6 transaction documentation](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).
