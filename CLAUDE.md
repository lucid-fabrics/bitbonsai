# CLAUDE.md - AI Development Guidelines

## Code Conventions Reference

This repository follows standardized code conventions defined in:
**`~/.openclaw/workspace/code-conventions.md`**

All AI assistants and developers should reference that file for:

- Branch naming conventions
- Commit message formats (Conventional Commits)
- PR templates and requirements
- Code quality standards
- CI/CD expectations

## Repository-Specific Guidelines

### Documentation Standards

This is a documentation repository using Mintlify. Key points:

1. **Markdown Files**: All docs are in `.mdx` format
2. **Navigation**: Defined in `docs-mintlify/mint.json`
3. **Images**: Store in `screenshots/` or `assets/` directories
4. **Links**: Use relative paths where possible

### Workflow

1. **Never commit directly to `main`**
2. **Use conventional commits**:
   - `docs: add deployment guide`
   - `fix: correct typo in quickstart`
   - `feat: add advanced configuration section`
3. **Create issues before starting work**
4. **Open PRs for all changes**
5. **Wait for status checks before merging**

### Branch Naming

Follow the pattern from code-conventions.md:

- `docs/topic-name` - Documentation updates
- `fix/issue-description` - Bug fixes
- `feat/feature-name` - New features

### Pre-commit Checks

- Markdown linting (via markdownlint)
- Prettier formatting
- No commits to main branch

### Commit Message Format

```text
type(scope): subject

body (optional)

footer (optional)
```

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:

- `docs: update installation instructions`
- `fix: correct broken link in FAQ`
- `docs(quickstart): add Docker Compose example`

## Tools

- **ESLint**: For markdown linting
- **Prettier**: For code formatting
- **Husky**: Git hooks enforcement
- **lint-staged**: Pre-commit file checking
- **commitlint**: Conventional commit validation

## Getting Started

```bash
# Install dependencies
npm install

# The pre-commit hook will automatically:
# 1. Block commits to main
# 2. Run lint-staged (prettier + markdownlint)
# 3. Validate commit messages

# To bypass hooks (emergency only):
git commit --no-verify
```

## Questions?

Check `~/.openclaw/workspace/code-conventions.md` or ask the team.
