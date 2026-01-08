# ZipfAI MCP Server

Web data infrastructure powered by [ZipfAI](https://zipf.ai) for Claude Code. Provides web search, crawling, question answering, and multi-step research workflows.

## Installation

### Local Install
```bash
npm install
npm run build
npx zipfai-mcp-server install --api-key=<your-key>
# npx zipfai-mcp-server uninstall to uninstall
```

### NPM Install
```bash
npx zipfai-mcp-server install --api-key=<your-key>
```

## Available Tools

### Status

#### zipfai_status
Check API status and credit balance (FREE).
- Verify connection and authentication
- View remaining credits

### Search Tools

#### zipfai_search
Full-featured search with AI enhancements (1-2 credits).
- `interpret_query`: AI rewrites query for better results
- `rerank_results`: Semantic reranking for relevance
- `generate_summary`: AI summary of results (FREE)
- `generate_suggestions`: Follow-up query suggestions
- `query_decomposition`: Break into sub-queries for comprehensive research
- `source_type`: Target academic, commercial, news, community sources
- `date_range`: Filter by recency (day, week, month, year, any)
- `timeout_ms`: Custom timeout for long operations (5000-300000ms)

### Question Answering

#### zipfai_ask
Direct answers to questions with source citations (2-5 credits).
- `quick`: Fast basic answer (2 credits)
- `standard`: Balanced depth (3 credits)
- `deep`: Thorough multi-source research (5+ credits)

### Web Crawling

#### zipfai_crawl
Crawl web pages and extract content (1-2 credits/page).
- Full page content as markdown
- Custom extraction schemas for structured data
- Document classification
- Link following (internal, external, both)

#### zipfai_suggest_schema
AI-suggested extraction schema for a URL (2 credits).
- Detects page type (e-commerce, blog, etc.)
- Suggests extraction fields with confidence scores

### Research

#### zipfai_research
One-call search + auto-crawl combo (variable credits).
- Searches your query
- Crawls top N results
- Synthesizes an answer

### Sessions (Multi-Step Research)

Sessions provide URL deduplication, context accumulation, and unified credit tracking.

#### zipfai_create_session
Create a research session (FREE).

#### zipfai_session_search
Search within a session with auto-deduplication (1-2 credits).

#### zipfai_session_crawl
Crawl within a session, skipping seen URLs (1-2 credits/page).

#### zipfai_session_timeline
Get session operation history (FREE).

#### zipfai_complete_session
Mark session as completed (FREE).

## Examples

**Quick search:**
```
Search for React hooks documentation
```

**Deep search with decomposition:**
```
Research AI safety comprehensively - use query decomposition to cover different aspects
```

**Question answering:**
```
Ask: Who is the CEO of NVIDIA and what is their background?
```

**Crawl with extraction:**
```
Crawl https://example.com/products and extract product names and prices
```

**Session-based research:**
```
1. Create a session for "AI Infrastructure Research"
2. Search for "top AI infrastructure startups"
3. Search for "GPU cloud providers comparison"
4. Crawl the top results
5. Get session timeline to review
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

## API Documentation

Full API documentation at [www.zipf.ai/docs](https://www.zipf.ai/docs) or see `docs/API.md` in the main weaver repo.

## License

MIT
