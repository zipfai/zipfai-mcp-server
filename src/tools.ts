import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, quickSearch, searchWithPolling } from "./api.js";

// Helper to format errors for MCP response
function formatError(error: unknown): {
	content: { type: "text"; text: string }[];
	isError: true;
} {
	let message = "Search failed";

	if (error instanceof ApiError) {
		message = error.message;
		if (error.statusCode === 401 || error.statusCode === 403) {
			message = `Authentication failed: ${error.message}. Check your ZIPF_API_KEY.`;
		} else if (error.statusCode === 429) {
			message = `Rate limited: ${error.message}. Please wait before retrying.`;
		} else if (error.statusCode && error.statusCode >= 500) {
			message = `Server error: ${error.message}. Please try again later.`;
		}
	} else if (error instanceof Error) {
		message = error.message;
		// Check for common network errors
		if (error.message.includes("fetch")) {
			message = `Network error: Unable to reach ZipfAI API. Check your internet connection.`;
		}
	}

	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		isError: true,
	};
}

export function registerTools(server: McpServer): void {
	// =========================================================================
	// Quick Search - Fast, lightweight search (1 credit)
	// =========================================================================
	server.registerTool(
		"zipfai_quick_search",
		{
			description:
				"Fast web search using ZipfAI (1 credit). Returns URLs with titles and snippets. Use for simple lookups where you just need links. For deeper analysis with AI summaries or better ranking, use zipfai_search instead.",
			inputSchema: {
				query: z
					.string()
					.describe(
						"Search query - be specific for better results (max 1000 chars)",
					),
				max_results: z
					.number()
					.optional()
					.describe("Number of results, 1-20 (default: 10)"),
				include_domains: z
					.array(z.string())
					.optional()
					.describe(
						"Only include results from these domains, e.g. ['github.com']",
					),
				exclude_domains: z
					.array(z.string())
					.optional()
					.describe("Exclude results from these domains"),
			},
		},
		async ({ query, max_results, include_domains, exclude_domains }) => {
			try {
				const results = await quickSearch({
					query,
					max_results: max_results ?? 10,
					include_domains: include_domains ?? [],
					exclude_domains: exclude_domains ?? [],
				});

				return {
					content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Full Search - AI-enhanced search with all features (1-2 credits)
	// =========================================================================
	server.registerTool(
		"zipfai_search",
		{
			description:
				"Full-featured web search with AI enhancements (1-2 credits). Use when you need: query rewriting for better results, semantic reranking, AI-generated summaries, or follow-up suggestions. Automatically waits for async results (summaries, metadata) before returning.",
			inputSchema: {
				query: z
					.string()
					.describe(
						"Search query - be specific for better results (max 1000 chars)",
					),
				max_results: z
					.number()
					.optional()
					.describe("Number of results, 1-20 (default: 10)"),
				include_domains: z
					.array(z.string())
					.optional()
					.describe("Only include results from these domains"),
				exclude_domains: z
					.array(z.string())
					.optional()
					.describe("Exclude results from these domains"),
				interpret_query: z
					.boolean()
					.optional()
					.describe(
						"Enable AI query rewriting for better results (+1 credit, adds ~3-4s)",
					),
				rerank_results: z
					.boolean()
					.optional()
					.describe(
						"Enable semantic reranking to improve result relevance (+1 credit)",
					),
				generate_summary: z
					.boolean()
					.optional()
					.describe(
						"Generate AI summary of results (FREE, waits for completion)",
					),
				generate_suggestions: z
					.boolean()
					.optional()
					.describe(
						"Generate 'People Also Ask' style follow-up queries (+1 credit)",
					),
				num_suggestions: z
					.number()
					.optional()
					.describe(
						"Number of follow-up suggestions to generate, 1-10 (default: 5)",
					),
				extract_metadata: z
					.boolean()
					.optional()
					.describe(
						"Extract structured metadata from results (FREE, waits for completion)",
					),
			},
		},
		async ({
			query,
			max_results,
			include_domains,
			exclude_domains,
			interpret_query,
			rerank_results,
			generate_summary,
			generate_suggestions,
			num_suggestions,
			extract_metadata,
		}) => {
			try {
				const results = await searchWithPolling({
					query,
					max_results: max_results ?? 10,
					include_domains: include_domains ?? undefined,
					exclude_domains: exclude_domains ?? undefined,
					interpret_query: interpret_query ?? false,
					extract_metadata: extract_metadata ?? false,
					rerank_results: rerank_results ?? false,
					generate_summary: generate_summary ?? false,
					generate_suggestions: generate_suggestions ?? false,
					num_suggestions: num_suggestions ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);
}
