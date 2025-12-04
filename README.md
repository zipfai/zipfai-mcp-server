# ZipfAI MCP Server

Web search powered by [ZipfAI](https://zipf.ai) for Claude Code. Provides fast web searches and AI-enhanced deep searches with summaries.

## Installation

### Local Install
```bash
npm install
npm run build
node build/cli.js install --api-key=<>
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

## License

MIT
