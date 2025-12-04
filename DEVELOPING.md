# Developing

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
npm install
```

Set your API key (add to your shell profile for persistence):
```bash
export ZIPF_API_KEY=your-api-key-here
```

## Build

```bash
npm run build
```

This compiles TypeScript to JavaScript in `build/`.

## Linting & Formatting

```bash
# Check for issues
npm run lint

# Auto-format code
npm run format

# Lint + format in one command
npm run check
```

## Testing

### With MCP Inspector (recommended for development)

The MCP Inspector provides an interactive UI to test your tools:

```bash
ZIPF_API_KEY=your-key npx @modelcontextprotocol/inspector node build/index.js
```

This opens a browser UI where you can:
- See registered tools
- Call tools with test inputs
- View responses

### With Claude Code

1. Add to your project's `.mcp.json`:
```json
{
  "mcpServers": {
    "zipfai": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"],
      "env": {
        "ZIPF_API_KEY": "${ZIPF_API_KEY}"
      }
    }
  }
}
```

2. Restart Claude Code to pick up the new server.

## Project Structure

```
src/
  index.ts    # Main server entry point
build/        # Compiled JavaScript (git-ignored)
```

## Common Issues

**"ZIPF_API_KEY is undefined"**
- Make sure the env var is exported in your shell
- For MCP Inspector, pass it inline: `ZIPF_API_KEY=xxx npx ...`

**TypeScript errors after changing code**
- Run `npm run build` to recompile
- Check errors with `npx tsc --noEmit`
