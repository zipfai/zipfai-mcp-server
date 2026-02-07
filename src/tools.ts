import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	ApiError,
	applyWorkflowRecovery,
	ask,
	assessIntent,
	batchRateExecutions,
	completeSession,
	crawlWithPolling,
	createEntitySchema,
	createEntitySignal,
	createSession,
	createWorkflow,
	deleteEntitySchema,
	deleteEntitySignal,
	deleteWorkflow,
	executeWorkflow,
	exportEntities,
	getEntity,
	getEntitySchema,
	getEntitySignal,
	getExecutionRatingStats,
	getExecutionRatings,
	getSessionTimeline,
	getStatus,
	getWorkflowDetails,
	getWorkflowDiff,
	getWorkflowRecoverySuggestions,
	getWorkflowSlackStatus,
	getWorkflowTimeline,
	getWorkflowUpdatesDigest,
	getWorkflowValidationStatus,
	listEntities,
	listEntitySchemas,
	listEntitySignals,
	listWorkflows,
	planWorkflow,
	queryEntities,
	rateExecution,
	research,
	searchWithPolling,
	sessionCrawl,
	sessionSearch,
	suggestSchema,
	testWorkflowSlack,
	updateEntity,
	updateEntitySignal,
	updateWorkflow,
	validateWorkflow,
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
					.describe(
						"Answer length: concise (1-3 sentences) or detailed (full paragraph). Default: concise",
					),
				session_id: z
					.string()
					.optional()
					.describe(
						"Link to a session for contextual rewrites. Enables follow-up questions that reference previous context.",
					),
				skip_rerank: z
					.boolean()
					.optional()
					.describe(
						"Skip result reranking (default: true - search engines rank well for factual QA)",
					),
				enable_query_rewrite: z
					.boolean()
					.optional()
					.describe(
						"Enable LLM-based query rewriting for better search results (default: false)",
					),
				enable_decomposition: z
					.boolean()
					.optional()
					.describe(
						"Enable query decomposition for comprehensive search (default: false)",
					),
				max_sub_queries: z
					.number()
					.optional()
					.describe(
						"Max sub-queries when decomposition is enabled, 1-5 (default: 3)",
					),
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
					.describe(
						"Enable link extraction and recursive crawling (legacy, prefer expansion)",
					),
				use_cache: z
					.boolean()
					.optional()
					.describe(
						"Enable global crawl cache for 50% credit savings on cache hits (default: false)",
					),
				cache_max_age: z
					.number()
					.optional()
					.describe(
						"Maximum age in seconds for cached content (default: 86400 = 24 hours)",
					),
				dry_run: z
					.boolean()
					.optional()
					.describe(
						"Validate request and estimate credits without executing (default: false)",
					),
				session_id: z
					.string()
					.optional()
					.describe(
						"Link this crawl to an existing session for URL deduplication",
					),
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
				"Crawl URLs within a session context (1-2 credits/page). Automatically skips URLs already crawled in the session. When expansion is enabled, Smart Crawl finds high-value pages first, saving 50-75% of crawl budget. Use session_id from zipfai_create_session.",
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
				expansion: z
					.enum(["internal", "external", "both", "none"])
					.optional()
					.describe(
						"Link following with Smart Crawl: internal (same domain), external (other domains), both, or none. Smart Crawl automatically prioritizes high-value pages.",
					),
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
			expansion,
		}) => {
			try {
				const result = await sessionCrawl(session_id, {
					urls,
					max_pages: max_pages ?? 10,
					filter_seen_urls: filter_seen_urls ?? true,
					extraction_schema: extraction_schema ?? undefined,
					classify_documents: classify_documents ?? true,
					generate_summary: generate_summary ?? false,
					expansion: expansion ?? undefined,
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
					.describe(
						"Enable AI document classification (default: true, triggers advanced pricing)",
					),
				interpret_query: z
					.boolean()
					.optional()
					.describe("Enable AI query rewriting for better results (+1 credit)"),
				rerank_results: z
					.boolean()
					.optional()
					.describe(
						"Enable semantic reranking to improve result relevance (+1 credit)",
					),
				generate_suggestions: z
					.boolean()
					.optional()
					.describe("Generate 'People Also Ask' style follow-up queries"),
				session_id: z
					.string()
					.optional()
					.describe(
						"Link research to an existing session for context accumulation",
					),
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
	// Workflow - Assess if monitoring intent is specific enough (FREE)
	// =========================================================================
	server.registerTool(
		"zipfai_assess_intent",
		{
			description:
				'Assess if a monitoring intent is specific enough to execute reliably (FREE). Returns a specificity score (1-10), identifies vague aspects, and suggests a more specific rewrite if needed. Use this before zipfai_plan_workflow to ensure your intent is clear and actionable.\n\n**Score interpretation:**\n• 8-10: Specific - ready to plan\n• 7: Borderline - may want to add details\n• 1-6: Vague - use the proposed_intent or add more detail\n\n**Example:**\n```\nzipfai_assess_intent({ intent: "Tell me when new LLMs release" })\n// Returns: score 3, suggests more specific intent with trigger conditions and sources\n```',
			inputSchema: {
				intent: z
					.string()
					.describe("The monitoring intent to assess (10-2000 chars)"),
			},
		},
		async ({ intent }) => {
			try {
				const result = await assessIntent({ intent });

				const response = {
					assessment: result.assessment,
					specificity_score: result.specificity_score,
					is_actionable: result.is_actionable,
					recommendation: result.recommendation,
					...(result.proposed_intent && {
						proposed_intent: result.proposed_intent,
					}),
					...(result.vague_aspects?.length && {
						vague_aspects: result.vague_aspects,
					}),
					...(result.what_we_clarified?.length && {
						what_we_clarified: result.what_we_clarified,
					}),
					inferred: result.inferred,
				};

				return {
					content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
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
				'🌟 AI-planned multi-step workflow from natural language (FREE preview). Describe what you want to monitor in plain English, and the hybrid planner generates a complete workflow.\n\n**Planner controls:**\n• `quality_mode: "quality_first"` (default) maximizes coverage/depth\n• `quality_mode: "balanced"` reduces cost/complexity\n• `planning_budget` guides budget-aware shaping\n\n**Example:**\n```\nzipfai_plan_workflow({\n  intent: "Monitor NVIDIA product launches",\n  quality_mode: "quality_first",\n  planning_budget: 40\n})\n```\n\nUse zipfai_create_workflow to deploy the generated plan.',
			inputSchema: {
				intent: z
					.string()
					.describe(
						"Natural language description of what to monitor (10-2000 chars)",
					),
				name: z.string().optional().describe("Optional name for the workflow"),
				max_credits_per_execution: z
					.number()
					.optional()
					.describe("Budget limit per execution"),
				planning_budget: z
					.number()
					.optional()
					.describe(
						"Planner budget hint (takes precedence over max_credits_per_execution)",
					),
				quality_mode: z
					.enum(["quality_first", "balanced"])
					.optional()
					.describe(
						"Planner profile: quality_first (default) or balanced",
					),
				skip_entity_discovery: z
					.boolean()
					.optional()
					.describe("Skip entity discovery for faster response"),
			},
		},
		async ({
			intent,
			name,
			max_credits_per_execution,
			planning_budget,
			quality_mode,
			skip_entity_discovery,
		}) => {
			try {
				const result = await planWorkflow({
					intent,
					name: name ?? undefined,
					max_credits_per_execution: max_credits_per_execution ?? undefined,
					planning_budget: planning_budget ?? undefined,
					quality_mode: quality_mode ?? undefined,
					skip_entity_discovery: skip_entity_discovery ?? undefined,
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
				"Create a workflow for scheduled recurring monitoring (1-2 credits per execution). Supports search, crawl, or AI-planned multi-step workflows. For multi_step mode, provide steps array with fan_out for parallel execution. Email notifications enabled by default. Slack notifications available via slack_webhook_url.",
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
				steps: z
					.array(
						z.object({
							step_id: z.string().describe("Unique step identifier"),
							step_name: z.string().describe("Human-readable step name"),
							step_type: z
								.enum(["search", "crawl", "aggregate", "fan_out", "filter", "transform"])
								.describe("Step type"),
							config: z.record(z.unknown()).describe("Step-specific configuration"),
							depends_on: z
								.array(z.string())
								.optional()
								.describe("Step IDs this step depends on"),
							output_key: z
								.string()
								.optional()
								.describe("Key to store step output for downstream steps"),
							cascade_condition: z
								.object({
									type: z
										.string()
										.describe(
											"Condition type: always, has_results, result_count, field_match, llm_evaluate",
										),
									from_step: z
										.string()
										.optional()
										.describe("Step ID to evaluate condition against"),
									operator: z.string().optional().describe("Comparison operator"),
									value: z.unknown().optional().describe("Value to compare against"),
								})
								.optional()
								.describe("Condition for step execution based on previous step results"),
						}),
					)
					.optional()
					.describe(
						"For multi_step mode: array of workflow steps with dependencies and cascade conditions. Enables fan-out parallel execution.",
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
				email_notifications: z
					.boolean()
					.optional()
					.describe(
						"Enable email notifications for this workflow (default: true). Set to false to disable all emails.",
					),
				email_per_execution: z
					.boolean()
					.optional()
					.describe(
						"Send an email after each workflow execution (default: true when notifications enabled).",
					),
				email_digest: z
					.enum(["none", "daily", "weekly"])
					.optional()
					.describe(
						"Email digest frequency: 'none' (per-execution only), 'daily', or 'weekly'. Default: 'none'.",
					),
				email_recipients: z
					.array(z.string())
					.optional()
					.describe(
						"Custom email recipients (array of email addresses). If not provided, uses account email.",
					),
				slack_webhook_url: z
					.string()
					.optional()
					.describe(
						"Slack Incoming Webhook URL (https://hooks.slack.com/services/..., /workflows/..., or /triggers/...)",
					),
				slack_per_execution: z
					.boolean()
					.optional()
					.describe(
						"Send Slack notification after each execution (default: true when webhook provided)",
					),
				slack_include_diff: z
					.boolean()
					.optional()
					.describe("Include change diff in Slack notifications (default: true)"),
				slack_include_summary: z
					.boolean()
					.optional()
					.describe("Include AI summary in Slack notifications (default: true)"),
				dry_run: z
					.boolean()
					.optional()
					.describe(
						"Preview cost estimate without creating workflow. Returns estimated credits per execution and balance check. For ai_planned mode, use zipfai_plan_workflow instead.",
					),
				recency_confidence_threshold: z
					.number()
					.optional()
					.describe(
						"Content recency filter confidence threshold (0-1). Lower values filter more aggressively. " +
						"Higher values only filter when dates are explicitly detected. Default: 0.50. " +
						"Set to 1.0 to disable filtering entirely.",
					),
			},
		},
		async ({
			name,
			mode,
			workflow_type,
			operation_config,
			steps,
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
			email_notifications,
			email_per_execution,
			email_digest,
			email_recipients,
			slack_webhook_url,
			slack_per_execution,
			slack_include_diff,
			slack_include_summary,
			dry_run,
			recency_confidence_threshold,
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

				// Build email config from parameters if any email settings provided
				let emailConfig:
					| {
							enabled: boolean;
							per_execution?: boolean;
							digest?: "none" | "daily" | "weekly";
							recipients?: string[] | null;
					  }
					| undefined;
				if (
					email_notifications !== undefined ||
					email_per_execution !== undefined ||
					email_digest !== undefined ||
					email_recipients !== undefined
				) {
					emailConfig = {
						enabled: email_notifications ?? true,
						per_execution: email_per_execution ?? true,
						digest: email_digest ?? "none",
						recipients: email_recipients ?? null,
					};
				}

				// Build slack config from parameters if any slack settings provided
				let slackConfig:
					| {
							enabled: boolean;
							webhook_url?: string;
							per_execution?: boolean;
							include_diff?: boolean;
							include_summary?: boolean;
					  }
					| undefined;
				if (
					slack_webhook_url !== undefined ||
					slack_per_execution !== undefined ||
					slack_include_diff !== undefined ||
					slack_include_summary !== undefined
				) {
					slackConfig = {
						enabled: true,
						webhook_url: slack_webhook_url ?? undefined,
						per_execution: slack_per_execution ?? true,
						include_diff: slack_include_diff ?? true,
						include_summary: slack_include_summary ?? true,
					};
				}

				const result = await createWorkflow({
					name,
					mode: mode ?? "simple",
					workflow_type: workflow_type ?? undefined,
					operation_config: operation_config ?? undefined,
					steps: steps as Array<{
						step_id: string;
						step_name: string;
						step_type: "search" | "crawl" | "aggregate";
						config: Record<string, unknown>;
						depends_on?: string[];
						output_key?: string;
						cascade_condition?: {
							type: string;
							from_step?: string;
							operator?: string;
							value?: unknown;
						};
					}> ?? undefined,
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
					email_config: emailConfig,
					slack_config: slackConfig,
					dry_run: dry_run ?? undefined,
					recency_confidence_threshold: recency_confidence_threshold ?? undefined,
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
				"Update workflow parameters - name, query, schedule, stop condition, status, email/Slack notifications, or suppression threshold (FREE). Use disable_emails/disable_slack to turn off notifications. Use suppression_threshold (0-100) to control notification intelligence.",
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
				email_notifications: z
					.boolean()
					.optional()
					.describe("Enable/disable email notifications for this workflow."),
				email_per_execution: z
					.boolean()
					.optional()
					.describe("Enable/disable per-execution email notifications."),
				email_digest: z
					.enum(["none", "daily", "weekly"])
					.optional()
					.describe("Email digest frequency: 'none', 'daily', or 'weekly'."),
				email_recipients: z
					.array(z.string())
					.optional()
					.describe(
						"Custom email recipients (array of email addresses). Set to empty array to use account email.",
					),
				disable_emails: z
					.boolean()
					.optional()
					.describe(
						"Set to true to completely disable email notifications (sets email_config to null).",
					),
				slack_webhook_url: z
					.string()
					.optional()
					.describe(
						"Slack Incoming Webhook URL (https://hooks.slack.com/services/..., /workflows/..., or /triggers/...)",
					),
				slack_per_execution: z
					.boolean()
					.optional()
					.describe(
						"Send Slack notification after each execution (default: true when webhook provided)",
					),
				slack_include_diff: z
					.boolean()
					.optional()
					.describe("Include change diff in Slack notifications (default: true)"),
				slack_include_summary: z
					.boolean()
					.optional()
					.describe("Include AI summary in Slack notifications (default: true)"),
				disable_slack: z
					.boolean()
					.optional()
					.describe(
						"Set to true to completely disable Slack notifications (sets slack_config to null).",
					),
				recency_confidence_threshold: z
					.number()
					.optional()
					.describe(
						"Content recency filter confidence threshold (0-1). Lower values filter more aggressively. " +
						"Higher values only filter when dates are explicitly detected. Default: 0.50. " +
						"Set to 1.0 to disable filtering entirely.",
					),
				suppression_threshold: z
					.number()
					.optional()
					.describe(
						"Minimum information gain score (0-100) to send notification. Higher values = more suppression. " +
						"Presets: 0 (all), 30 (balanced), 50 (important), 70 (critical). Default: 30.",
					),
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
			email_notifications,
			email_per_execution,
			email_digest,
			email_recipients,
			disable_emails,
			slack_webhook_url,
			slack_per_execution,
			slack_include_diff,
			slack_include_summary,
			disable_slack,
			recency_confidence_threshold,
			suppression_threshold,
		}) => {
			try {
				// Build email config if any email settings provided
				let emailConfig:
					| {
							enabled: boolean;
							per_execution?: boolean;
							digest?: "none" | "daily" | "weekly";
							recipients?: string[] | null;
					  }
					| null
					| undefined;

				if (disable_emails === true) {
					// Explicitly disable all emails
					emailConfig = null;
				} else if (
					email_notifications !== undefined ||
					email_per_execution !== undefined ||
					email_digest !== undefined ||
					email_recipients !== undefined
				) {
					emailConfig = {
						enabled: email_notifications ?? true,
						per_execution: email_per_execution,
						digest: email_digest,
						recipients:
							email_recipients && email_recipients.length > 0
								? email_recipients
								: null,
					};
				}

				// Build slack config if any slack settings provided
				let slackConfig:
					| {
							enabled: boolean;
							webhook_url?: string;
							per_execution?: boolean;
							include_diff?: boolean;
							include_summary?: boolean;
					  }
					| null
					| undefined;

				if (disable_slack === true) {
					// Explicitly disable all slack notifications
					slackConfig = null;
				} else if (
					slack_webhook_url !== undefined ||
					slack_per_execution !== undefined ||
					slack_include_diff !== undefined ||
					slack_include_summary !== undefined
				) {
					slackConfig = {
						enabled: true,
						webhook_url: slack_webhook_url,
						per_execution: slack_per_execution ?? true,
						include_diff: slack_include_diff ?? true,
						include_summary: slack_include_summary ?? true,
					};
				}

				// Build notification settings if suppression_threshold provided
				const notificationSettings =
					suppression_threshold !== undefined
						? { suppression_threshold }
						: undefined;

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
					email_config: emailConfig,
					slack_config: slackConfig,
					notification_settings: notificationSettings,
					recency_confidence_threshold: recency_confidence_threshold ?? undefined,
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
				"Execute a workflow immediately (1-2 credits). Does not affect regular schedule. Use dry_run to preview execution cost without actually running.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				dry_run: z
					.boolean()
					.optional()
					.describe(
						"Preview execution cost without running. Returns cost estimate based on workflow configuration.",
					),
			},
		},
		async ({ workflow_id, dry_run }) => {
			try {
				const result = await executeWorkflow(workflow_id, {
					dry_run: dry_run ?? undefined,
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
				"Get what changed between consecutive workflow executions (FREE). Returns diffs instead of raw data. Changes are calculated by comparing each execution to its immediately previous execution (not to a global baseline). When `previous_execution_id` is null in a diff entry, it indicates the first execution.",
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
	// Workflow Execution Feedback - Submit a rating
	// =========================================================================
	server.registerTool(
		"zipfai_rate_execution",
		{
			description:
				"Submit thumbs up/down feedback for a workflow execution (FREE). This improves workflow quality over time.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				execution_id: z.string().describe("Execution ID from workflow timeline"),
				execution_kind: z
					.enum(["workflow_execution", "search_job", "crawl_job", "workflow_step"])
					.optional()
					.describe("Execution record type"),
				workflow_step_id: z
					.string()
					.optional()
					.describe("Optional step ID for step-level feedback"),
				rating: z
					.enum(["positive", "negative"])
					.describe("Was this execution helpful?"),
				reason_category: z
					.enum([
						"relevant_results",
						"accurate_information",
						"timely_alert",
						"good_formatting",
						"irrelevant_results",
						"missing_information",
						"outdated_content",
						"false_positive",
						"missed_alert",
						"too_slow",
						"other",
					])
					.optional()
					.describe("Reason taxonomy label"),
				comment: z
					.string()
					.max(1000)
					.optional()
					.describe("Additional context (max 1000 chars)"),
				result_url: z.string().optional().describe("Specific result URL being rated"),
				idempotency_key: z.string().optional().describe("Optional idempotency key"),
				actor_model: z.string().optional().describe("Model/provider identifier"),
			},
		},
		async ({
			workflow_id,
			execution_id,
			execution_kind,
			workflow_step_id,
			rating,
			reason_category,
			comment,
			result_url,
			idempotency_key,
			actor_model,
		}) => {
			try {
				const result = await rateExecution(workflow_id, execution_id, {
					execution_kind: execution_kind ?? undefined,
					workflow_step_id: workflow_step_id ?? undefined,
					rating,
					reason_category: reason_category ?? undefined,
					comment: comment ?? undefined,
					result_url: result_url ?? undefined,
					idempotency_key: idempotency_key ?? undefined,
					actor_model: actor_model ?? undefined,
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
	// Workflow Execution Feedback - List ratings
	// =========================================================================
	server.registerTool(
		"zipfai_execution_ratings",
		{
			description:
				"Get execution feedback signals for a workflow (FREE). Useful for identifying what worked and what failed.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				execution_id: z.string().optional().describe("Filter to specific execution"),
				workflow_step_id: z
					.string()
					.optional()
					.describe("Filter to specific workflow step"),
				signal_type: z
					.enum(["positive", "negative", "all"])
					.optional()
					.default("all")
					.describe("Filter by feedback type"),
				actor_type: z
					.enum(["human", "api", "mcp", "all"])
					.optional()
					.default("all")
					.describe("Filter by actor type"),
				reason_category: z
					.enum([
						"relevant_results",
						"accurate_information",
						"timely_alert",
						"good_formatting",
						"irrelevant_results",
						"missing_information",
						"outdated_content",
						"false_positive",
						"missed_alert",
						"too_slow",
						"other",
						"all",
					])
					.optional()
					.default("all")
					.describe("Filter by reason category"),
				limit: z.number().optional().default(50).describe("Max results (1-100)"),
				since: z
					.string()
					.optional()
					.describe("ISO timestamp - only feedback after this time"),
				until: z
					.string()
					.optional()
					.describe("ISO timestamp - only feedback before this time"),
				cursor: z.string().optional().describe("Opaque pagination cursor"),
			},
		},
		async ({
			workflow_id,
			execution_id,
			workflow_step_id,
			signal_type,
			actor_type,
			reason_category,
			limit,
			since,
			until,
			cursor,
		}) => {
			try {
				const result = await getExecutionRatings(workflow_id, {
					execution_id: execution_id ?? undefined,
					workflow_step_id: workflow_step_id ?? undefined,
					signal_type: signal_type ?? "all",
					actor_type: actor_type ?? "all",
					reason_category: reason_category ?? "all",
					limit: limit ?? 50,
					since: since ?? undefined,
					until: until ?? undefined,
					cursor: cursor ?? undefined,
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
	// Workflow Execution Feedback - Stats
	// =========================================================================
	server.registerTool(
		"zipfai_execution_rating_stats",
		{
			description:
				"Get aggregated execution feedback stats for a workflow (FREE). Includes positive rate, top issues, and reward totals.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await getExecutionRatingStats(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow Execution Feedback - Batch ratings
	// =========================================================================
	server.registerTool(
		"zipfai_batch_rate_executions",
		{
			description:
				"Submit ratings for multiple executions in one request (FREE). Up to 20 items.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				feedback: z
					.array(
						z.object({
							execution_id: z.string(),
							execution_kind: z
								.enum([
									"workflow_execution",
									"search_job",
									"crawl_job",
									"workflow_step",
								])
								.optional(),
							workflow_step_id: z.string().optional(),
							rating: z.enum(["positive", "negative"]),
							reason_category: z
								.enum([
									"relevant_results",
									"accurate_information",
									"timely_alert",
									"good_formatting",
									"irrelevant_results",
									"missing_information",
									"outdated_content",
									"false_positive",
									"missed_alert",
									"too_slow",
									"other",
								])
								.optional(),
							comment: z.string().max(1000).optional(),
							result_url: z.string().optional(),
							idempotency_key: z.string().optional(),
						}),
					)
					.max(20)
					.describe("Array of feedback items (max 20)"),
			},
		},
		async ({ workflow_id, feedback }) => {
			try {
				const result = await batchRateExecutions(workflow_id, { feedback });

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
- Smart signal scoring (0-100) ranks workflows by importance: signal_score and signal_level (urgent/notable/routine/noise)
- Pre-sorted by signal score: urgent first, then notable, then routine
- Includes semantic URL summaries with titles, snippets, and published dates
- Cross-workflow correlation: identifies shared URLs appearing across multiple monitors
- Concise summaries optimized for AI agent consumption
- Optional verbose mode for full diff details

Signal scoring factors: stop condition triggers, document types (legal/academic/news), churn rate, new domains, extraction changes, workflow priority

Recommended workflow:
1. Call zipfai_workflow_updates to get overview
2. Check correlations array for cross-workflow patterns (URLs appearing in multiple monitors)
3. Focus on urgent/notable workflows (signal_level)
4. For interesting workflows, use zipfai_workflow_diff for details`,
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
				format: z
					.enum(["json", "briefing", "briefing_llm", "compact"])
					.optional()
					.describe(
						"Output format: 'json' (default, full structured response), 'briefing' (markdown executive summary), 'briefing_llm' (LLM-synthesized briefing), 'compact' (minimal JSON with IDs and summaries only).",
					),
			},
		},
		async ({ since, include_inactive, max_workflows, verbose, format }) => {
			try {
				const result = await getWorkflowUpdatesDigest({
					since: since ?? undefined,
					include_inactive: include_inactive ?? undefined,
					max_workflows: max_workflows ?? undefined,
					verbose: verbose ?? undefined,
					format: format ?? undefined,
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
			description: "Delete a workflow and stop scheduled executions (FREE).",
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

	// =========================================================================
	// Workflow - Get Slack configuration status
	// =========================================================================
	server.registerTool(
		"zipfai_get_workflow_slack_status",
		{
			description:
				"Get Slack configuration status for a workflow (FREE). Shows whether Slack is configured, enabled, and ready for test notifications.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await getWorkflowSlackStatus(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow - Test Slack notification
	// =========================================================================
	server.registerTool(
		"zipfai_test_workflow_slack",
		{
			description:
				"Send a test Slack notification for a workflow (FREE). Verifies that the Slack webhook is configured correctly and can receive messages.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await testWorkflowSlack(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow Validation - Get validation status
	// =========================================================================
	server.registerTool(
		"zipfai_get_workflow_validation_status",
		{
			description:
				"Get validation status and configuration for a workflow (FREE). Shows last validation time, status, and whether validation is available.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await getWorkflowValidationStatus(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow Validation - Run validation
	// =========================================================================
	server.registerTool(
		"zipfai_validate_workflow",
		{
			description:
				"Run URL validation on a workflow (FREE). Checks URL reachability, detects redirects, suggests corrections for typos (www1→www, .cpm→.com). Returns failed URLs, redirect chains, and correction suggestions.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				url_health_check: z
					.boolean()
					.optional()
					.describe("Check URL reachability via HEAD requests (default: true)"),
				full_validation: z
					.boolean()
					.optional()
					.describe(
						"Validate step references like depends_on, urls_from_step (default: true)",
					),
				force: z
					.boolean()
					.optional()
					.describe("Re-validate even if recently validated (default: false)"),
			},
		},
		async ({ workflow_id, url_health_check, full_validation, force }) => {
			try {
				const result = await validateWorkflow(workflow_id, {
					url_health_check,
					full_validation,
					force,
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
	// Workflow Recovery - Get suggestions
	// =========================================================================
	server.registerTool(
		"zipfai_get_workflow_recovery_suggestions",
		{
			description:
				"Get pending recovery suggestions for a workflow (FREE). Shows URL corrections discovered after 404 failures, including replacement URLs found via search.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
			},
		},
		async ({ workflow_id }) => {
			try {
				const result = await getWorkflowRecoverySuggestions(workflow_id);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Workflow Recovery - Apply suggestions
	// =========================================================================
	server.registerTool(
		"zipfai_apply_workflow_recovery",
		{
			description:
				"Apply or reject recovery suggestions for a workflow (FREE). Updates workflow URLs with corrections and optionally triggers step retry.",
			inputSchema: {
				workflow_id: z.string().describe("Workflow ID"),
				suggestion_ids: z
					.array(z.string())
					.optional()
					.describe("Specific suggestion IDs to apply"),
				apply_all: z
					.boolean()
					.optional()
					.describe("Apply all pending suggestions (default: false)"),
				reject_all: z
					.boolean()
					.optional()
					.describe("Reject all pending suggestions (default: false)"),
				reject_reason: z.string().optional().describe("Reason for rejection"),
				retry_steps: z
					.boolean()
					.optional()
					.describe(
						"Mark affected steps for retry after applying (default: true)",
					),
			},
		},
		async ({
			workflow_id,
			suggestion_ids,
			apply_all,
			reject_all,
			reject_reason,
			retry_steps,
		}) => {
			try {
				const result = await applyWorkflowRecovery(workflow_id, {
					suggestion_ids,
					apply_all,
					reject_all,
					reject_reason,
					retry_steps,
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
	// Entity Schema APIs
	// =========================================================================

	server.registerTool(
		"zipfai_list_entity_schemas",
		{
			description:
				"List all entity schemas (FREE). Entity schemas define the structure of tracked items like job postings, products, or companies.",
			inputSchema: {},
		},
		async () => {
			try {
				const result = await listEntitySchemas();
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_create_entity_schema",
		{
			description:
				"Create a new entity schema (FREE). Define the structure for tracking entities like job postings, products, or companies with automatic deduplication and lifecycle management.",
			inputSchema: {
				name: z
					.string()
					.describe(
						"Unique identifier for the schema (snake_case, e.g., 'job_posting')",
					),
				display_name: z
					.string()
					.optional()
					.describe("Human-readable name (e.g., 'Job Posting')"),
				description: z.string().optional().describe("Schema description"),
				dedup_key: z
					.array(z.string())
					.describe(
						"Array of field names used for deduplication (e.g., ['company', 'title', 'location'])",
					),
				fields: z
					.record(
						z.object({
							type: z
								.enum([
									"string",
									"number",
									"boolean",
									"date",
									"array",
									"object",
									"url",
									"email",
								])
								.describe("Field type"),
							description: z.string().optional().describe("Field description"),
							required: z.boolean().optional().describe("Whether the field is required"),
							default_value: z.unknown().optional().describe("Default value"),
						}),
					)
					.describe(
						"Field definitions mapping field names to their configurations",
					),
				stale_after_days: z
					.number()
					.optional()
					.describe("Mark entities as stale after N days without being seen"),
				auto_close_after_days: z
					.number()
					.optional()
					.describe("Auto-close entities after N days stale"),
			},
		},
		async ({
			name,
			display_name,
			description,
			dedup_key,
			fields,
			stale_after_days,
			auto_close_after_days,
		}) => {
			try {
				const lifecycle_config =
					stale_after_days || auto_close_after_days
						? {
								track_first_seen: true,
								track_last_seen: true,
								stale_after_days,
								auto_close_after_days,
						  }
						: undefined;

				const result = await createEntitySchema({
					name,
					display_name,
					description,
					dedup_key,
					fields,
					lifecycle_config,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_get_entity_schema",
		{
			description: "Get entity schema details by name (FREE).",
			inputSchema: {
				schema_name: z.string().describe("Schema name (e.g., 'job_posting')"),
			},
		},
		async ({ schema_name }) => {
			try {
				const result = await getEntitySchema(schema_name);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_delete_entity_schema",
		{
			description:
				"Delete an entity schema and all associated entities (FREE). WARNING: This permanently deletes all entities in this schema.",
			inputSchema: {
				schema_name: z.string().describe("Schema name to delete"),
			},
		},
		async ({ schema_name }) => {
			try {
				const result = await deleteEntitySchema(schema_name);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	// =========================================================================
	// Entity APIs
	// =========================================================================

	server.registerTool(
		"zipfai_list_entities",
		{
			description:
				"List entities in a schema (FREE). Filter by status, sort by various fields.",
			inputSchema: {
				schema_name: z.string().describe("Schema name (e.g., 'job_posting')"),
				status: z
					.enum(["active", "stale", "closed"])
					.optional()
					.describe("Filter by entity status"),
				limit: z
					.number()
					.optional()
					.describe("Number of results, 1-100 (default: 20)"),
				offset: z.number().optional().describe("Pagination offset"),
				sort_by: z
					.enum(["first_seen_at", "last_seen_at", "created_at", "times_seen"])
					.optional()
					.describe("Sort field"),
				sort_order: z
					.enum(["asc", "desc"])
					.optional()
					.describe("Sort order (default: desc)"),
			},
		},
		async ({ schema_name, status, limit, offset, sort_by, sort_order }) => {
			try {
				const result = await listEntities(schema_name, {
					status,
					limit,
					offset,
					sort_by,
					sort_order,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_query_entities",
		{
			description:
				"Query entities with aggregations (1 credit). Get counts, group by field, or timeline analysis.",
			inputSchema: {
				schema_name: z.string().describe("Schema name (e.g., 'job_posting')"),
				filter: z
					.record(z.unknown())
					.optional()
					.describe("Field filters as JSON object"),
				aggregations: z
					.array(
						z.object({
							type: z.enum(["count", "count_by", "timeline"]).describe("Aggregation type"),
							field: z.string().optional().describe("For count_by: field to group by"),
							interval: z.enum(["day", "week", "month"]).optional().describe("For timeline: time interval"),
							date_field: z
								.enum(["created_at", "first_seen_at", "last_seen_at"])
								.optional()
								.describe("For timeline: date field"),
							days_back: z.number().optional().describe("For timeline: days to look back (default: 30)"),
						}),
					)
					.optional()
					.describe("Array of aggregation requests"),
				limit: z.number().optional().describe("Number of results (default: 20)"),
				offset: z.number().optional().describe("Pagination offset"),
			},
		},
		async ({
			schema_name,
			filter,
			aggregations,
			limit,
			offset,
		}) => {
			try {
				const result = await queryEntities(schema_name, {
					filter,
					aggregations,
					limit,
					offset,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_get_entity",
		{
			description: "Get a specific entity by ID (FREE).",
			inputSchema: {
				schema_name: z.string().describe("Schema name"),
				entity_id: z.string().describe("Entity ID"),
			},
		},
		async ({ schema_name, entity_id }) => {
			try {
				const result = await getEntity(schema_name, entity_id);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_update_entity",
		{
			description: "Update entity data or status (FREE).",
			inputSchema: {
				schema_name: z.string().describe("Schema name"),
				entity_id: z.string().describe("Entity ID"),
				data: z
					.record(z.unknown())
					.optional()
					.describe("Updated field values (merged with existing)"),
				status: z
					.enum(["active", "stale", "closed"])
					.optional()
					.describe("New entity status"),
			},
		},
		async ({ schema_name, entity_id, data, status }) => {
			try {
				const result = await updateEntity(schema_name, entity_id, {
					data,
					status,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_export_entities",
		{
			description: "Export entities as JSON or CSV (1 credit).",
			inputSchema: {
				schema_name: z.string().describe("Schema name"),
				format: z
					.enum(["json", "csv"])
					.optional()
					.describe("Export format (default: json)"),
				status: z
					.enum(["active", "stale", "closed"])
					.optional()
					.describe("Filter by status"),
				limit: z
					.number()
					.optional()
					.describe("Max entities to export (default: 1000, max: 10000)"),
				fields: z
					.array(z.string())
					.optional()
					.describe("Specific data fields to include"),
			},
		},
		async ({ schema_name, format, status, limit, fields }) => {
			try {
				const result = await exportEntities(schema_name, {
					format,
					status,
					limit,
					fields,
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
	// Entity Signal APIs
	// =========================================================================

	server.registerTool(
		"zipfai_list_entity_signals",
		{
			description:
				"List all entity signals (FREE). Signals are alerting rules that trigger on entity changes.",
			inputSchema: {
				schema_id: z.string().optional().describe("Filter by schema ID"),
				is_active: z.boolean().optional().describe("Filter by active status"),
			},
		},
		async ({ schema_id, is_active }) => {
			try {
				const result = await listEntitySignals({
					schema_id,
					is_active,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_create_entity_signal",
		{
			description:
				"Create an entity signal for alerting (FREE). Signals trigger actions when conditions are met on entities.",
			inputSchema: {
				schema_id: z.string().describe("Entity schema ID"),
				name: z.string().describe("Signal name"),
				description: z.string().optional().describe("Signal description"),
				condition_type: z
					.enum([
						"new_entity",
						"entity_closed",
						"entity_updated",
						"field_value",
						"population_change",
						"threshold",
						"custom",
					])
					.describe("Type of condition that triggers the signal"),
				condition_field: z
					.string()
					.optional()
					.describe("Field to evaluate (for field_value conditions)"),
				condition_operator: z
					.enum(["=", "!=", ">", "<", ">=", "<=", "contains", "matches"])
					.optional()
					.describe("Comparison operator"),
				condition_value: z
					.unknown()
					.optional()
					.describe("Value to compare against"),
				condition_threshold: z
					.number()
					.optional()
					.describe("Threshold for population_change/threshold conditions"),
				condition_natural_language: z
					.string()
					.optional()
					.describe("For custom type: LLM-evaluated condition"),
				actions: z
					.array(
						z.object({
							type: z.enum(["email", "webhook", "slack", "log"]).describe("Action type"),
							config: z.record(z.unknown()).describe("Action configuration (recipients, url, channel, etc.)"),
						}),
					)
					.describe("Actions to execute when triggered"),
			},
		},
		async ({
			schema_id,
			name,
			description,
			condition_type,
			condition_field,
			condition_operator,
			condition_value,
			condition_threshold,
			condition_natural_language,
			actions,
		}) => {
			try {
				// Build condition config with proper type
				const condition: {
					type:
						| "new_entity"
						| "entity_closed"
						| "entity_updated"
						| "field_value"
						| "population_change"
						| "threshold"
						| "custom";
					field?: string;
					operator?: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "matches";
					value?: unknown;
					threshold?: number;
					natural_language?: string;
				} = { type: condition_type };
				if (condition_field) condition.field = condition_field;
				if (condition_operator) condition.operator = condition_operator;
				if (condition_value !== undefined) condition.value = condition_value;
				if (condition_threshold !== undefined)
					condition.threshold = condition_threshold;
				if (condition_natural_language)
					condition.natural_language = condition_natural_language;

				const result = await createEntitySignal({
					schema_id,
					name,
					description,
					condition_config: condition,
					actions_config: actions,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_get_entity_signal",
		{
			description: "Get entity signal details (FREE).",
			inputSchema: {
				signal_id: z.string().describe("Signal ID"),
			},
		},
		async ({ signal_id }) => {
			try {
				const result = await getEntitySignal(signal_id);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_update_entity_signal",
		{
			description: "Update entity signal configuration (FREE).",
			inputSchema: {
				signal_id: z.string().describe("Signal ID"),
				name: z.string().optional().describe("New signal name"),
				description: z.string().optional().describe("New description"),
				is_active: z.boolean().optional().describe("Enable or disable the signal"),
			},
		},
		async ({ signal_id, name, description, is_active }) => {
			try {
				const result = await updateEntitySignal(signal_id, {
					name,
					description,
					is_active,
				});
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);

	server.registerTool(
		"zipfai_delete_entity_signal",
		{
			description: "Delete an entity signal (FREE).",
			inputSchema: {
				signal_id: z.string().describe("Signal ID to delete"),
			},
		},
		async ({ signal_id }) => {
			try {
				const result = await deleteEntitySignal(signal_id);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return formatError(error);
			}
		},
	);
}
