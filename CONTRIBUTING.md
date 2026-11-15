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

- drop a table, view, materialized view, schema or column;
- rename a table, view or column;
- change a column's type, or tighten it with `SET NOT NULL`;
- add a `NOT NULL` column without a `DEFAULT` (the old code's `INSERT`s omit it).

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
existing migration a PR edits. The marker opts out one statement, not the file.
A view whose columns change is replaced with a new view name, not dropped and
recreated in place.

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
