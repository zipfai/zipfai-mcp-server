# CLAUDE.md - ZipfAI MCP Server

This is an MCP (Model Context Protocol) server that provides ZipfAI web search capabilities to Claude Code.

## Development

```bash
npm run build          # Compile TypeScript
npm run build_clean    # Clean rebuild
npm run lint           # Check code with Biome
npm run format         # Format code with Biome
npm run check          # Lint + format in one command
```

## Version Control with Graphite

This project uses [Graphite](https://graphite.dev) for stacked PRs and streamlined code review workflows. See the [Command Reference](https://graphite.com/docs/command-reference) for full documentation.

### Core Commands
```bash
# Create a new branch with explicit name (recommended)
gt create <branch-name> -m "feat: add new feature"

# Modify the current commit (amend with staged changes)
gt modify

# Submit PRs for the entire stack (including descendants)
gt ss -v                 # Alias for: gt submit --stack (-v opens in browser)

# Submit only current branch and ancestors (not descendants)
gt submit -v

# Sync all branches with remote, rebase, and clean up merged PRs
gt sync

# View your current stack
gt log                   # Full view
gt ls                    # Short view (alias: gt log short)
```

### Stack Navigation
```bash
gt up                    # Move to child branch
gt down                  # Move to parent branch
gt top                   # Jump to top of stack
gt bottom                # Jump to trunk (main)
```

### Stacked PR Workflow
1. **Start a new feature**: `gt create feature/my-feature -m "feat: base implementation"`
2. **Add incremental changes**: Make changes, then `gt create feature/my-feature-tests -m "feat: add tests"` for each logical chunk
3. **Submit for review**: `gt ss -v` pushes all branches and creates/updates PRs
4. **After review feedback**: Make changes, `gt modify`, then `gt ss -v` to update
5. **Sync with main**: `gt sync` to rebase your stack on latest main

### Best Practices
- Keep each stacked PR focused on a single logical change
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Run `gt sync` regularly to stay up-to-date with main
- Use `gt log` to visualize your stack before submitting
- Use `gt ss` (not `gt submit`) to ensure the full stack is submitted
- **Always provide explicit branch names** to keep them short and readable

### PR Descriptions
Include the PR description in the commit body using a second `-m` flag with a leading blank line. Graphite uses commit messages as PR bodies:

```bash
gt create docs-my-feature -m "feat: add new feature" -m "
## Summary
Brief description of the change.

## Changes
- First change
- Second change

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [x] Documentation update
- [ ] Refactoring

## Testing
- [ ] Tests added/updated
- [x] All tests pass
- [ ] Manual testing performed

## Checklist
- [x] Code follows project style guidelines
- [x] Self-review completed"
```

**Important**: The second `-m` flag value must start with a newline to properly separate the PR title from the body.

Fill in the template sections:
- **Summary**: 1-3 sentences describing the change
- **Changes**: Bullet points of key modifications
- **Type of Change**: Check the appropriate box(es)
- **Testing**: Check completed testing items
- **Checklist**: Check completed items
