// Quick Search (lightweight, fast)
export interface QuickSearchResponse {
	results: {
		title: string;
		url: string;
		description: string;
		published_date: string;
	}[];
}

// Full Search Types
export interface SearchResult {
	title: string;
	url: string;
	description: string;
	published_date?: string;
	relevance_score?: number;
}

export interface QueryInterpretation {
	original_query: string;
	rewritten_query?: string;
	intent?: string;
	confidence?: number;
	metadata_status?: "pending" | "processing" | "completed" | "failed" | null;
	document_types?: { type: string; confidence: number; reasoning: string }[];
	content_types?: { type: string; confidence: number; reasoning: string }[];
	dewey_classifications?: {
		code: string;
		label: string;
		confidence: number;
	}[];
	search_parameters?: {
		recency?: string;
		authority?: string;
		diversity?: string;
	};
	extracted_metadata?: {
		entities?: string[];
		keywords?: string[];
		complexity?: string;
	};
}

export interface SuggestedQuery {
	query: string;
	type: string;
	reasoning: string;
	confidence: number;
}

export interface DecompositionInfo {
	enabled: boolean;
	sub_queries?: string[];
	reasoning?: string;
	strategy?: string;
}

export interface AggregationInfo {
	total_before_dedup?: number;
	unique_urls?: number;
	deduplication_rate?: string;
}

export interface SearchJobResponse {
	search_job_id: string;
	status: "pending" | "running" | "completed" | "failed";
	query: string;
	results?: SearchResult[];
	query_interpretation?: QueryInterpretation;
	suggested_queries?: SuggestedQuery[];
	summary_requested?: boolean;
	summary?: string | { status: string; content?: string } | null;
	metadata_status?: string | null;
	decomposition?: DecompositionInfo;
	aggregation?: AggregationInfo;
	execution?: {
		credits_consumed: number;
	};
	timing?: {
		started_at?: string;
		completed_at?: string;
		duration_ms?: number;
	};
	credits?: CreditsInfo;
}

// Credits info (standardized across responses)
export interface CreditsInfo {
	consumed?: number;
	reserved?: number;
	balance_after?: number;
	pricing_tier?: "basic" | "advanced";
	advanced_features?: string[];
	breakdown?: Record<string, unknown>;
}

// =========================================================================
// Ask API Types
// =========================================================================
export interface AskResponse {
	answer: string;
	sources: {
		url: string;
		title: string;
		snippet?: string;
		relevance?: number;
	}[];
	follow_up_questions?: string[];
	search_queries_used?: string[];
	depth: "quick" | "standard" | "deep";
	credits: CreditsInfo;
	timing?: {
		total_ms?: number;
		search_ms?: number;
		synthesis_ms?: number;
	};
}

// =========================================================================
// Crawl API Types
// =========================================================================
export interface CrawlResult {
	url: string;
	title?: string;
	content?: string;
	markdown?: string;
	extracted_data?: Record<string, unknown>;
	extraction_metadata?: {
		fields_requested?: number;
		fields_extracted?: number;
		confidence_scores?: Record<string, number>;
		provenance?: Record<string, string>;
	};
	classification?: {
		document_type?: string;
		content_type?: string;
		confidence?: number;
	};
	error?: string;
}

export interface CrawlResponse {
	id: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	urls: string[];
	pages_crawled?: number;
	results?: CrawlResult[];
	summary_requested?: boolean;
	summary?: string | { status: string; content?: string } | null;
	stats?: {
		total_documents?: number;
		processing_time_ms?: number;
		pages_crawled?: number;
		pages_failed?: number;
	};
	execution?: {
		mode?: string;
		duration_ms?: number;
		success?: boolean;
	};
	credits?: CreditsInfo;
}

export interface SuggestSchemaResponse {
	url: string;
	detected_page_type: string;
	page_type_confidence: number;
	suggested_schema: Record<string, string>;
	field_metadata?: Record<
		string,
		{
			confidence: number;
			example_value?: string;
			data_type?: string;
		}
	>;
	schema_org_detected?: boolean;
	schema_org_type?: string;
	reasoning?: string;
	credits?: CreditsInfo;
}

// =========================================================================
// Session API Types
// =========================================================================
export interface SessionConfig {
	auto_deduplicate?: boolean;
	accumulate_context?: boolean;
	use_session_context?: boolean;
	max_operations?: number;
}

export interface SessionAggregates {
	unique_urls?: number;
	total_credits?: number;
	operation_count?: number;
	operations_by_type?: Record<string, number>;
}

export interface Session {
	id: string;
	customer_id?: string;
	name: string;
	description?: string;
	status: "active" | "completed" | "archived";
	intent_context?: string;
	session_config?: SessionConfig;
	aggregates?: SessionAggregates;
	created_at?: string;
	updated_at?: string;
	completed_at?: string;
}

export interface CreateSessionResponse {
	session: Session;
}

export interface SessionTimelineOperation {
	id: string;
	type: "search" | "crawl";
	status: string;
	created_at: string;
	completed_at?: string;
	credits_consumed?: number;
	summary?: string;
}

export interface SessionTimelineResponse {
	session_id: string;
	operations: SessionTimelineOperation[];
	aggregates?: SessionAggregates;
}

// =========================================================================
// Research API Types
// =========================================================================
export interface ResearchResponse {
	session_id?: string;
	search_job_id?: string;
	crawl_ids?: string[];
	answer?: string;
	sources?: {
		url: string;
		title: string;
		content_preview?: string;
		crawled?: boolean;
	}[];
	summary?: string;
	credits?: CreditsInfo;
	timing?: {
		total_ms?: number;
		search_ms?: number;
		crawl_ms?: number;
		synthesis_ms?: number;
	};
}

// =========================================================================
// Workflow API Types
// =========================================================================
export interface WorkflowStopCondition {
	type:
		| "result_count"
		| "contains_url"
		| "field_value"
		| "extracted_field"
		| "natural_language"
		| "always";
	operator?: string;
	value?: string | number;
	url?: string;
	field?: string;
	description?: string;
	confidence_threshold?: number;
}

export interface WorkflowStep {
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
}

export interface Workflow {
	id: string;
	customer_id?: string;
	name: string;
	mode?: "simple" | "multi_step" | "ai_planned";
	workflow_type?: "search" | "crawl";
	operation_config?: Record<string, unknown>;
	steps?: WorkflowStep[];
	intent?: string;
	stop_condition: WorkflowStopCondition;
	interval_minutes: number;
	max_executions?: number;
	execution_count?: number;
	status: "active" | "paused" | "completed" | "failed";
	next_execution_at?: string;
	last_execution_at?: string;
	session_id?: string;
	created_at?: string;
	updated_at?: string;
}

export interface WorkflowExecution {
	id: string;
	workflow_id: string;
	status: "pending" | "running" | "completed" | "failed";
	trigger_type?: "scheduled" | "manual";
	result_summary?: Record<string, unknown>;
	credits_consumed?: number;
	error?: string;
	started_at?: string;
	completed_at?: string;
}

export interface CreateWorkflowResponse {
	workflow: Workflow;
}

export interface ListWorkflowsResponse {
	workflows: Workflow[];
	pagination?: {
		total: number;
		limit: number;
		offset: number;
	};
}

export interface WorkflowDetailsResponse {
	workflow: Workflow;
	executions?: WorkflowExecution[];
	stats?: {
		total_executions: number;
		successful_executions: number;
		failed_executions: number;
		total_credits_consumed: number;
	};
}

export interface WorkflowTimelineResponse {
	workflow_id: string;
	executions: WorkflowExecution[];
}

// =========================================================================
// Workflow Diff Types (Updated to match actual backend response)
// =========================================================================

export interface FieldChange {
	field: string;
	from: unknown;
	to: unknown;
	change_type:
		| "increase"
		| "decrease"
		| "added"
		| "removed"
		| "status_change"
		| "text_change";
	change_percent?: number;
}

export interface ExecutionDiff {
	execution_id: string;
	previous_execution_id: string | null;
	executed_at: string;
	has_changes: boolean;
	changes: FieldChange[];
	no_change: string[];
	summary?: string;
	extracted_state?: Record<string, unknown>;
	previous_state?: Record<string, unknown> | null;
}

export interface FieldTrend {
	field: string;
	trend: "increasing" | "decreasing" | "stable" | "volatile";
	direction_consistency: number;
	total_changes: number;
	increases: number;
	decreases: number;
}

export interface NumericAnalytics {
	field: string;
	min: number;
	max: number;
	avg: number;
	latest: number;
	range: number;
	data_points: number;
}

export interface ExtractionStats {
	total_pages_crawled: number;
	pages_with_extraction: number;
	fields_success_rate: Record<string, number>;
	avg_fields_extracted: number;
	most_reliable_fields: string[];
	least_reliable_fields: string[];
}

export interface WorkflowDiffStats {
	executions_with_changes: number;
	executions_without_changes: number;
	change_rate: number;
	most_volatile_fields: Array<{ field: string; change_count: number }>;
}

export interface WorkflowDiffAnalytics {
	field_trends?: FieldTrend[] | null;
	numeric_fields?: NumericAnalytics[] | null;
	extraction_stats?: ExtractionStats | null;
}

export interface WorkflowDiffResponse {
	workflow_id: string;
	workflow_name: string;
	workflow_type: string | null;
	workflow_mode: "simple" | "multi_step" | "ai_planned";
	is_multi_step: boolean;
	total_executions: number;

	stats: WorkflowDiffStats;
	analytics?: WorkflowDiffAnalytics;
	diffs: ExecutionDiff[];

	latest?: {
		execution_id: string;
		executed_at: string;
		state: Record<string, unknown>;
		changes_from_previous: FieldChange[];
		summary?: string;
	} | null;
}

// =========================================================================
// Workflow Updates Digest Types (Compound Tool)
// =========================================================================

// Phase 1: Semantic URL summaries for enriched net_new_urls
export interface NewUrlSummary {
	url: string;
	title?: string | null;
	snippet?: string | null;
	published_date?: string | null;
	document_type?: string | null;
}

export interface WorkflowDigest {
	workflow_id: string;
	workflow_name: string;
	workflow_type?: "search" | "crawl" | null;
	workflow_mode?: "simple" | "multi_step" | "ai_planned";
	status: "active" | "paused" | "completed" | "failed";

	// Activity indicators
	has_changes: boolean;
	triggered_condition: boolean;
	executions_since: number;
	last_execution_at?: string;
	next_execution_at?: string;

	// Compact summary
	change_summary: string;

	// Stats from diff API (quick access)
	change_rate?: number;

	// Phase 2: Signal/Noise scoring
	signal_score?: number; // 0-100, higher = more important
	signal_level?: SignalLevel; // urgent, notable, routine, noise
	signal_reasoning?: string; // Brief explanation of the score

	// Phase 1: Semantic URL summaries (enriched net_new_urls from extracted_state)
	new_urls?: NewUrlSummary[];

	// Verbose details (optional)
	recent_diffs?: ExecutionDiff[];
	recent_executions?: WorkflowExecution[];
	latest_state?: Record<string, unknown>;

	// Error handling
	error?: string;
}

// Phase 4: Configurable digest formats
export type DigestFormat = 'json' | 'briefing' | 'briefing_llm' | 'compact';

// Phase 2: Signal/Noise scoring
export type SignalLevel = 'urgent' | 'notable' | 'routine' | 'noise';

// Phase 3: Cross-workflow correlation
export interface CrossWorkflowCorrelation {
	type: 'shared_url' | 'shared_topic' | 'shared_entity';
	value: string; // URL or topic/entity name
	workflows: {
		workflow_id: string;
		workflow_name: string;
		context: string; // How it appeared in this workflow (snippet from Phase 1)
	}[];
	insight: string; // e.g., "Appears in 3 monitors: AI Safety, Congress AI, White House AI"
}

export interface CorrelationMetadata {
	workflows_analyzed: number;
	workflows_skipped: number; // If > MAX_WORKFLOWS_FOR_CORRELATION
	total_urls_compared: number;
}

export interface WorkflowUpdatesDigestResponse {
	summary: string;
	since: string;
	checked_at: string;
	total_workflows: number;
	workflows_with_changes: number;
	triggered_workflows: number;
	total_executions_since: number;
	workflows: WorkflowDigest[];
	// Phase 4: Formatted output when briefing/compact format requested
	formatted_output?: string;
	// Phase 3: Cross-workflow correlation
	correlations?: CrossWorkflowCorrelation[];
	correlation_metadata?: CorrelationMetadata;
}

export interface PlanWorkflowResponse {
	name: string;
	intent: string;
	steps: WorkflowStep[];
	estimated_credits_per_execution: number;
	reasoning: string;
}

// =========================================================================
// Status API Types
// =========================================================================
export interface StatusResponse {
	api: {
		name: string;
		version: string;
		description: string;
		status: string;
		documentation_url: string;
	};
	user: {
		id: string;
		email?: string;
		name?: string;
		subscription_status?: string;
		credits_balance: number;
	};
	endpoints: Record<string, unknown>;
	rate_limits: {
		default_per_hour: number;
		default_per_day: number;
		note: string;
	};
	credit_costs: Record<string, unknown>;
}
