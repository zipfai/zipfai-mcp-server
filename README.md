# ZipfAI MCP Server

Web search powered by [ZipfAI](https://zipf.ai) for Claude Code. Provides fast web searches and AI-enhanced deep searches with summaries.

## Installation

### Local Install
```bash
npm install
npm run build
npx zipfai-mcp-server install --api-key=<>
# npx zipfai-mcp-server uninstall to uninstall
```

### NPM Install
TODO: we have to deploy this

## Available Tools

### zipfai_quick_search
Fast, lightweight web search (1 credit). Returns URLs with titles and snippets.

```
Best for: Quick lookups, documentation, finding specific pages
```

### zipfai_search
Full-featured search with AI enhancements (1-2 credits).

```
Features:
- interpret_query: AI rewrites query for better results
- rerank_results: Semantic reranking for relevance
- generate_summary: AI summary of results (FREE)
- generate_suggestions: Follow-up query suggestions
```

## Examples

**Quick search:**
```
Search for React hooks documentation
```

**Deep search with summary:**
```
Research the latest developments in AI agents and summarize what you find
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test with MCP Inspector
ZIPF_API_KEY=your_key npx @modelcontextprotocol/inspector node build/index.js

# Lint & format
npm run check
```

## Hosting (Future)

Currently this server uses stdio transport (runs locally as a subprocess). To host remotely:

- Use `SSEServerTransport` from `@modelcontextprotocol/sdk/server/sse.js`
- Add HTTP server (express or similar)
- Handle auth via headers instead of env vars
- Update `.mcp.json` to use `url` instead of `command`

```typescript
// Example remote setup
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";

const app = express();
app.get("/sse", (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  server.connect(transport);
});
app.post("/messages", (req, res) => transport.handlePostMessage(req, res));
```

## License

MIT
