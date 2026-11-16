# Contributing to Roots of The Valley

Thank you for your interest in contributing to Roots of The Valley!

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Set up the development environment:
   ```bash
   ./run.sh build
   ./run.sh start
   ```

## Development Workflow

1. Create a feature branch from `master`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and test locally:
   ```bash
   ./run.sh reload-app  # Hot reload for quick iteration
   ./run.sh test        # Run all tests
   ```

3. Ensure the container builds:
   ```bash
   ./run.sh build
   ```

4. Commit your changes with a descriptive message

5. Push and create a pull request

## Branch Naming

| Prefix | Use Case |
|--------|----------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation |
| `refactor/` | Code refactoring |
| `test/` | Test additions |

## Pull Request Requirements

Before submitting a PR:

- [ ] All tests pass (`./run.sh test`)
- [ ] Container builds successfully (`./run.sh build`)
- [ ] Manual testing completed in browser
- [ ] Code follows existing patterns
- [ ] Documentation updated if needed

## Database migrations

A failed deploy is rolled back by putting the previous image back. The database
stays as the new release left it, and `rotv-init` runs every migration on every
boot. So the previous release must still work on the schema a migration
produces: expand now, contract in a later release
([parallel change](https://martinfowler.com/bliki/ParallelChange.html)).

A migration must not, on anything the previous release still reads or writes:

- drop a table, view, materialized view, schema, column, function, type,
  sequence or trigger;
- drop an index or a constraint, unless the same file creates it again under
  the same name, as the same kind of object, on the same table, and at least
  as unique (a unique index comes back unique). CI checks the name, kind,
  table and uniqueness; whether a re-added `CHECK` is really wider is the
  reviewer's job to confirm, not CI's. CI learns what a dropped name was from
  earlier migrations, or Postgres's default suffixes (`_pkey`, `_key`,
  `_fkey`, `_check`, `_excl`, `_idx`); a name it cannot place is never a
  replacement;
- rename a table, view, column, index, function, sequence, type or enum value;
- change a column's type, or tighten it with `SET NOT NULL`;
- add a `NOT NULL` column without a `DEFAULT` (the old code's `INSERT`s omit
  it; `DEFAULT NULL` is no default);
- drop a column's `DEFAULT`, make it `GENERATED ALWAYS`, or `DROP DOMAIN` /
  `DROP EXTENSION` with `CASCADE`;
- add a `UNIQUE`, `CHECK`, `FOREIGN KEY`, `PRIMARY KEY` or `EXCLUDE`
  constraint, or a unique index (`CREATE UNIQUE INDEX`): the old code may
  write rows that violate it. Exempt are a replacement as above, and a unique
  index on a table the same file creates.

To remove or rename something, ship the new shape and the code that uses it in
one release, and the removal in a later one, once the release before it no
longer touches the old shape. Mark that later statement with the reason it is
now safe, on the line above it:

```sql
-- contract: v1.71.0 stopped reading pois.legacy_flag
ALTER TABLE pois DROP COLUMN IF EXISTS legacy_flag;
```

The `Migration compatibility` CI job enforces this with
`scripts/check-migrations.mjs`, over every migration numbered above 112 and any
existing migration a PR edits. An edit to a migration numbered 112 or below is
judged only on the statements it touches, plus any drop whose re-create it
touches: deleting or weakening the re-create brings the drop back into scope.

A marker opts out exactly one statement: the next one, or the one it sits
inside. A marker after a statement's semicolon on the same line belongs to that
statement, not the next. Inside a `DO` block or function body every statement
counts on its own, so each contract statement there needs its own marker.

The checker reads the SQL as written, so do not build DDL at run time
(`EXECUTE` of a concatenated or `format()`ed string): it cannot be judged.

`CREATE OR REPLACE VIEW` that only appends new columns at the end of the select
list is compatible. Postgres refuses any other column change in place, and
dropping the view breaks the previous release, so a view whose existing columns
change gets a new view name instead.

After a rollback, the old image runs its own `/app/migrations` on the newer
schema at boot (`rotv-init.sh` runs them with no `ON_ERROR_STOP` and only logs
failures). An old `DROP ... IF EXISTS` then runs again, and deletes anything a
later release added back under that name. Keep every migration idempotent and
non-destructive on re-run.

## Code Style

- Follow existing code patterns in the repository
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small

## Reporting Issues

When reporting issues, please include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser/environment details
- Screenshots if applicable

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions?

Open an issue for questions or discussions about the project.
