# BitBonsai Subagents

This directory contains specialized Claude Code subagents for the BitBonsai project.

## Available Subagents

### 🚀 fullstack-feature.md
**Purpose**: Implement complete features across backend (NestJS) and frontend (Angular)

**Use for**:
- New feature development spanning API and UI
- Ensuring API contracts match frontend models
- Domain-scoped architecture implementation
- Full-stack feature delivery

**Example**:
```bash
/task Use the fullstack-feature agent to implement job scheduling with backend API and frontend UI
```

### 👀 pr-reviewer.md
**Purpose**: Comprehensive code review for guideline compliance, quality, and security

**Use for**:
- Pull request reviews before merging
- Guideline compliance verification
- Security vulnerability detection
- Architecture pattern checking

**Example**:
```bash
/task Use the pr-reviewer agent to review PR #42 for guideline compliance and security
```

### 🧪 test-engineer.md
**Purpose**: Write comprehensive tests across all testing layers

**Use for**:
- Adding unit tests for new features
- Writing integration tests for services
- Creating E2E tests for workflows
- Improving test coverage

**Example**:
```bash
/task Use the test-engineer agent to write unit, integration, and E2E tests for NodesService
```

### 🐛 debugger.md
**Purpose**: Systematically diagnose bugs and implement verified fixes

**Use for**:
- Debugging specific errors or bugs
- Root cause analysis
- Implementing fixes with regression tests
- Investigating unexpected behavior

**Example**:
```bash
/task Use the debugger agent to fix the 500 error occurring during node registration
```

## Quick Reference

| Task Type | Subagent | Command Example |
|-----------|----------|-----------------|
| New Feature | fullstack-feature | `/task Use the fullstack-feature agent to add...` |
| Code Review | pr-reviewer | `/task Use the pr-reviewer agent to review...` |
| Write Tests | test-engineer | `/task Use the test-engineer agent to test...` |
| Fix Bugs | debugger | `/task Use the debugger agent to fix...` |

## How Subagents Work

1. **Separate Context**: Each subagent has its own context window
2. **Specialized Instructions**: Tailored system prompts for specific tasks
3. **Tool Access**: Same tools as main agent (Read, Write, Edit, Bash, etc.)
4. **Guideline Adherence**: All subagents follow BitBonsai coding guidelines

## Usage Patterns

### Automatic Invocation

Claude Code can automatically delegate to the appropriate subagent:

```
"Review this PR" → Uses pr-reviewer automatically
"Add tests for X" → Uses test-engineer automatically
"Fix bug Y" → Uses debugger automatically
```

### Explicit Invocation

Use `/task` command to explicitly specify a subagent:

```bash
/task Use the <agent-name> agent to <task-description>
```

## Development Workflow

**Typical Feature Development:**
```bash
# 1. Implement feature
/task Use the fullstack-feature agent to implement job filtering

# 2. Add tests
/task Use the test-engineer agent to add comprehensive tests

# 3. Review
/task Use the pr-reviewer agent to review the implementation

# 4. Debug if needed
/task Use the debugger agent to fix any issues found
```

## Customization

You can edit subagent configurations by modifying the `.md` files in this directory:
- Add project-specific instructions
- Adjust workflows
- Add domain knowledge
- Customize tool restrictions

All subagent configs are version-controlled with your repo.

## Guidelines

All subagents follow the coding guidelines in `~/git/code-conventions/`:
- `angular-guidelines.md` - Frontend standards
- `nestjs-guidelines.md` - Backend standards
- `api-design-guidelines.md` - API design patterns
- `testing-guidelines.md` - Testing strategies
- `git-conventions.md` - Commit message format
- `subagent-guidelines.md` - Detailed subagent usage guide

## Learn More

For detailed subagent documentation, see:
- **Complete Guide**: `~/git/code-conventions/subagent-guidelines.md`
- **Claude Code Docs**: https://docs.claude.com/en/docs/claude-code/subagents

## Notes

- Subagents work best when given specific, detailed task descriptions
- Let subagents complete their full workflow (don't interrupt midway)
- Review subagent output and run tests/build after changes
- Commit changes with proper commit messages after verification
