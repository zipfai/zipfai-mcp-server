import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	ApiError,
	ask,
	completeSession,
	crawlWithPolling,
	createSession,
	createWorkflow,
	deleteWorkflow,
	executeWorkflow,
	getSessionTimeline,
	getStatus,
	getWorkflowDetails,
	getWorkflowDiff,
	getWorkflowTimeline,
	getWorkflowUpdatesDigest,
	listWorkflows,
	planWorkflow,
	research,
	searchWithPolling,
	sessionCrawl,
	sessionSearch,
	suggestSchema,
	updateWorkflow,
} from "./api.js";

// Helper to format errors for MCP response
function formatError(error: unknown): {
	content: { type: "text"; text: string }[];
	isError: true;
} {
	let message = "Operation failed";

	if (error instanceof ApiError) {
		message = error.message;
		if (error.statusCode === 401 || error.statusCode === 403) {
			message = `Authentication failed: ${error.message}. Check your ZIPF_API_KEY.`;
		} else if (error.statusCode === 429) {
			message = `Rate limited: ${error.message}. Please wait before retrying.`;
		} else if (error.statusCode === 402) {
			message = `Insufficient credits: ${error.message}. Add credits at zipf.ai/dashboard.`;
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
	// Status - Health check and account info (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_status",
		{
			description:
				"Check ZipfAI API health and get account status (FREE). Returns API status, credit balance, rate limits, and available endpoints. Use this to verify your API key works and check your remaining credits before starting operations.",
			inputSchema: {},
		},
		async () => {
			try {
				const status = await getStatus();

				// Format a clean summary for the LLM
				const summary = {
					healthy: status.api.status === "active",
					api_version: status.api.version,
					credits_balance: status.user.credits_balance,
					rate_limits: {
						per_hour: status.rate_limits.default_per_hour,
						per_day: status.rate_limits.default_per_day,
					},
					available_endpoints: Object.keys(status.endpoints),
					credit_costs: status.credit_costs,
				};

				return {
					content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
				};
			} catch (error) {
				// For status check, provide more detailed error info
				if (error instanceof ApiError) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										healthy: false,
										error: error.message,
										status_code: error.statusCode,
										suggestion:
											error.statusCode === 401
												? "Check your ZIPF_API_KEY environment variable"
												: "The ZipfAI API may be experiencing issues",
									},
									null,
									2,
								),
							},
						],
						isError: true,
					};
				}
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Search - AI-enhanced search with all features (1-2 credits)
	// =========================================================================
	server.registerTool(
		"zipfai_search",
		{
			description:
				"Full-featured web search with AI enhancements (1-2 credits). Use when you need: query rewriting for better results, semantic reranking, AI-generated summaries, follow-up suggestions, or comprehensive research via query decomposition. Automatically waits for async results before returning.",
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
				// Query decomposition
				query_decomposition: z
					.boolean()
					.optional()
					.describe(
						"Enable comprehensive research via query decomposition - breaks query into sub-queries for thorough coverage (1 + N credits)",
					),
				max_sub_queries: z
					.number()
					.optional()
					.describe(
						"Number of sub-queries for decomposition, 1-20 (default: 5)",
					),
				source_type: z
					.enum(["academic", "commercial", "news", "community", "mixed"])
					.optional()
					.describe(
						"Target source type for decomposition: academic, commercial, news, community, or mixed",
					),
				freshness: z
					.enum(["day", "week", "month", "year"])
					.optional()
					.describe(
						"Filter results by recency: day (last 24h), week, month, or year. Omit for any time.",
					),
			},
		},
		async ({
			query,
			max_results,
			interpret_query,
			rerank_results,
			generate_summary,
			generate_suggestions,
			num_suggestions,
			extract_metadata,
			query_decomposition,
			max_sub_queries,
			source_type,
			freshness,
		}) => {
			try {
				const results = await searchWithPolling({
					query,
					max_results: max_results ?? 10,
					interpret_query: interpret_query ?? false,
					extract_metadata: extract_metadata ?? false,
					rerank_results: rerank_results ?? false,
					generate_summary: generate_summary ?? false,
					generate_suggestions: generate_suggestions ?? false,
					num_suggestions: num_suggestions ?? undefined,
					query_decomposition: query_decomposition ?? false,
					max_sub_queries: max_sub_queries ?? undefined,
					source_type: source_type ?? undefined,
					freshness: freshness ?? undefined,
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
	// Ask - Direct question answering (2-5 credits)
	// =========================================================================
	server.registerTool(
		"zipfai_ask",
		{
			description:
				"Get direct answers to questions with source citations (2-5 credits based on depth). Returns synthesized answers, not just URLs. Best for factual questions where you need a direct answer. Depth: quick (2 credits, fast), standard (3 credits, balanced), deep (5+ credits, thorough research).",
			inputSchema: {
				question: z
					.string()
					.describe("The question to answer - be specific and clear"),
				depth: z
					.enum(["quick", "standard", "deep"])
					.optional()
					.describe(
						"Research depth: quick (2 credits), standard (3 credits), deep (5+ credits). Default: standard",
					),
				max_sources: z
					.number()
					.optional()
					.describe("Maximum sources to cite, 1-20 (default: 10)"),
				// Additional parameters
				include_follow_ups: z
					.boolean()
					.optional()
					.describe("Include suggested follow-up questions (default: true)"),
				response_style: z
					.enum(["concise", "detailed"])
					.optional()
					.describe("Answer length: concise (1-3 sentences) or detailed (full paragraph). Default: concise"),
				session_id: z
					.string()
					.optional()
					.describe("Link to a session for contextual rewrites. Enables follow-up questions that reference previous context."),
				skip_rerank: z
					.boolean()
					.optional()
					.describe("Skip result reranking (default: true - search engines rank well for factual QA)"),
				enable_query_rewrite: z
					.boolean()
					.optional()
					.describe("Enable LLM-based query rewriting for better search results (default: false)"),
				enable_decomposition: z
					.boolean()
					.optional()
					.describe("Enable query decomposition for comprehensive search (default: false)"),
				max_sub_queries: z
					.number()
					.optional()
					.describe("Max sub-queries when decomposition is enabled, 1-5 (default: 3)"),
			},
		},
		async ({
			question,
			depth,
			max_sources,
			include_follow_ups,
			response_style,
			session_id,
			skip_rerank,
			enable_query_rewrite,
			enable_decomposition,
			max_sub_queries,
		}) => {
			try {
				const result = await ask({
					question,
					depth: depth ?? "standard",
					max_sources: max_sources ?? 10,
					include_follow_ups: include_follow_ups ?? undefined,
					response_style: response_style ?? undefined,
					session_id: session_id ?? undefined,
					skip_rerank: skip_rerank ?? undefined,
					enable_query_rewrite: enable_query_rewrite ?? undefined,
					enable_decomposition: enable_decomposition ?? undefined,
					max_sub_queries: max_sub_queries ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Crawl - Web crawling with extraction (1-2 credits/page)
	// =========================================================================
	server.registerTool(
		"zipfai_crawl",
		{
			description:
				"Crawl web pages and extract content (1-2 credits/page). Use for deep content extraction, structured data extraction with custom schemas, or following links. Returns full page content as markdown. Uses sync mode - waits for completion.",
			inputSchema: {
				urls: z.array(z.string()).describe("URLs to crawl (1-100 seed URLs)"),
				max_pages: z
					.number()
					.optional()
					.describe("Maximum pages to crawl, 1-1000 (default: 10)"),
				extraction_schema: z
					.record(z.string())
					.optional()
					.describe(
						'Custom fields to extract, e.g. {"title": "Extract the article title", "author": "Extract author name"}. Triggers advanced pricing (+1 credit/page).',
					),
				classify_documents: z
					.boolean()
					.optional()
					.describe(
						"Enable AI document classification (default: true, triggers advanced pricing)",
					),
				generate_summary: z
					.boolean()
					.optional()
					.describe("Generate AI summary of crawled content (FREE)"),
				expansion: z
					.enum(["internal", "external", "both", "none"])
					.optional()
					.describe(
						"Link following: internal (same domain), external (other domains), both, or none",
					),
				// Additional parameters
				follow_links: z
					.boolean()
					.optional()
					.describe("Enable link extraction and recursive crawling (legacy, prefer expansion)"),
				use_cache: z
					.boolean()
					.optional()
					.describe("Enable global crawl cache for 50% credit savings on cache hits (default: false)"),
				cache_max_age: z
					.number()
					.optional()
					.describe("Maximum age in seconds for cached content (default: 86400 = 24 hours)"),
				dry_run: z
					.boolean()
					.optional()
					.describe("Validate request and estimate credits without executing (default: false)"),
				session_id: z
					.string()
					.optional()
					.describe("Link this crawl to an existing session for URL deduplication"),
			},
		},
		async ({
			urls,
			max_pages,
			extraction_schema,
			classify_documents,
			generate_summary,
			expansion,
			follow_links,
			use_cache,
			cache_max_age,
			dry_run,
			session_id,
		}) => {
			try {
				const result = await crawlWithPolling({
					urls,
					max_pages: max_pages ?? 10,
					extraction_schema: extraction_schema ?? undefined,
					classify_documents: classify_documents ?? true,
					generate_summary: generate_summary ?? false,
					expansion: expansion ?? undefined,
					follow_links: follow_links ?? undefined,
					use_cache: use_cache ?? undefined,
					cache_max_age: cache_max_age ?? undefined,
					dry_run: dry_run ?? undefined,
					session_id: session_id ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Suggest Schema - AI-powered extraction schema suggestion (2 credits)
	// =========================================================================
	server.registerTool(
		"zipfai_suggest_schema",
		{
			description:
				"Analyze any URL and get AI-suggested extraction schema (2 credits). " +
				"RECOMMENDED: Use this BEFORE zipfai_crawl when you don't know what fields exist on a page. " +
				"Returns detected page type (e-commerce product, blog post, news article, job listing, recipe, etc.) " +
				"and 5-8 suggested extraction fields with confidence scores and example values. " +
				"The suggested schema can be passed directly to zipfai_crawl's extraction_schema parameter.",
			inputSchema: {
				url: z.string().describe("The URL to analyze for schema suggestion"),
			},
		},
		async ({ url }) => {
			try {
				const result = await suggestSchema({ url });

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Create Session - Start a multi-step research workflow
	// =========================================================================
	server.registerTool(
		"zipfai_create_session",
		{
			description:
				"Create a research session for multi-step workflows (FREE to create). Sessions provide: URL deduplication across searches, context accumulation for better AI results, and unified credit tracking. Use sessions when doing iterative research.",
			inputSchema: {
				name: z
					.string()
					.describe("Session name, e.g. 'AI Infrastructure Research'"),
				description: z
					.string()
					.optional()
					.describe("Optional description of research goals"),
				intent_context: z
					.string()
					.optional()
					.describe(
						"Research intent for AI guidance, e.g. 'Building competitive analysis for investment decisions'",
					),
				auto_deduplicate: z
					.boolean()
					.optional()
					.describe("Auto-remove duplicate URLs (default: true)"),
				use_session_context: z
					.boolean()
					.optional()
					.describe("Use accumulated context for AI features (default: true)"),
			},
		},
		async ({
			name,
			description,
			intent_context,
			auto_deduplicate,
			use_session_context,
		}) => {
			try {
				const result = await createSession({
					name,
					description: description ?? undefined,
					intent_context: intent_context ?? undefined,
					session_config: {
						auto_deduplicate: auto_deduplicate ?? true,
						accumulate_context: true,
						use_session_context: use_session_context ?? true,
					},
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Session Search - Search within a session context
	// =========================================================================
	server.registerTool(
		"zipfai_session_search",
		{
			description:
				"Search within a session context (1-2 credits). Automatically deduplicates URLs already found in the session. Use session_id from zipfai_create_session. For comprehensive research, enable query_decomposition.",
			inputSchema: {
				session_id: z
					.string()
					.describe("Session ID from zipfai_create_session"),
				query: z.string().describe("Search query"),
				max_results: z
					.number()
					.optional()
					.describe("Number of results, 1-20 (default: 10)"),
				filter_seen_urls: z
					.boolean()
					.optional()
					.describe("Exclude URLs already in session (default: true)"),
				interpret_query: z
					.boolean()
					.optional()
					.describe("Enable AI query rewriting (+1 credit)"),
				rerank_results: z
					.boolean()
					.optional()
					.describe("Enable semantic reranking (+1 credit)"),
				generate_summary: z
					.boolean()
					.optional()
					.describe("Generate AI summary (FREE)"),
				query_decomposition: z
					.boolean()
					.optional()
					.describe("Enable comprehensive search via decomposition"),
				max_sub_queries: z
					.number()
					.optional()
					.describe("Sub-queries for decomposition, 1-20 (default: 5)"),
				freshness: z
					.enum(["day", "week", "month", "year"])
					.optional()
					.describe(
						"Filter results by recency: day (last 24h), week, month, or year. Omit for any time.",
					),
			},
		},
		async ({
			session_id,
			query,
			max_results,
			filter_seen_urls,
			interpret_query,
			rerank_results,
			generate_summary,
			query_decomposition,
			max_sub_queries,
			freshness,
		}) => {
			try {
				const result = await sessionSearch(session_id, {
					query,
					max_results: max_results ?? 10,
					filter_seen_urls: filter_seen_urls ?? true,
					interpret_query: interpret_query ?? false,
					rerank_results: rerank_results ?? false,
					generate_summary: generate_summary ?? false,
					query_decomposition: query_decomposition ?? false,
					max_sub_queries: max_sub_queries ?? undefined,
					freshness: freshness ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Session Crawl - Crawl within a session context
	// =========================================================================
	server.registerTool(
		"zipfai_session_crawl",
		{
			description:
				"Crawl URLs within a session context (1-2 credits/page). Automatically skips URLs already crawled in the session. Use session_id from zipfai_create_session.",
			inputSchema: {
				session_id: z
					.string()
					.describe("Session ID from zipfai_create_session"),
				urls: z.array(z.string()).describe("URLs to crawl"),
				max_pages: z
					.number()
					.optional()
					.describe("Maximum pages to crawl (default: 10)"),
				filter_seen_urls: z
					.boolean()
					.optional()
					.describe("Skip URLs already in session (default: true)"),
				extraction_schema: z
					.record(z.string())
					.optional()
					.describe("Custom fields to extract (+1 credit/page)"),
				classify_documents: z
					.boolean()
					.optional()
					.describe("Enable AI classification (default: true)"),
				generate_summary: z
					.boolean()
					.optional()
					.describe("Generate AI summary (FREE)"),
			},
		},
		async ({
			session_id,
			urls,
			max_pages,
			filter_seen_urls,
			extraction_schema,
			classify_documents,
			generate_summary,
		}) => {
			try {
				const result = await sessionCrawl(session_id, {
					urls,
					max_pages: max_pages ?? 10,
					filter_seen_urls: filter_seen_urls ?? true,
					extraction_schema: extraction_schema ?? undefined,
					classify_documents: classify_documents ?? true,
					generate_summary: generate_summary ?? false,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Session Timeline - Get session operation history
	// =========================================================================
	server.registerTool(
		"zipfai_session_timeline",
		{
			description:
				"Get the timeline of all operations in a session (FREE). Shows searches, crawls, credits consumed, and aggregated stats. Use to review session progress.",
			inputSchema: {
				session_id: z.string().describe("Session ID to get timeline for"),
			},
		},
		async ({ session_id }) => {
			try {
				const result = await getSessionTimeline(session_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Complete Session - Mark session as completed
	// =========================================================================
	server.registerTool(
		"zipfai_complete_session",
		{
			description:
				"Mark a session as completed (FREE). Prevents new operations from being added. Use when research is finished.",
			inputSchema: {
				session_id: z.string().describe("Session ID to complete"),
			},
		},
		async ({ session_id }) => {
			try {
				const result = await completeSession(session_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Research - Combo search + auto-crawl (variable credits)
	// =========================================================================
	server.registerTool(
		"zipfai_research",
		{
			description:
				"One-call search + auto-crawl combo for comprehensive research (variable credits: search + crawl costs). Searches for your query, then automatically crawls top results and synthesizes an answer. Best for deep research where you need full content from top sources.",
			inputSchema: {
				query: z.string().describe("Research query"),
				search_count: z
					.number()
					.optional()
					.describe("Search results to consider, 1-20 (default: 10)"),
				auto_crawl_top_n: z
					.number()
					.optional()
					.describe("Top N results to crawl, 1-10 (default: 5)"),
				max_pages_per_url: z
					.number()
					.optional()
					.describe("Pages to crawl per URL (default: 1)"),
				extraction_schema: z
					.record(z.string())
					.optional()
					.describe("Custom fields to extract from crawled pages"),
				only_uncrawled: z
					.boolean()
					.optional()
					.describe("Skip URLs crawled in last 7 days (default: true)"),
				classify_documents: z
					.boolean()
					.optional()
					.describe("Enable AI document classification (default: true, triggers advanced pricing)"),
				interpret_query: z
					.boolean()
					.optional()
					.describe("Enable AI query rewriting for better results (+1 credit)"),
				rerank_results: z
					.boolean()
					.optional()
					.describe("Enable semantic reranking to improve result relevance (+1 credit)"),
				generate_suggestions: z
					.boolean()
					.optional()
					.describe("Generate 'People Also Ask' style follow-up queries"),
				session_id: z
					.string()
					.optional()
					.describe("Link research to an existing session for context accumulation"),
			},
		},
		async ({
			query,
			search_count,
			auto_crawl_top_n,
			max_pages_per_url,
			extraction_schema,
			only_uncrawled,
			classify_documents,
			interpret_query,
			rerank_results,
			generate_suggestions,
			session_id,
		}) => {
			try {
				const result = await research({
					query,
					search_count: search_count ?? 10,
					auto_crawl_top_n: auto_crawl_top_n ?? 5,
					max_pages_per_url: max_pages_per_url ?? 1,
					extraction_schema: extraction_schema ?? undefined,
					only_uncrawled: only_uncrawled ?? undefined,
					classify_documents: classify_documents ?? undefined,
					interpret_query: interpret_query ?? undefined,
					rerank_results: rerank_results ?? undefined,
					generate_suggestions: generate_suggestions ?? undefined,
					session_id: session_id ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Plan Workflow - Preview AI-planned workflow (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_plan_workflow",
		{
			description:
				"🌟 AI-planned multi-step workflow from natural language (FREE preview, advanced research costs credits). " +
				"Describe what you want to monitor in plain English, and Claude generates a complete workflow. " +
				"\n\n" +
				"**SIMPLIFIED API:** Use `advanced` parameter to enable pre-planning research:\n" +
				"• `advanced: true` or `advanced: 'standard'` - Balanced research (~30 credits)\n" +
				"• `advanced: 'quick'` - Fast research (~10 credits)\n" +
				"• `advanced: 'thorough'` - Deep research with query decomposition (~50 credits)\n" +
				"• `advanced: 'comprehensive'` - Maximum depth (~100 credits)\n" +
				"\n" +
				"**Example:**\n" +
				"```\n" +
				"zipfai_plan_workflow({\n" +
				'  intent: "Monitor NVIDIA product launches",\n' +
				'  advanced: "standard"\n' +
				"})\n" +
				"```\n" +
				"\n" +
				"Use zipfai_create_workflow to deploy the generated plan.",
			inputSchema: {
				intent: z
					.string()
					.describe(
						"Natural language description of what to monitor (10-2000 chars). Be specific about entities, data to extract, and alerting conditions.",
					),
				name: z.string().optional().describe("Optional name for the workflow"),
				max_credits_per_execution: z
					.number()
					.optional()
					.describe("Budget limit per execution (default: no limit)"),
				skip_entity_discovery: z
					.boolean()
					.optional()
					.describe("Skip entity discovery for faster response (default: false)"),
				advanced: z
					.union([
						z.boolean(),
						z.enum(["quick", "standard", "thorough", "comprehensive"]),
					])
					.optional()
					.describe(
						"Enable advanced research before workflow generation. " +
						"Set to true (uses 'standard' preset) or specify a preset: " +
						"'quick' (~10 credits), 'standard' (~30 credits), 'thorough' (~50 credits), 'comprehensive' (~100 credits). " +
						"Advanced research gathers real web data about entities and resolves URLs/addresses before generating the workflow.",
					),
			},
		},
		async ({
			intent,
			name,
			max_credits_per_execution,
			skip_entity_discovery,
			advanced,
		}) => {
			try {
				const result = await planWorkflow({
					intent,
					name: name ?? undefined,
					max_credits_per_execution: max_credits_per_execution ?? undefined,
					skip_entity_discovery: skip_entity_discovery ?? undefined,
					advanced: advanced ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Create Workflow - Scheduled recurring monitoring (1-2 credits/execution)
	// =========================================================================
	server.registerTool(
		"zipfai_create_workflow",
		{
			description:
				"Create a workflow for scheduled recurring monitoring (1-2 credits per execution). Supports search, crawl, or AI-planned multi-step workflows.",
			inputSchema: {
				name: z.string().describe("Workflow name"),
				mode: z
					.enum(["simple", "multi_step", "ai_planned"])
					.optional()
					.describe("Workflow mode (default: simple)"),
				workflow_type: z
					.enum(["search", "crawl"])
					.optional()
					.describe("For simple mode: search or crawl"),
				operation_config: z
					.record(z.unknown())
					.optional()
					.describe(
						"For simple mode: {query, max_results} or {urls, max_pages}",
					),
				intent: z
					.string()
					.optional()
					.describe("For ai_planned mode: natural language description"),
				stop_condition_type: z
					.enum([
						"result_count",
						"contains_url",
						"field_value",
						"extracted_field",
						"natural_language",
						"always",
					])
					.describe("Stop condition type"),
				stop_condition_value: z
					.string()
					.optional()
					.describe("Stop condition value/description"),
				stop_condition_operator: z
					.string()
					.optional()
					.describe("Stop condition operator (>, <, ==, contains, etc.)"),
				stop_condition_confidence: z
					.number()
					.optional()
					.describe(
						"For natural_language: confidence threshold (default: 0.7)",
					),
				interval: z
					.string()
					.optional()
					.describe(
						"How often to run (preferred): '30 minutes', '6 hours', '1 day', '2 weeks'",
					),
				interval_minutes: z
					.number()
					.optional()
					.describe(
						"Alternative: interval in minutes (prefer interval string). Required if interval not provided.",
					),
				cron_expression: z
					.string()
					.optional()
					.describe(
						"Cron expression (5-field format): '0 9 * * MON,WED,FRI' for 9am on Mon/Wed/Fri. Overrides interval.",
					),
				scheduled_for: z
					.string()
					.optional()
					.describe(
						"ISO 8601 datetime for one-time scheduled run. Overrides both cron_expression and interval.",
					),
				anchor_minute: z
					.number()
					.optional()
					.describe(
						"Anchor minute (0-59) for aligned intervals. E.g., anchor_minute=0 with interval='1 hour' runs at :00.",
					),
				timezone: z
					.string()
					.optional()
					.describe(
						"IANA timezone for schedule interpretation (default: 'UTC'). E.g., 'America/New_York'.",
					),
				max_executions: z
					.number()
					.optional()
					.describe("Optional limit on total executions"),
			},
		},
		async ({
			name,
			mode,
			workflow_type,
			operation_config,
			intent,
			stop_condition_type,
			stop_condition_value,
			stop_condition_operator,
			stop_condition_confidence,
			interval,
			interval_minutes,
			cron_expression,
			scheduled_for,
			anchor_minute,
			timezone,
			max_executions,
		}) => {
			try {
				// Build stop condition from parameters
				const stopCondition: Record<string, unknown> = {
					type: stop_condition_type,
				};
				if (stop_condition_value) {
					if (stop_condition_type === "natural_language") {
						stopCondition.description = stop_condition_value;
						if (stop_condition_confidence) {
							stopCondition.confidence_threshold = stop_condition_confidence;
						}
					} else if (stop_condition_type === "contains_url") {
						stopCondition.url = stop_condition_value;
					} else {
						stopCondition.value = stop_condition_value;
					}
				}
				if (stop_condition_operator) {
					stopCondition.operator = stop_condition_operator;
				}

				const result = await createWorkflow({
					name,
					mode: mode ?? "simple",
					workflow_type: workflow_type ?? undefined,
					operation_config: operation_config ?? undefined,
					intent: intent ?? undefined,
					stop_condition: stopCondition as {
						type:
							| "result_count"
							| "contains_url"
							| "field_value"
							| "extracted_field"
							| "natural_language"
							| "always";
					},
					interval: interval ?? undefined,
					interval_minutes: interval_minutes ?? undefined,
					cron_expression: cron_expression ?? undefined,
					scheduled_for: scheduled_for ?? undefined,
					anchor_minute: anchor_minute ?? undefined,
					timezone: timezone ?? undefined,
					max_executions: max_executions ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// List Workflows - Get all workflows (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_list_workflows",
		{
			description: "List all workflows with pagination and filtering (FREE).",
			inputSchema: {
				limit: z
					.number()
					.optional()
					.describe("Number of results, 1-100 (default: 20)"),
				offset: z
					.number()
					.optional()
					.describe("Pagination offset (default: 0)"),
				status: z
					.enum(["active", "paused", "completed", "failed"])
					.optional()
					.describe("Filter by status"),
			},
		},
		async ({ limit, offset, status }) => {
			try {
				const result = await listWorkflows({
					limit: limit ?? undefined,
					offset: offset ?? undefined,
					status: status ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Get Workflow - Get workflow details (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_get_workflow",
		{
			description:
				"Get comprehensive workflow information including configuration and execution history (FREE).",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await getWorkflowDetails(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Update Workflow - Modify workflow parameters (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_update_workflow",
		{
			description:
				"Update workflow parameters - name, query, interval, stop condition, or status (FREE).",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				name: z.string().optional().describe("New workflow name"),
				operation_config: z
					.record(z.unknown())
					.optional()
					.describe("New operation config"),
				interval: z
					.string()
					.optional()
					.describe(
						"New interval (preferred): '30 minutes', '6 hours', '1 day', '2 weeks'",
					),
				interval_minutes: z
					.number()
					.optional()
					.describe(
						"Alternative: interval in minutes (prefer interval string)",
					),
				cron_expression: z
					.string()
					.optional()
					.describe(
						"Cron expression (5-field format): '0 9 * * MON,WED,FRI' for 9am on Mon/Wed/Fri. Overrides interval.",
					),
				scheduled_for: z
					.string()
					.optional()
					.describe(
						"ISO 8601 datetime for one-time scheduled run. Overrides both cron_expression and interval.",
					),
				anchor_minute: z
					.number()
					.optional()
					.describe(
						"Anchor minute (0-59) for aligned intervals. E.g., anchor_minute=0 with interval='1 hour' runs at :00.",
					),
				timezone: z
					.string()
					.optional()
					.describe(
						"IANA timezone for schedule interpretation (default: 'UTC'). E.g., 'America/New_York'.",
					),
				max_executions: z.number().optional().describe("New execution limit"),
				status: z
					.enum(["active", "paused", "completed", "failed"])
					.optional()
					.describe("New status"),
			},
		},
		async ({
			workflow_id,
			name,
			operation_config,
			interval,
			interval_minutes,
			cron_expression,
			scheduled_for,
			anchor_minute,
			timezone,
			max_executions,
			status,
		}) => {
			try {
				const result = await updateWorkflow(workflow_id, {
					name: name ?? undefined,
					operation_config: operation_config ?? undefined,
					interval: interval ?? undefined,
					interval_minutes: interval_minutes ?? undefined,
					cron_expression: cron_expression ?? undefined,
					scheduled_for: scheduled_for ?? undefined,
					anchor_minute: anchor_minute ?? undefined,
					timezone: timezone ?? undefined,
					max_executions: max_executions ?? undefined,
					status: status ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Execute Workflow - Run workflow immediately (1-2 credits)
	// =========================================================================
	server.registerTool(
		"zipfai_execute_workflow",
		{
			description:
				"Execute a workflow immediately (1-2 credits). Does not affect regular schedule.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await executeWorkflow(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow Timeline - Get execution history (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_workflow_timeline",
		{
			description:
				"Get chronological execution history for a workflow (FREE). Shows last 50 executions.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await getWorkflowTimeline(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow Diff - Get execution diffs (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_workflow_diff",
		{
			description:
				"Get what changed between workflow executions (FREE). Returns diffs instead of raw data.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				limit: z
					.number()
					.optional()
					.describe("Number of diffs to return, 1-50 (default: 10)"),
				since: z
					.string()
					.optional()
					.describe("Only show diffs after this ISO timestamp"),
			},
		},
		async ({ workflow_id, limit, since }) => {
			try {
				const result = await getWorkflowDiff(workflow_id, {
					limit: limit ?? undefined,
					since: since ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow Updates Digest - Consolidated "what's new" view (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_workflow_updates",
		{
			description: `Get a consolidated digest of all workflow updates since your last check (FREE). Returns a single summary showing which workflows have changes, which triggered their stop conditions, and what changed - eliminating the need to check each workflow individually. Perfect for daily/weekly monitoring routines.

Key benefits:
- One call replaces N calls (list + timeline + diff for each)
- Pre-sorted by priority: triggered first, then changed, then recent
- Concise summaries optimized for AI agent consumption
- Optional verbose mode for full diff details

Recommended workflow:
1. Call zipfai_workflow_updates to get overview
2. For interesting workflows, use zipfai_workflow_diff for details
3. Take action based on findings`,
			inputSchema: {
				since: z
					.string()
					.optional()
					.describe(
						"ISO timestamp to check updates since (default: 24 hours ago). Use shorter windows for frequent checks.",
					),
				include_inactive: z
					.boolean()
					.optional()
					.describe(
						"Include paused/completed workflows (default: false). Useful for auditing all workflows.",
					),
				max_workflows: z
					.number()
					.optional()
					.describe(
						"Limit number of workflows to check (default: 20). Use for large accounts to control response size.",
					),
				verbose: z
					.boolean()
					.optional()
					.describe(
						"Include full diff details and execution history (default: false). Use when you need complete change history.",
					),
			},
		},
		async ({ since, include_inactive, max_workflows, verbose }) => {
			try {
				const result = await getWorkflowUpdatesDigest({
					since: since ?? undefined,
					include_inactive: include_inactive ?? undefined,
					max_workflows: max_workflows ?? undefined,
					verbose: verbose ?? undefined,
				});

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Delete Workflow - Stop and remove workflow (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_delete_workflow",
		{
			description:
				"Delete a workflow and stop scheduled executions (FREE).",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await deleteWorkflow(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);
}
