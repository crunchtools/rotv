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
