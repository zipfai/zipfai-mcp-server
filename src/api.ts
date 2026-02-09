import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
	AssessIntentResponse,
	AskResponse,
	CrawlResponse,
	CreateEntitySchemaResponse,
	CreateEntitySignalResponse,
	CreateSessionResponse,
	CreateWorkflowResponse,
	EmailConfig,
	Entity,
	EntityLifecycleConfig,
	EntitySchema,
	EntitySignal,
	EntityStatus,
	FeedbackImpactResponse,
	FeedbackQueueResponse,
	ExecutionFeedbackBatchResponse,
	ExecutionFeedbackExecutionKind,
	ExecutionFeedbackListResponse,
	ExecutionFeedbackRating,
	ExecutionFeedbackReasonCategory,
	ExecutionFeedbackResponse,
	ExecutionFeedbackStatsResponse,
	ExecutionDiff,
	ExportEntitiesResponse,
	ListEntitiesResponse,
	ListEntitySchemasResponse,
	ListEntitySignalsResponse,
	ListWorkflowsResponse,
	PlanWorkflowResponse,
	QueryEntitiesResponse,
	QuickSearchResponse,
	ResearchResponse,
	SearchJobResponse,
	Session,
	SessionTimelineResponse,
	SignalAction,
	SignalCondition,
	SlackConfig,
	StatusResponse,
	SuggestSchemaResponse,
	Workflow,
	WorkflowDetailsResponse,
	WorkflowDiffResponse,
	WorkflowDigest,
	WorkflowStep,
	WorkflowStopCondition,
	WorkflowTimelineResponse,
	WorkflowUpdatesDigestResponse,
} from "./types.js";

const ZIPF_API_BASE = "https://www.zipf.ai/api/v1";

// Custom error class for API errors
export class ApiError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public details?: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

// Helper to handle API responses with proper error checking
async function handleResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let errorMessage = `API request failed with status ${response.status}`;
		let details: string | undefined;

		try {
			const errorBody = await response.json();
			if (errorBody.error) {
				errorMessage = errorBody.error;
			} else if (errorBody.message) {
				errorMessage = errorBody.message;
			}
			details = JSON.stringify(errorBody);
		} catch {
			// Response wasn't JSON, use status text
			errorMessage = `${response.status} ${response.statusText}`;
		}

		throw new ApiError(errorMessage, response.status, details);
	}

	return (await response.json()) as T;
}

function getApiKey(): string {
	// First try env var (check for non-empty string)
	if (process.env.ZIPF_API_KEY && process.env.ZIPF_API_KEY.trim() !== "") {
		return process.env.ZIPF_API_KEY;
	}

	// Fall back to config file
	const configFile = resolve(homedir(), ".zipfai", "config.json");
	if (existsSync(configFile)) {
		try {
			const config = JSON.parse(readFileSync(configFile, "utf-8"));
			if (config.apiKey) {
				return config.apiKey;
			}
		} catch {
			// Ignore parse errors
		}
	}

	throw new Error(
		"ZIPF_API_KEY not found. Set it as an environment variable or run: npx zipfai-mcp-server install --api-key=<key>",
	);
}

function getHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${getApiKey()}`,
		...(extraHeaders || {}),
	};
}

// Helper to wait
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Default polling configuration
const DEFAULT_POLL_CONFIG = {
	initialInterval: 500, // Start with 500ms
	maxInterval: 4000, // Cap at 4 seconds
	backoffMultiplier: 1.5, // Increase by 50% each time
	maxDuration: 60000, // 60 seconds total timeout
};

// Default timeout for individual fetch requests (in ms)
const DEFAULT_FETCH_TIMEOUT = 30000; // 30 seconds

// Helper to create AbortSignal with timeout
function createTimeoutSignal(timeoutMs: number): AbortSignal {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), timeoutMs);
	return controller.signal;
}

// =========================================================================
// Search API
// =========================================================================

// Quick Search - lightweight, fast (uses standard search endpoint with no AI features)
export async function quickSearch(params: {
	query: string;
	max_results?: number;
}): Promise<QuickSearchResponse> {
	// Use the standard /search endpoint with all AI features disabled
	// This provides the same functionality as the deprecated /search/quick endpoint
	const response = await fetch(`${ZIPF_API_BASE}/search`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			query: params.query,
			max_results: params.max_results ?? 10,
			// Disable all AI features for basic 1-credit search
			interpret_query: false,
			rerank_results: false,
			extract_metadata: false,
			generate_suggestions: false,
			generate_summary: false,
		}),
	});
	return handleResponse<QuickSearchResponse>(response);
}

// Full Search - with AI enhancements and query decomposition
async function search(params: {
	query: string;
	max_results?: number;
	interpret_query?: boolean;
	extract_metadata?: boolean;
	rerank_results?: boolean;
	generate_suggestions?: boolean;
	suggestions_top_n?: number;
	num_suggestions?: number;
	generate_summary?: boolean;
	// Query decomposition parameters
	query_decomposition?: boolean;
	max_sub_queries?: number;
	max_results_per_sub_query?: number;
	source_type?: "academic" | "commercial" | "news" | "community" | "mixed";
	// Date range filter
	freshness?: "day" | "week" | "month" | "year";
	// Session context
	session_id?: string;
	filter_seen_urls?: boolean;
}): Promise<SearchJobResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/search`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			query: params.query,
			max_results: params.max_results ?? 10,
			interpret_query: params.interpret_query ?? false,
			extract_metadata: params.extract_metadata ?? false,
			rerank_results: params.rerank_results ?? false,
			generate_suggestions: params.generate_suggestions ?? false,
			suggestions_top_n: params.suggestions_top_n,
			num_suggestions: params.num_suggestions,
			generate_summary: params.generate_summary ?? false,
			// Query decomposition
			query_decomposition: params.query_decomposition ?? false,
			max_sub_queries: params.max_sub_queries,
			max_results_per_sub_query: params.max_results_per_sub_query,
			source_type: params.source_type,
			// Date range filter
			freshness: params.freshness,
			// Session context
			session_id: params.session_id,
			filter_seen_urls: params.filter_seen_urls,
		}),
	});
	return handleResponse<SearchJobResponse>(response);
}

// Get Search Job - used internally for polling
// Returns null on transient errors to allow polling to continue
async function getSearchJob(jobId: string): Promise<SearchJobResponse | null> {
	try {
		const response = await fetch(`${ZIPF_API_BASE}/search/jobs/${jobId}`, {
			method: "GET",
			headers: getHeaders(),
		});

		if (!response.ok) {
			// Log but don't throw - allow polling to continue on transient errors
			console.error(
				`Get search job failed: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		return (await response.json()) as SearchJobResponse;
	} catch (error) {
		// Network errors during polling shouldn't abort the whole operation
		console.error("Get search job error:", error);
		return null;
	}
}

// Full Search with internal polling for async features
export async function searchWithPolling(params: {
	query: string;
	max_results?: number;
	interpret_query?: boolean;
	extract_metadata?: boolean;
	rerank_results?: boolean;
	generate_suggestions?: boolean;
	suggestions_top_n?: number;
	num_suggestions?: number;
	generate_summary?: boolean;
	// Query decomposition parameters
	query_decomposition?: boolean;
	max_sub_queries?: number;
	max_results_per_sub_query?: number;
	source_type?: "academic" | "commercial" | "news" | "community" | "mixed";
	// Date range filter
	freshness?: "day" | "week" | "month" | "year";
	// Session context
	session_id?: string;
	filter_seen_urls?: boolean;
	// Timeout configuration
	timeout_ms?: number;
}): Promise<SearchJobResponse> {
	// Initial search request
	const initialResult = await search(params);

	const needsPolling = params.generate_summary || params.extract_metadata;

	if (!needsPolling) {
		return initialResult;
	}

	// Use custom timeout or default
	const maxDuration = params.timeout_ms ?? DEFAULT_POLL_CONFIG.maxDuration;

	// Poll for async results (summary, metadata) with exponential backoff
	const jobId = initialResult.search_job_id;
	const startTime = Date.now();
	let currentInterval = DEFAULT_POLL_CONFIG.initialInterval;
	let lastSuccessfulJob: SearchJobResponse = initialResult;

	while (Date.now() - startTime < maxDuration) {
		await sleep(currentInterval);

		const job = await getSearchJob(jobId);

		if (job) {
			lastSuccessfulJob = job;

			// Check if job failed entirely
			if (job.status === "failed") {
				throw new ApiError(
					`Search job failed: ${job.search_job_id}`,
					undefined,
					JSON.stringify(job),
				);
			}

			// Check if async features are complete
			// Summary can be: null, string (legacy), or { status: string, content?: string }
			let summaryDone = !params.generate_summary;
			if (params.generate_summary && job.summary) {
				if (typeof job.summary === "string") {
					// Legacy string format - summary is complete
					summaryDone = true;
				} else if (typeof job.summary === "object") {
					// Object format with status field
					summaryDone =
						job.summary.status === "completed" ||
						job.summary.status === "failed";
				}
			}

			const metadataDone =
				!params.extract_metadata ||
				job.query_interpretation?.metadata_status === "completed" ||
				job.query_interpretation?.metadata_status === "failed";

			if (summaryDone && metadataDone) {
				return job;
			}
		}

		// Exponential backoff with cap
		currentInterval = Math.min(
			currentInterval * DEFAULT_POLL_CONFIG.backoffMultiplier,
			DEFAULT_POLL_CONFIG.maxInterval,
		);
	}

	// Timeout - return the last successful response we got
	console.error(
		`Polling timeout after ${maxDuration}ms, returning partial results`,
	);
	return lastSuccessfulJob;
}

// =========================================================================
// Ask API - Direct question answering
// =========================================================================

export async function ask(params: {
	question: string;
	depth?: "quick" | "standard" | "deep";
	max_sources?: number;
	// Additional parameters
	include_follow_ups?: boolean;
	response_style?: "concise" | "detailed";
	session_id?: string;
	skip_rerank?: boolean;
	enable_query_rewrite?: boolean;
	enable_decomposition?: boolean;
	max_sub_queries?: number;
}): Promise<AskResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/ask`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			question: params.question,
			depth: params.depth ?? "standard",
			max_sources: params.max_sources ?? 10,
			include_follow_ups: params.include_follow_ups,
			response_style: params.response_style,
			session_id: params.session_id,
			skip_rerank: params.skip_rerank,
			enable_query_rewrite: params.enable_query_rewrite,
			enable_decomposition: params.enable_decomposition,
			max_sub_queries: params.max_sub_queries,
		}),
	});
	return handleResponse<AskResponse>(response);
}

// =========================================================================
// Crawl API - Web crawling with extraction
// =========================================================================

export async function crawl(params: {
	urls: string[];
	max_pages?: number;
	extraction_schema?: Record<string, string>;
	classify_documents?: boolean;
	generate_summary?: boolean;
	processing_mode?: "sync" | "async" | "webhook";
	webhook_url?: string;
	// Link following
	expansion?: "internal" | "external" | "both" | "none";
	follow_links?: boolean;
	link_extraction_config?: {
		max_depth?: number;
		url_patterns?: string[];
		exclude_patterns?: string[];
		detect_pagination?: boolean;
	};
	// Caching
	use_cache?: boolean;
	cache_max_age?: number;
	// Budget control
	budget_config?: {
		max_pages?: number;
		max_depth?: number;
		max_credits?: number;
	};
	// Classifiers
	classifiers?: Array<{
		type: "url" | "content";
		question: string;
		confidence_threshold?: number;
	}>;
	// Dry run
	dry_run?: boolean;
	// Session context
	session_id?: string;
	filter_seen_urls?: boolean;
}): Promise<CrawlResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/crawls`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			urls: params.urls,
			max_pages: params.max_pages ?? 10,
			extraction_schema: params.extraction_schema,
			classify_documents: params.classify_documents ?? true,
			generate_summary: params.generate_summary ?? false,
			processing_mode: params.processing_mode ?? "sync",
			webhook_url: params.webhook_url,
			expansion: params.expansion,
			follow_links: params.follow_links,
			link_extraction_config: params.link_extraction_config,
			use_cache: params.use_cache,
			cache_max_age: params.cache_max_age,
			budget_config: params.budget_config,
			classifiers: params.classifiers,
			dry_run: params.dry_run,
			session_id: params.session_id,
			filter_seen_urls: params.filter_seen_urls,
		}),
	});
	return handleResponse<CrawlResponse>(response);
}

// Get Crawl Job status
export async function getCrawl(crawlId: string): Promise<CrawlResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/crawls/${crawlId}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<CrawlResponse>(response);
}

// Crawl with polling for async mode
export async function crawlWithPolling(params: {
	urls: string[];
	max_pages?: number;
	extraction_schema?: Record<string, string>;
	classify_documents?: boolean;
	generate_summary?: boolean;
	expansion?: "internal" | "external" | "both" | "none";
	follow_links?: boolean;
	link_extraction_config?: {
		max_depth?: number;
		url_patterns?: string[];
		exclude_patterns?: string[];
		detect_pagination?: boolean;
	};
	use_cache?: boolean;
	cache_max_age?: number;
	dry_run?: boolean;
	session_id?: string;
	filter_seen_urls?: boolean;
}): Promise<CrawlResponse> {
	// Use sync mode for simplicity - waits for completion
	return crawl({ ...params, processing_mode: "sync" });
}

// Suggest extraction schema for a URL
export async function suggestSchema(params: {
	url: string;
}): Promise<SuggestSchemaResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/crawls/suggest-schema`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			url: params.url,
		}),
	});
	return handleResponse<SuggestSchemaResponse>(response);
}

// =========================================================================
// Sessions API - Multi-step research workflows
// =========================================================================

export async function createSession(params: {
	name: string;
	description?: string;
	intent_context?: string;
	session_config?: {
		auto_deduplicate?: boolean;
		accumulate_context?: boolean;
		use_session_context?: boolean;
		max_operations?: number;
	};
	metadata?: Record<string, unknown>;
}): Promise<CreateSessionResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/sessions`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			name: params.name,
			description: params.description,
			intent_context: params.intent_context,
			session_config: params.session_config ?? {
				auto_deduplicate: true,
				accumulate_context: true,
				use_session_context: true,
			},
			metadata: params.metadata,
		}),
	});
	return handleResponse<CreateSessionResponse>(response);
}

export async function getSession(
	sessionId: string,
): Promise<{ session: Session }> {
	const response = await fetch(`${ZIPF_API_BASE}/sessions/${sessionId}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<{ session: Session }>(response);
}

export async function getSessionTimeline(
	sessionId: string,
): Promise<SessionTimelineResponse> {
	const response = await fetch(
		`${ZIPF_API_BASE}/sessions/${sessionId}/timeline`,
		{
			method: "GET",
			headers: getHeaders(),
		},
	);
	return handleResponse<SessionTimelineResponse>(response);
}

export async function completeSession(
	sessionId: string,
): Promise<{ session: Session }> {
	const response = await fetch(
		`${ZIPF_API_BASE}/sessions/${sessionId}/complete`,
		{
			method: "POST",
			headers: getHeaders(),
		},
	);
	return handleResponse<{ session: Session }>(response);
}

// Session search - search within a session context
export async function sessionSearch(
	sessionId: string,
	params: {
		query: string;
		max_results?: number;
		filter_seen_urls?: boolean;
		interpret_query?: boolean;
		rerank_results?: boolean;
		generate_summary?: boolean;
		query_decomposition?: boolean;
		max_sub_queries?: number;
		freshness?: "day" | "week" | "month" | "year";
	},
): Promise<SearchJobResponse> {
	const response = await fetch(
		`${ZIPF_API_BASE}/sessions/${sessionId}/search`,
		{
			method: "POST",
			headers: getHeaders(),
			body: JSON.stringify({
				query: params.query,
				max_results: params.max_results ?? 10,
				filter_seen_urls: params.filter_seen_urls ?? true,
				interpret_query: params.interpret_query ?? false,
				rerank_results: params.rerank_results ?? false,
				generate_summary: params.generate_summary ?? false,
				query_decomposition: params.query_decomposition ?? false,
				max_sub_queries: params.max_sub_queries,
				freshness: params.freshness,
			}),
		},
	);
	return handleResponse<SearchJobResponse>(response);
}

// Session crawl - crawl within a session context
export async function sessionCrawl(
	sessionId: string,
	params: {
		urls: string[];
		max_pages?: number;
		filter_seen_urls?: boolean;
		extraction_schema?: Record<string, string>;
		classify_documents?: boolean;
		generate_summary?: boolean;
		expansion?: "internal" | "external" | "both" | "none";
	},
): Promise<CrawlResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/sessions/${sessionId}/crawl`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			urls: params.urls,
			max_pages: params.max_pages ?? 10,
			filter_seen_urls: params.filter_seen_urls ?? true,
			extraction_schema: params.extraction_schema,
			classify_documents: params.classify_documents ?? true,
			generate_summary: params.generate_summary ?? false,
			expansion: params.expansion,
			processing_mode: "sync",
		}),
	});
	return handleResponse<CrawlResponse>(response);
}

// =========================================================================
// Research API - Combo search + auto-crawl
// =========================================================================

export async function research(params: {
	query: string;
	search_count?: number;
	auto_crawl_top_n?: number;
	max_pages_per_url?: number;
	extraction_schema?: Record<string, string>;
	// Additional parameters
	only_uncrawled?: boolean;
	classify_documents?: boolean;
	interpret_query?: boolean;
	rerank_results?: boolean;
	generate_suggestions?: boolean;
	session_id?: string;
}): Promise<ResearchResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/research`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			query: params.query,
			search_count: params.search_count ?? 10,
			auto_crawl_top_n: params.auto_crawl_top_n ?? 5,
			max_pages_per_url: params.max_pages_per_url ?? 1,
			extraction_schema: params.extraction_schema,
			only_uncrawled: params.only_uncrawled,
			classify_documents: params.classify_documents,
			interpret_query: params.interpret_query,
			rerank_results: params.rerank_results,
			generate_suggestions: params.generate_suggestions,
			session_id: params.session_id,
		}),
	});
	return handleResponse<ResearchResponse>(response);
}

// =========================================================================
// Workflow API - Scheduled recurring monitoring
// =========================================================================

export async function createWorkflow(params: {
	name: string;
	mode?: "simple" | "multi_step" | "ai_planned";
	workflow_type?: "search" | "crawl";
	operation_config?: Record<string, unknown>;
	steps?: WorkflowStep[];
	intent?: string;
	stop_condition: WorkflowStopCondition;
	// Schedule options (priority: scheduled_for > cron_expression > interval)
	interval?: string; // Human-readable: "6 hours", "1 day", "2 weeks"
	interval_minutes?: number; // Legacy: raw minutes (one of interval or interval_minutes required)
	cron_expression?: string; // Cron expression (5-field): "0 9 * * MON,WED,FRI"
	scheduled_for?: string; // ISO 8601 datetime for one-time run
	anchor_minute?: number; // Anchor minute (0-59) for aligned intervals
	timezone?: string; // IANA timezone (default 'UTC')
	max_executions?: number;
	max_credits_per_execution?: number;
	session_id?: string;
	// Email notification settings
	email_config?: EmailConfig;
	// Slack notification settings
	slack_config?: SlackConfig;
	// Dry run mode - preview cost without creating
	dry_run?: boolean;
	// Content recency filter confidence threshold (0-1, default 0.50)
	recency_confidence_threshold?: number;
}): Promise<CreateWorkflowResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<CreateWorkflowResponse>(response);
}

export async function listWorkflows(params?: {
	limit?: number;
	offset?: number;
	status?: "active" | "paused" | "completed" | "failed";
}): Promise<ListWorkflowsResponse> {
	const searchParams = new URLSearchParams();
	if (params?.limit) searchParams.set("limit", params.limit.toString());
	if (params?.offset) searchParams.set("offset", params.offset.toString());
	if (params?.status) searchParams.set("status", params.status);

	const response = await fetch(`${ZIPF_API_BASE}/workflows?${searchParams}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<ListWorkflowsResponse>(response);
}

export async function getWorkflow(
	workflowId: string,
): Promise<{ workflow: Workflow }> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<{ workflow: Workflow }>(response);
}

export async function getWorkflowDetails(
	workflowId: string,
): Promise<WorkflowDetailsResponse> {
	const response = await fetch(
		`${ZIPF_API_BASE}/workflows/${workflowId}/details`,
		{
			method: "GET",
			headers: getHeaders(),
		},
	);
	return handleResponse<WorkflowDetailsResponse>(response);
}

export async function updateWorkflow(
	workflowId: string,
	params: {
		name?: string;
		workflow_type?: "search" | "crawl";
		operation_config?: Record<string, unknown>;
		stop_condition?: WorkflowStopCondition;
		// Schedule options (priority: scheduled_for > cron_expression > interval)
		interval?: string; // Human-readable: "6 hours", "1 day", "2 weeks"
		interval_minutes?: number; // Legacy: raw minutes
		cron_expression?: string; // Cron expression (5-field): "0 9 * * MON,WED,FRI"
		scheduled_for?: string; // ISO 8601 datetime for one-time run
		anchor_minute?: number; // Anchor minute (0-59) for aligned intervals
		timezone?: string; // IANA timezone (default 'UTC')
		max_executions?: number;
		status?: "active" | "paused" | "completed" | "failed";
		session_id?: string | null;
		// Email notification settings (null to disable)
		email_config?: EmailConfig | null;
		// Slack notification settings (null to disable)
		slack_config?: SlackConfig | null;
		// Content recency filter confidence threshold (0-1, default 0.50)
		recency_confidence_threshold?: number;
		// Notification intelligence settings
		notification_settings?: { suppression_threshold?: number } | null;
	},
): Promise<{ workflow: Workflow }> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}`, {
		method: "PATCH",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<{ workflow: Workflow }>(response);
}

export async function executeWorkflow(
	workflowId: string,
	options?: { dry_run?: boolean },
): Promise<{
	message: string;
	execution_id?: string;
	dry_run?: boolean;
	cost_estimate?: unknown;
}> {
	const response = await fetch(
		`${ZIPF_API_BASE}/workflows/${workflowId}/execute`,
		{
			method: "POST",
			headers: getHeaders(),
			body: options?.dry_run ? JSON.stringify({ dry_run: true }) : undefined,
		},
	);
	return handleResponse<{
		message: string;
		execution_id?: string;
		dry_run?: boolean;
		cost_estimate?: unknown;
	}>(response);
}

export async function getWorkflowTimeline(
	workflowId: string,
): Promise<WorkflowTimelineResponse> {
	const response = await fetch(
		`${ZIPF_API_BASE}/workflows/${workflowId}/timeline`,
		{
			method: "GET",
			headers: getHeaders(),
		},
	);
	return handleResponse<WorkflowTimelineResponse>(response);
}

export async function getWorkflowDiff(
	workflowId: string,
	params?: {
		limit?: number;
		since?: string;
	},
): Promise<WorkflowDiffResponse> {
	const searchParams = new URLSearchParams();
	if (params?.limit) searchParams.set("limit", params.limit.toString());
	if (params?.since) searchParams.set("since", params.since);

	const response = await fetch(
		`${ZIPF_API_BASE}/workflows/${workflowId}/diff?${searchParams}`,
		{
			method: "GET",
			headers: getHeaders(),
		},
	);
	return handleResponse<WorkflowDiffResponse>(response);
}

function getExecutionFeedbackHeaders(): Record<string, string> {
	return getHeaders({
		"X-Zipf-Signal-Source": "mcp",
	});
}

export async function submitAssessments(
	workflowId: string,
	params: {
		assessments: Array<{ question_id: string; answer: string; context?: string }>;
	},
) {
	const endpoint = `/workflows/${workflowId}/assessments`;
	const url = `${ZIPF_API_BASE}${endpoint}`;
	const response = await fetch(url, {
		method: "POST",
		headers: getHeaders({ "X-Zipf-Signal-Source": "mcp" }),
		body: JSON.stringify(params),
	});
	return handleResponse(response);
}

export async function rateExecution(
	workflowId: string | undefined,
	executionId: string,
	params: {
		execution_kind?: ExecutionFeedbackExecutionKind;
		workflow_step_id?: string;
		rating: ExecutionFeedbackRating;
		reason_category?: ExecutionFeedbackReasonCategory;
		comment?: string;
		result_url?: string;
		idempotency_key?: string;
		actor_model?: string;
	},
): Promise<ExecutionFeedbackResponse> {
	const endpoint = workflowId
		? `${ZIPF_API_BASE}/workflows/${workflowId}/executions/${executionId}/feedback`
		: `${ZIPF_API_BASE}/feedback`;

	const body = workflowId ? params : { ...params, execution_id: executionId };

	const response = await fetch(
		endpoint,
		{
			method: "POST",
			headers: getExecutionFeedbackHeaders(),
			body: JSON.stringify(body),
		},
	);
	return handleResponse<ExecutionFeedbackResponse>(response);
}

export async function getExecutionRatings(
	workflowId: string,
	params?: {
		execution_id?: string;
		workflow_step_id?: string;
		signal_type?: "positive" | "negative" | "all";
		actor_type?: "human" | "api" | "mcp" | "all";
		reason_category?: ExecutionFeedbackReasonCategory | "all";
		limit?: number;
		since?: string;
		until?: string;
		cursor?: string;
	},
): Promise<ExecutionFeedbackListResponse> {
	const searchParams = new URLSearchParams();
	if (params?.execution_id)
		searchParams.set("execution_id", params.execution_id);
	if (params?.workflow_step_id)
		searchParams.set("workflow_step_id", params.workflow_step_id);
	if (params?.signal_type === "positive")
		searchParams.set("signal_type", "result_thumbs_up");
	if (params?.signal_type === "negative")
		searchParams.set("signal_type", "result_thumbs_down");
	if (params?.actor_type && params.actor_type !== "all")
		searchParams.set("actor_type", params.actor_type);
	if (params?.reason_category && params.reason_category !== "all")
		searchParams.set("reason_category", params.reason_category);
	if (params?.limit) searchParams.set("limit", params.limit.toString());
	if (params?.since) searchParams.set("since", params.since);
	if (params?.until) searchParams.set("until", params.until);
	if (params?.cursor) searchParams.set("cursor", params.cursor);

	const query = searchParams.toString();
	const response = await fetch(
		`${ZIPF_API_BASE}/workflows/${workflowId}/execution-feedback${query ? `?${query}` : ""}`,
		{
			method: "GET",
			headers: getExecutionFeedbackHeaders(),
		},
	);
	return handleResponse<ExecutionFeedbackListResponse>(response);
}

export async function getExecutionRatingStats(
	workflowId: string,
): Promise<ExecutionFeedbackStatsResponse> {
	const response = await fetch(
		`${ZIPF_API_BASE}/workflows/${workflowId}/execution-feedback/stats`,
		{
			method: "GET",
			headers: getExecutionFeedbackHeaders(),
		},
	);
	return handleResponse<ExecutionFeedbackStatsResponse>(response);
}

export async function batchRateExecutions(
	workflowId: string | undefined,
	params: {
		feedback: Array<{
			execution_id: string;
			execution_kind?: ExecutionFeedbackExecutionKind;
			workflow_step_id?: string;
			rating: ExecutionFeedbackRating;
			reason_category?: ExecutionFeedbackReasonCategory;
			comment?: string;
			result_url?: string;
			idempotency_key?: string;
		}>;
	},
): Promise<ExecutionFeedbackBatchResponse> {
	const endpoint = workflowId
		? `${ZIPF_API_BASE}/workflows/${workflowId}/execution-feedback/batch`
		: `${ZIPF_API_BASE}/feedback/batch`;

	const response = await fetch(
		endpoint,
		{
			method: "POST",
			headers: getExecutionFeedbackHeaders(),
			body: JSON.stringify(params),
		},
	);
	return handleResponse<ExecutionFeedbackBatchResponse>(response);
}

export async function getFeedbackQueue(params?: {
	workflow_id?: string;
	include_standalone?: boolean;
	limit?: number;
}): Promise<FeedbackQueueResponse> {
	const searchParams = new URLSearchParams();
	if (params?.workflow_id) searchParams.set("workflow_id", params.workflow_id);
	if (params?.include_standalone === false)
		searchParams.set("include_standalone", "false");
	if (params?.limit) searchParams.set("limit", String(params.limit));

	const query = searchParams.toString();
	const response = await fetch(
		`${ZIPF_API_BASE}/feedback/queue${query ? `?${query}` : ""}`,
		{
			method: "GET",
			headers: getExecutionFeedbackHeaders(),
		},
	);
	return handleResponse<FeedbackQueueResponse>(response);
}

export async function getFeedbackImpact(
	workflowId: string,
): Promise<FeedbackImpactResponse> {
	const response = await fetch(
		`${ZIPF_API_BASE}/workflows/${workflowId}/feedback-impact`,
		{
			method: "GET",
			headers: getExecutionFeedbackHeaders(),
		},
	);
	return handleResponse<FeedbackImpactResponse>(response);
}

export async function deleteWorkflow(
	workflowId: string,
): Promise<{ message: string }> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}`, {
		method: "DELETE",
		headers: getHeaders(),
	});
	return handleResponse<{ message: string }>(response);
}

export async function planWorkflow(params: {
	intent: string;
	name?: string;
	max_credits_per_execution?: number;
	planning_budget?: number;
	quality_mode?: "quality_first" | "balanced";
	skip_entity_discovery?: boolean;
}): Promise<PlanWorkflowResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/plan`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<PlanWorkflowResponse>(response);
}

export async function assessIntent(params: {
	intent: string;
}): Promise<AssessIntentResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/assess-intent`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<AssessIntentResponse>(response);
}

// =========================================================================
// Workflow Updates Digest - Compound tool for consolidated updates
// =========================================================================

/**
 * Helper function to generate a compact change summary from diff data
 */
function generateChangeSummary(diff: WorkflowDiffResponse): string {
	// Use stats.change_rate for quick summary if available
	if (diff.stats && diff.total_executions > 0) {
		const changeRate = diff.stats.change_rate;
		if (changeRate === 0) return "No changes detected";
	}

	// Check latest diff for detailed breakdown
	if (!diff.diffs || diff.diffs.length === 0) return "No changes";

	const latestDiff = diff.diffs[0];
	if (!latestDiff.has_changes || !latestDiff.changes?.length) {
		return "No changes detected";
	}

	// Group changes by type (changes is now an array of FieldChange objects)
	const byType: Record<string, number> = {};
	for (const change of latestDiff.changes) {
		byType[change.change_type] = (byType[change.change_type] || 0) + 1;
	}

	const parts: string[] = [];
	if (byType.added) parts.push(`+${byType.added} added`);
	if (byType.removed) parts.push(`-${byType.removed} removed`);
	if (byType.increase) parts.push(`↑${byType.increase} increased`);
	if (byType.decrease) parts.push(`↓${byType.decrease} decreased`);
	if (byType.status_change || byType.text_change) {
		const textChanges = (byType.status_change || 0) + (byType.text_change || 0);
		parts.push(`~${textChanges} modified`);
	}

	// Include human-readable summary from backend if available
	if (latestDiff.summary && parts.length === 0) {
		return latestDiff.summary;
	}

	return parts.join(", ") || "No changes";
}

/**
 * Phase 2: Signal/Noise Scoring
 * Computes a signal score (0-100) to help users identify which changes matter most.
 */
interface SignalScoringContext {
	diff: WorkflowDiffResponse;
	workflow: Workflow;
	newUrls?: Array<{ url: string; document_type?: string | null }>;
	triggeredCondition: boolean;
}

type SignalLevel = "urgent" | "notable" | "routine" | "noise";

function computeSignalScore(ctx: SignalScoringContext): {
	score: number;
	level: SignalLevel;
	reasoning: string;
} {
	let score = 50; // Baseline
	const reasons: string[] = [];

	// 1. User-defined priority from workflow config (operation_config.priority)
	const priority = ctx.workflow.operation_config?.priority as
		| string
		| undefined;
	if (priority === "high") {
		score += 25;
		reasons.push("high-priority workflow");
	} else if (priority === "low") {
		score -= 15;
		reasons.push("low-priority workflow");
	}

	// 2. Stop condition triggered or proximity
	if (ctx.triggeredCondition) {
		score += 30;
		reasons.push("stop condition triggered");
	}

	// 3. High-signal document types in new URLs
	const highSignalDocTypes = [
		"legal_regulatory",
		"academic_research",
		"news_editorial",
		"government",
	];
	const hasHighSignalDocs = ctx.newUrls?.some(
		(u) => u.document_type && highSignalDocTypes.includes(u.document_type),
	);
	if (hasHighSignalDocs) {
		score += 20;
		reasons.push("contains regulatory/academic/news content");
	}

	// 4. Penalize high churn (likely noise from search result shuffling)
	const churnRate = ctx.diff.stats?.change_rate || 0;
	if (churnRate > 50) {
		score -= 15;
		reasons.push("high churn rate");
	} else if (churnRate > 0 && churnRate <= 20) {
		// Low churn is a good signal - meaningful targeted changes
		score += 5;
	}

	// 5. New domain discovery (novel sources)
	const latestState = ctx.diff.latest?.state as
		| Record<string, unknown>
		| undefined;
	const newDomains = latestState?.new_domains_count as number | undefined;
	if (newDomains && newDomains > 0) {
		score += 10;
		reasons.push(`${newDomains} new source(s)`);
	}

	// 6. Extraction field changes (crawl workflows with data changes)
	const extractionChanges = latestState?.extraction_changes as
		| unknown[]
		| undefined;
	if (extractionChanges && extractionChanges.length > 0) {
		score += 15;
		reasons.push("extraction data changed");
	}

	// 7. Number of new URLs - many new URLs suggests significant activity
	const newUrlCount = ctx.newUrls?.length || 0;
	if (newUrlCount >= 5) {
		score += 10;
		reasons.push(`${newUrlCount} new URLs`);
	} else if (newUrlCount > 0) {
		score += 5;
	}

	// Clamp score to 0-100
	score = Math.max(0, Math.min(100, score));

	// Determine signal level
	let level: SignalLevel;
	if (score >= 80) {
		level = "urgent";
	} else if (score >= 60) {
		level = "notable";
	} else if (score >= 40) {
		level = "routine";
	} else {
		level = "noise";
	}

	return {
		score,
		level,
		reasoning: reasons.length > 0 ? reasons.join(", ") : "baseline activity",
	};
}

/**
 * Phase 3: URL normalization for accurate correlation
 * Handles http/https, trailing slashes, and common tracking params
 */
function normalizeUrl(url: string): string {
	try {
		const u = new URL(url);
		u.protocol = "https:"; // Normalize http → https
		u.hash = ""; // Remove fragments

		// Remove common tracking params
		const trackingParams = [
			"utm_source",
			"utm_medium",
			"utm_campaign",
			"utm_term",
			"utm_content",
			"ref",
			"source",
			"fbclid",
			"gclid",
			"mc_cid",
			"mc_eid",
		];
		trackingParams.forEach((p) => u.searchParams.delete(p));

		// Normalize trailing slash (remove unless it's just "/")
		if (u.pathname.endsWith("/") && u.pathname !== "/") {
			u.pathname = u.pathname.slice(0, -1);
		}

		return u.toString();
	} catch {
		return url;
	}
}

/**
 * Phase 3: Cross-workflow correlation
 * Finds URLs that appear in multiple workflows
 */
const MAX_WORKFLOWS_FOR_CORRELATION = 15;

interface CrossWorkflowCorrelation {
	type: "shared_url" | "shared_topic" | "shared_entity";
	value: string;
	workflows: {
		workflow_id: string;
		workflow_name: string;
		context: string;
	}[];
	insight: string;
}

function findCorrelations(digests: WorkflowDigest[]): {
	correlations: CrossWorkflowCorrelation[];
	metadata: {
		workflows_analyzed: number;
		workflows_skipped: number;
		total_urls_compared: number;
	};
} {
	// Rate limit: only analyze workflows with changes and new_urls
	const eligibleDigests = digests
		.filter((d) => d.has_changes && d.new_urls && d.new_urls.length > 0)
		.slice(0, MAX_WORKFLOWS_FOR_CORRELATION);

	const workflowsSkipped = Math.max(
		0,
		digests.filter((d) => d.has_changes && d.new_urls && d.new_urls.length > 0)
			.length - MAX_WORKFLOWS_FOR_CORRELATION,
	);

	// If less than 2 eligible workflows, no correlation possible
	if (eligibleDigests.length < 2) {
		return {
			correlations: [],
			metadata: {
				workflows_analyzed: eligibleDigests.length,
				workflows_skipped: workflowsSkipped,
				total_urls_compared: eligibleDigests.reduce(
					(sum, d) => sum + (d.new_urls?.length || 0),
					0,
				),
			},
		};
	}

	// Build URL → workflow mapping
	const urlToWorkflows = new Map<
		string,
		{
			digest: WorkflowDigest;
			urlObj: { url: string; snippet?: string | null };
		}[]
	>();

	let totalUrlsCompared = 0;

	for (const digest of eligibleDigests) {
		for (const urlObj of digest.new_urls || []) {
			totalUrlsCompared++;
			const normalizedUrl = normalizeUrl(urlObj.url);
			const existing = urlToWorkflows.get(normalizedUrl) || [];
			existing.push({ digest, urlObj });
			urlToWorkflows.set(normalizedUrl, existing);
		}
	}

	// Find URLs appearing in 2+ workflows
	const correlations: CrossWorkflowCorrelation[] = [];

	for (const [url, workflowList] of urlToWorkflows) {
		if (workflowList.length >= 2) {
			const workflowNames = workflowList.map((w) => w.digest.workflow_name);
			correlations.push({
				type: "shared_url",
				value: url,
				workflows: workflowList.map((w) => ({
					workflow_id: w.digest.workflow_id,
					workflow_name: w.digest.workflow_name,
					context: w.urlObj.snippet || "",
				})),
				insight: `Appears in ${workflowList.length} monitors: ${workflowNames.join(", ")}`,
			});
		}
	}

	// Sort by number of workflows (most shared first)
	correlations.sort((a, b) => b.workflows.length - a.workflows.length);

	return {
		correlations,
		metadata: {
			workflows_analyzed: eligibleDigests.length,
			workflows_skipped: workflowsSkipped,
			total_urls_compared: totalUrlsCompared,
		},
	};
}

/**
 * Get a consolidated digest of all workflow updates since a given timestamp.
 * This is a compound tool that aggregates list → timeline → diff for all workflows.
 */
export async function getWorkflowUpdatesDigest(params?: {
	since?: string;
	include_inactive?: boolean;
	max_workflows?: number;
	verbose?: boolean;
	format?: "json" | "briefing" | "briefing_llm" | "compact";
}): Promise<WorkflowUpdatesDigestResponse> {
	const since =
		params?.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const includeInactive = params?.include_inactive ?? false;
	const maxWorkflows = Math.min(params?.max_workflows ?? 20, 50);
	const verbose = params?.verbose ?? false;
	const format = params?.format ?? "json";

	// Step 1: List all workflows
	const workflows = await listWorkflows({
		limit: maxWorkflows,
		status: includeInactive ? undefined : "active",
	});

	if (!workflows.workflows || workflows.workflows.length === 0) {
		return {
			summary: "No workflows found.",
			since: since,
			checked_at: new Date().toISOString(),
			total_workflows: 0,
			workflows_with_changes: 0,
			triggered_workflows: 0,
			total_executions_since: 0,
			workflows: [],
		};
	}

	// Step 2: Fetch timeline and diff for each workflow in parallel
	const workflowDigests = await Promise.all(
		workflows.workflows.map(async (workflow): Promise<WorkflowDigest> => {
			try {
				// Fetch timeline (last few executions)
				const timeline = await getWorkflowTimeline(workflow.id);

				// Fetch diff since timestamp
				const diff = await getWorkflowDiff(workflow.id, {
					since: since,
					limit: verbose ? 10 : 3,
				});

				// Find executions since the timestamp
				const recentExecutions =
					timeline.executions?.filter((exec) => {
						const execTime = exec.completed_at || exec.started_at;
						return (
							execTime &&
							new Date(execTime).getTime() > new Date(since).getTime()
						);
					}) || [];

				const hasChanges =
					diff.diffs &&
					diff.diffs.length > 0 &&
					diff.diffs.some((d) => d.has_changes);
				const triggeredCondition =
					workflow.status === "completed" &&
					workflow.last_execution_at !== undefined &&
					new Date(workflow.last_execution_at).getTime() >
						new Date(since).getTime();

				const digest: WorkflowDigest = {
					workflow_id: workflow.id,
					workflow_name: workflow.name,
					workflow_type: workflow.workflow_type,
					workflow_mode: workflow.mode,
					status: workflow.status,

					// Activity summary
					has_changes: hasChanges,
					triggered_condition: triggeredCondition,
					executions_since: recentExecutions.length,
					last_execution_at: workflow.last_execution_at,
					next_execution_at: workflow.next_execution_at,

					// Change summary (compact)
					change_summary: hasChanges
						? generateChangeSummary(diff)
						: "No changes detected",

					// Stats from diff API
					change_rate: diff.stats?.change_rate,
				};

				// Phase 1: Extract enriched new_urls from latest state
				// Handle backward compatibility with string URLs from old executions
				const latestState = diff.latest?.state as
					| Record<string, unknown>
					| undefined;
				if (
					latestState?.net_new_urls &&
					Array.isArray(latestState.net_new_urls)
				) {
					digest.new_urls = latestState.net_new_urls.map((u: unknown) =>
						typeof u === "string"
							? { url: u } // Backward compatibility: string → object
							: (u as {
									url: string;
									title?: string;
									snippet?: string;
									published_date?: string;
									document_type?: string;
								}),
					);
				}

				// Phase 2: Compute signal score for this workflow
				const signalResult = computeSignalScore({
					diff,
					workflow,
					newUrls: digest.new_urls,
					triggeredCondition,
				});
				digest.signal_score = signalResult.score;
				digest.signal_level = signalResult.level;
				digest.signal_reasoning = signalResult.reasoning;

				// Add verbose details if requested
				if (verbose) {
					digest.recent_diffs = diff.diffs?.slice(0, 3);
					digest.recent_executions = recentExecutions.slice(0, 3);
					if (diff.latest?.state) {
						digest.latest_state = diff.latest.state;
					}
				}

				return digest;
			} catch (error) {
				// If individual workflow fails, include error but don't fail entire digest
				return {
					workflow_id: workflow.id,
					workflow_name: workflow.name,
					status: workflow.status,
					error:
						error instanceof Error ? error.message : "Failed to fetch updates",
					has_changes: false,
					triggered_condition: false,
					executions_since: 0,
					change_summary: "Error fetching updates",
				};
			}
		}),
	);

	// Step 3: Sort by signal_score (highest first), then by executions
	// Phase 2: Signal scoring enables smarter sorting
	const sortedDigests = workflowDigests.sort((a, b) => {
		// Primary sort: signal_score (higher = more important)
		const scoreA = a.signal_score ?? 50;
		const scoreB = b.signal_score ?? 50;
		if (scoreA !== scoreB) return scoreB - scoreA;
		// Secondary sort: more recent executions first
		return (b.executions_since || 0) - (a.executions_since || 0);
	});

	// Phase 3: Find cross-workflow correlations
	const { correlations, metadata: correlationMetadata } =
		findCorrelations(sortedDigests);

	// Step 4: Generate top-level summary
	const workflowsWithChanges = sortedDigests.filter(
		(w) => w.has_changes,
	).length;
	const triggeredWorkflowsList = sortedDigests.filter(
		(w) => w.triggered_condition,
	);
	const totalExecutions = sortedDigests.reduce(
		(sum, w) => sum + (w.executions_since || 0),
		0,
	);

	let summary = "";
	if (triggeredWorkflowsList.length > 0) {
		summary += `🎯 ${triggeredWorkflowsList.length} workflow(s) triggered their stop condition! `;
	}
	if (workflowsWithChanges > 0) {
		summary += `📊 ${workflowsWithChanges}/${sortedDigests.length} workflows have new changes. `;
	}
	if (totalExecutions > 0) {
		summary += `⚡ ${totalExecutions} total executions since ${since}.`;
	}
	if (!summary) {
		summary = `✓ All quiet. ${sortedDigests.length} workflows checked, no changes since ${since}.`;
	}

	const baseResponse = {
		summary: summary.trim(),
		since: since,
		checked_at: new Date().toISOString(),
		total_workflows: sortedDigests.length,
		workflows_with_changes: workflowsWithChanges,
		triggered_workflows: triggeredWorkflowsList.length,
		total_executions_since: totalExecutions,
		workflows: sortedDigests,
		// Phase 3: Cross-workflow correlations
		correlations: correlations.length > 0 ? correlations : undefined,
		correlation_metadata: correlationMetadata,
	};

	// Phase 4: Generate formatted output based on format parameter
	if (format === "briefing" || format === "briefing_llm") {
		const formattedOutput = generateBriefingMarkdown(
			sortedDigests,
			triggeredWorkflowsList,
			workflowsWithChanges,
			since,
			correlations,
		);
		return {
			...baseResponse,
			formatted_output: formattedOutput,
		};
	}

	if (format === "compact") {
		// Compact format: strip verbose details, keep only essential info
		const compactWorkflows = sortedDigests.map((w) => ({
			workflow_id: w.workflow_id,
			workflow_name: w.workflow_name,
			status: w.status,
			has_changes: w.has_changes,
			triggered_condition: w.triggered_condition,
			change_summary: w.change_summary,
			// Include new_urls count but not full objects
			new_urls_count: w.new_urls?.length || 0,
		}));
		return {
			...baseResponse,
			workflows: compactWorkflows as unknown as WorkflowDigest[],
			formatted_output: `Compact: ${workflowsWithChanges} changes across ${sortedDigests.length} workflows`,
		};
	}

	return baseResponse;
}

/**
 * Phase 4: Generate markdown briefing from workflow digests
 * Template-based for predictable, fast, deterministic output
 */
function generateBriefingMarkdown(
	digests: WorkflowDigest[],
	triggeredWorkflows: WorkflowDigest[],
	workflowsWithChanges: number,
	since: string,
	correlations: CrossWorkflowCorrelation[] = [],
): string {
	const date = new Date().toISOString().split("T")[0];
	const lines: string[] = [`# Workflow Updates - ${date}`, ""];

	// Handle zero-changes case
	if (workflowsWithChanges === 0 && triggeredWorkflows.length === 0) {
		lines.push("## All Quiet");
		lines.push("");
		lines.push(
			`No significant changes detected across your ${digests.length} active monitors.`,
		);
		lines.push("");
		lines.push("Last execution times:");
		for (const digest of digests.slice(0, 5)) {
			const timeAgo = digest.last_execution_at
				? formatTimeAgo(new Date(digest.last_execution_at))
				: "Never";
			lines.push(`- ${digest.workflow_name}: ${timeAgo}`);
		}
		if (digests.length > 5) {
			lines.push(`- ... and ${digests.length - 5} more`);
		}
		return lines.join("\n");
	}

	// Phase 2: Group workflows by signal level (using computed signal_level)
	const urgent = digests.filter((d) => d.signal_level === "urgent");
	const notable = digests.filter((d) => d.signal_level === "notable");
	const routine = digests.filter((d) => d.signal_level === "routine");
	const noise = digests.filter((d) => d.signal_level === "noise");

	// Urgent section
	if (urgent.length > 0) {
		lines.push(`## Urgent (${urgent.length})`);
		lines.push("");
		for (const digest of urgent) {
			lines.push(`### ${digest.workflow_name}`);
			if (digest.triggered_condition) {
				lines.push(`**Stop condition triggered!**`);
			}
			lines.push(`${digest.change_summary}`);
			if (digest.signal_reasoning) {
				lines.push(`*Signal: ${digest.signal_reasoning}*`);
			}
			if (digest.new_urls && digest.new_urls.length > 0) {
				lines.push("");
				for (const urlObj of digest.new_urls.slice(0, 3)) {
					const title = urlObj.title || "Link";
					lines.push(`- [${title}](${urlObj.url})`);
				}
			}
			lines.push("");
		}
	}

	// Notable section
	if (notable.length > 0) {
		lines.push(`## Notable (${notable.length})`);
		lines.push("");
		for (const digest of notable) {
			lines.push(`### ${digest.workflow_name}`);
			lines.push(digest.change_summary);
			if (digest.new_urls && digest.new_urls.length > 0) {
				const urlCount = digest.new_urls.length;
				const titles = digest.new_urls
					.slice(0, 3)
					.map((u) => u.title || u.url.split("/").pop())
					.join(", ");
				lines.push(
					`**New findings:** ${titles}${urlCount > 3 ? ` (+${urlCount - 3} more)` : ""}`,
				);
			}
			if (digest.signal_reasoning) {
				lines.push(`*Signal: ${digest.signal_reasoning}*`);
			}
			if (digest.change_rate !== undefined) {
				lines.push(`Churn: ${digest.change_rate}%`);
			}
			lines.push("");
		}
	}

	// Routine section (condensed)
	if (routine.length > 0) {
		lines.push(`## Routine (${routine.length})`);
		lines.push("");
		lines.push(`${routine.length} workflows with routine activity:`);
		lines.push(routine.map((d) => d.workflow_name).join(", "));
		lines.push("");
	}

	// Noise section (very condensed)
	if (noise.length > 0) {
		lines.push(`## Low Signal (${noise.length})`);
		lines.push("");
		lines.push(
			`${noise.length} workflows with low-signal activity (likely churn):`,
		);
		lines.push(noise.map((d) => d.workflow_name).join(", "));
		lines.push("");
	}

	// Phase 3: Cross-workflow correlations section
	if (correlations.length > 0) {
		lines.push(`## Cross-Workflow Patterns (${correlations.length})`);
		lines.push("");
		lines.push("URLs appearing across multiple monitors:");
		lines.push("");
		for (const correlation of correlations.slice(0, 5)) {
			const workflowNames = correlation.workflows.map((w) => w.workflow_name);
			// Extract domain from URL for cleaner display
			let domain = "";
			try {
				domain = new URL(correlation.value).hostname;
			} catch {
				domain = correlation.value;
			}
			lines.push(`- **${domain}** (${correlation.workflows.length} monitors)`);
			lines.push(`  - ${workflowNames.join(", ")}`);
			lines.push(`  - [View page](${correlation.value})`);
		}
		if (correlations.length > 5) {
			lines.push(`- ... and ${correlations.length - 5} more shared URLs`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Format a date as human-readable time ago
 */
function formatTimeAgo(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMins < 60)
		return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
	if (diffHours < 24)
		return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
	return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}

// =========================================================================
// Entity API - Persistent entity tracking
// =========================================================================

export async function listEntitySchemas(): Promise<ListEntitySchemasResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-schemas`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<ListEntitySchemasResponse>(response);
}

export async function createEntitySchema(params: {
	name: string;
	display_name?: string;
	description?: string;
	dedup_key: string[];
	fields: Record<string, { type: string; description?: string; required?: boolean }>;
	lifecycle_config?: EntityLifecycleConfig;
}): Promise<CreateEntitySchemaResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-schemas`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<CreateEntitySchemaResponse>(response);
}

export async function getEntitySchema(name: string): Promise<{ schema: EntitySchema }> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-schemas/${name}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<{ schema: EntitySchema }>(response);
}

export async function deleteEntitySchema(name: string): Promise<{ message: string }> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-schemas/${name}`, {
		method: "DELETE",
		headers: getHeaders(),
	});
	return handleResponse<{ message: string }>(response);
}

export async function listEntities(
	schemaName: string,
	params?: {
		status?: EntityStatus;
		limit?: number;
		offset?: number;
		sort_by?: 'first_seen_at' | 'last_seen_at' | 'created_at' | 'times_seen';
		sort_order?: 'asc' | 'desc';
		filter?: Record<string, unknown>;
	}
): Promise<ListEntitiesResponse> {
	const searchParams = new URLSearchParams();
	if (params?.status) searchParams.set("status", params.status);
	if (params?.limit) searchParams.set("limit", params.limit.toString());
	if (params?.offset) searchParams.set("offset", params.offset.toString());
	if (params?.sort_by) searchParams.set("sort_by", params.sort_by);
	if (params?.sort_order) searchParams.set("sort_order", params.sort_order);
	if (params?.filter) searchParams.set("filter", JSON.stringify(params.filter));

	const response = await fetch(
		`${ZIPF_API_BASE}/entities/${schemaName}?${searchParams}`,
		{
			method: "GET",
			headers: getHeaders(),
		}
	);
	return handleResponse<ListEntitiesResponse>(response);
}

export async function queryEntities(
	schemaName: string,
	params: {
		filter?: Record<string, unknown>;
		aggregations?: Array<{
			type: 'count' | 'count_by' | 'timeline';
			field?: string;
			interval?: 'day' | 'week' | 'month';
			date_field?: 'created_at' | 'first_seen_at' | 'last_seen_at';
			days_back?: number;
		}>;
		limit?: number;
		offset?: number;
	}
): Promise<QueryEntitiesResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/entities/${schemaName}`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<QueryEntitiesResponse>(response);
}

export async function getEntity(
	schemaName: string,
	entityId: string
): Promise<{ entity: Entity }> {
	const response = await fetch(
		`${ZIPF_API_BASE}/entities/${schemaName}/${entityId}`,
		{
			method: "GET",
			headers: getHeaders(),
		}
	);
	return handleResponse<{ entity: Entity }>(response);
}

export async function updateEntity(
	schemaName: string,
	entityId: string,
	params: {
		data?: Record<string, unknown>;
		status?: EntityStatus;
	}
): Promise<{ entity: Entity }> {
	const response = await fetch(
		`${ZIPF_API_BASE}/entities/${schemaName}/${entityId}`,
		{
			method: "PATCH",
			headers: getHeaders(),
			body: JSON.stringify(params),
		}
	);
	return handleResponse<{ entity: Entity }>(response);
}

export async function exportEntities(
	schemaName: string,
	params?: {
		format?: 'json' | 'csv';
		status?: EntityStatus;
		limit?: number;
		fields?: string[];
	}
): Promise<ExportEntitiesResponse> {
	const searchParams = new URLSearchParams();
	if (params?.format) searchParams.set("format", params.format);
	if (params?.status) searchParams.set("status", params.status);
	if (params?.limit) searchParams.set("limit", params.limit.toString());
	if (params?.fields) searchParams.set("fields", params.fields.join(","));

	const response = await fetch(
		`${ZIPF_API_BASE}/entities/${schemaName}/export?${searchParams}`,
		{
			method: "GET",
			headers: getHeaders(),
		}
	);
	return handleResponse<ExportEntitiesResponse>(response);
}

// Entity Signals

export async function listEntitySignals(params?: {
	schema_id?: string;
	is_active?: boolean;
}): Promise<ListEntitySignalsResponse> {
	const searchParams = new URLSearchParams();
	if (params?.schema_id) searchParams.set("schema_id", params.schema_id);
	if (params?.is_active !== undefined) searchParams.set("is_active", params.is_active.toString());

	const response = await fetch(
		`${ZIPF_API_BASE}/entity-signals?${searchParams}`,
		{
			method: "GET",
			headers: getHeaders(),
		}
	);
	return handleResponse<ListEntitySignalsResponse>(response);
}

export async function createEntitySignal(params: {
	schema_id: string;
	name: string;
	description?: string;
	condition_config: SignalCondition;
	actions_config: SignalAction[];
}): Promise<CreateEntitySignalResponse> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-signals`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<CreateEntitySignalResponse>(response);
}

export async function getEntitySignal(signalId: string): Promise<{ signal: EntitySignal }> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-signals/${signalId}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<{ signal: EntitySignal }>(response);
}

export async function updateEntitySignal(
	signalId: string,
	params: {
		name?: string;
		description?: string;
		condition_config?: SignalCondition;
		actions_config?: SignalAction[];
		is_active?: boolean;
	}
): Promise<{ signal: EntitySignal }> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-signals/${signalId}`, {
		method: "PATCH",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse<{ signal: EntitySignal }>(response);
}

export async function deleteEntitySignal(signalId: string): Promise<{ message: string }> {
	const response = await fetch(`${ZIPF_API_BASE}/entity-signals/${signalId}`, {
		method: "DELETE",
		headers: getHeaders(),
	});
	return handleResponse<{ message: string }>(response);
}

// =========================================================================
// Workflow Slack Test
// =========================================================================

export async function getWorkflowSlackStatus(workflowId: string): Promise<{
	endpoint: string;
	method: string;
	description: string;
	credits_cost: number;
	workflow_id: string;
	workflow_name: string;
	slack_status: {
		configured: boolean;
		enabled: boolean;
		webhook_configured: boolean;
		per_execution: boolean;
		digest: string;
		event_types: string[];
	};
	validation_error: string | null;
	ready_to_test: boolean;
}> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}/test-slack`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse(response);
}

export async function testWorkflowSlack(workflowId: string): Promise<{
	success: boolean;
	message: string;
	workflow_id: string;
	workflow_name: string;
	channel: string;
	timestamp: string;
}> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}/test-slack`, {
		method: "POST",
		headers: getHeaders(),
	});
	return handleResponse(response);
}

// =========================================================================
// Workflow Validation & Recovery
// =========================================================================

export async function getWorkflowValidationStatus(workflowId: string): Promise<{
	endpoint: string;
	method: string;
	description: string;
	workflow_id: string;
	validation_status?: {
		last_validated_at?: string;
		validation_available: boolean;
		issues_found?: number;
	};
}> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}/validate`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse(response);
}

export async function validateWorkflow(
	workflowId: string,
	params?: {
		url_health_check?: boolean;
		full_validation?: boolean;
		force?: boolean;
	}
): Promise<{
	workflow_id: string;
	validation_results: {
		valid: boolean;
		errors?: Array<{ type: string; message: string; step_id?: string }>;
		warnings?: Array<{ type: string; message: string; step_id?: string }>;
		url_health?: Array<{
			url: string;
			status: "ok" | "failed" | "redirect";
			status_code?: number;
			redirect_url?: string;
			correction_suggestion?: string;
		}>;
	};
	validated_at: string;
}> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}/validate`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params || {}),
	});
	return handleResponse(response);
}

export async function getWorkflowRecoverySuggestions(workflowId: string): Promise<{
	workflow_id: string;
	suggestions: Array<{
		id: string;
		type: "url_correction" | "url_replacement";
		original_url: string;
		suggested_url: string;
		reason: string;
		confidence: number;
		step_id?: string;
		status: "pending" | "applied" | "rejected";
	}>;
	total_pending: number;
}> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}/recovery`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse(response);
}

export async function applyWorkflowRecovery(
	workflowId: string,
	params: {
		suggestion_ids?: string[];
		apply_all?: boolean;
		reject_all?: boolean;
		reject_reason?: string;
		retry_steps?: boolean;
	}
): Promise<{
	workflow_id: string;
	applied: number;
	rejected: number;
	steps_marked_for_retry?: string[];
	message: string;
}> {
	const response = await fetch(`${ZIPF_API_BASE}/workflows/${workflowId}/recovery`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(params),
	});
	return handleResponse(response);
}

// =========================================================================
// Status API - Health check and account info
// =========================================================================

export async function getStatus(): Promise<StatusResponse> {
	const response = await fetch(`${ZIPF_API_BASE}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<StatusResponse>(response);
}
