import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { quickSearch, searchWithPolling } from "./api.js";

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
			const results = await quickSearch({
				query,
				max_results: max_results ?? 10,
				include_domains: include_domains ?? [],
				exclude_domains: exclude_domains ?? [],
			});

			if (!results) {
				return {
					content: [{ type: "text", text: "Error: Search failed" }],
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
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
		}) => {
			const results = await searchWithPolling({
				query,
				max_results: max_results ?? 10,
				include_domains: include_domains ?? undefined,
				exclude_domains: exclude_domains ?? undefined,
				interpret_query: interpret_query ?? false,
				rerank_results: rerank_results ?? false,
				generate_summary: generate_summary ?? false,
				generate_suggestions: generate_suggestions ?? false,
				num_suggestions: num_suggestions ?? undefined,
			});

			if (!results) {
				return {
					content: [{ type: "text", text: "Error: Search failed" }],
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
		},
	);
}
