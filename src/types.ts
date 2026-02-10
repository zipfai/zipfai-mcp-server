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

export interface AssessIntentResponse {
	intent: string;
	assessment: "specific" | "vague";
	specificity_score: number;
	is_actionable: boolean;
	recommendation: string;
	vague_aspects?: string[];
	proposed_intent?: string;
	what_we_clarified?: string[];
	inferred: {
		trigger_conditions: string[];
		exclusions: string[];
		entities: string[];
		source_types: string[];
		suggested_cadence: string;
		monitoring_type: string[];
		extraction_fields?: string[];
	};
	reasoning: string;
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

// Email configuration for workflow notifications
export interface EmailConfig {
	enabled: boolean;
	per_execution?: boolean; // Send email after each execution
	digest?: "none" | "daily" | "weekly"; // Digest frequency
	recipients?: string[] | null; // Custom recipients (null = use account email)
}

// Slack configuration for workflow notifications
export interface SlackConfig {
	enabled: boolean;
	webhook_url?: string; // Slack Incoming Webhook URL
	per_execution?: boolean; // Send notification after each execution
	include_diff?: boolean; // Include change diff in notifications
	include_summary?: boolean; // Include AI summary in notifications
}

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
	email_config?: EmailConfig;
	slack_config?: SlackConfig;
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
		hasMore?: boolean;
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
// Workflow Execution Feedback Types
// =========================================================================

export type ExecutionFeedbackRating = "positive" | "negative";

export type ExecutionFeedbackSignalType =
	| "result_thumbs_up"
	| "result_thumbs_down";

export type ExecutionFeedbackExecutionKind =
	| "workflow_execution"
	| "search_job"
	| "crawl_job"
	| "workflow_step"
	| "ask_job";

export type ExecutionFeedbackReasonCategory =
	| "relevant_results"
	| "accurate_information"
	| "timely_alert"
	| "good_formatting"
	| "irrelevant_results"
	| "missing_information"
	| "outdated_content"
	| "false_positive"
	| "missed_alert"
	| "too_slow"
	| "other";

export interface ExecutionFeedbackRecord {
	id: string;
	execution_id: string;
	execution_kind: ExecutionFeedbackExecutionKind;
	workflow_step_id: string | null;
	signal_type: ExecutionFeedbackSignalType;
	reason_category: ExecutionFeedbackReasonCategory | null;
	comment: string | null;
	result_url: string | null;
	actor: {
		type: "human" | "api" | "mcp";
		id_hash: string;
		model: string | null;
	};
	signal_source: "ui" | "api" | "mcp";
	immediate_reward: number;
	reward_version: number;
	created_at: string;
}

export interface ExecutionFeedbackResponse {
	schema_version: "execution_feedback_v1";
	workflow_id?: string;
	execution_id: string;
	status: "created" | "updated" | "idempotent_replay";
	feedback: ExecutionFeedbackRecord;
}

export interface ExecutionFeedbackListResponse {
	schema_version: "execution_feedback_v1";
	workflow_id: string;
	feedback: ExecutionFeedbackRecord[];
	pagination: {
		limit: number;
		next_cursor: string | null;
	};
}

export interface ExecutionFeedbackStatsResponse {
	schema_version: "execution_feedback_v1";
	workflow_id: string;
	total_feedback: number;
	thumbs_up_count: number;
	thumbs_down_count: number;
	positive_rate: number;
	executions_with_feedback: number;
	feedback_coverage_rate: number;
	reason_completion_rate: number;
	by_reason: Record<string, number>;
	by_actor_type: Record<"human" | "api" | "mcp", number>;
	trends: {
		last_7d: { positive: number; negative: number };
		last_30d: { positive: number; negative: number };
	};
	total_immediate_reward: number;
}

export interface ExecutionFeedbackBatchResult {
	execution_id: string;
	status: "created" | "updated" | "failed";
	signal_id?: string;
	error?: string;
}

export interface ExecutionFeedbackBatchResponse {
	schema_version: "execution_feedback_v1";
	workflow_id?: string;
	submitted: number;
	succeeded: number;
	failed: number;
	results: ExecutionFeedbackBatchResult[];
}

export interface FeedbackQueueItem {
	execution_id: string;
	execution_kind: ExecutionFeedbackExecutionKind;
	workflow_id: string | null;
	workflow_name: string | null;
	created_at: string;
	score: number;
	score_reasons: string[];
	feedback_hint: {
		suggested: boolean;
		action: {
			tool: string;
			args: {
				workflow_id?: string;
				execution_id: string;
				rating?: "positive" | "negative";
			};
		};
		note: string;
	};
}

export interface FeedbackQueueResponse {
	items: FeedbackQueueItem[];
	total_unrated: number;
}

export interface FeedbackImpactResponse {
	workflow_id: string;
	your_ratings: {
		total: number;
		positive: number;
		negative: number;
		coverage_rate: number;
	};
	calibration_impact: {
		nl_condition_adjustments: number;
		false_positive_reports: number;
		current_confidence_threshold: number;
		original_confidence_threshold: number;
	} | null;
	negative_patterns: {
		top_reasons: Array<{ reason: string; count: number }>;
		recommended_edits: string[];
	};
	community: {
		total_ratings: number;
		positive_rate: number;
		actors: number;
	};
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
	total_workflows_scanned?: number;
	workflows_truncated?: boolean;
	max_workflows_applied?: number;
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

export interface AssessIntentResponse {
	intent: string;
	assessment: 'specific' | 'vague';
	specificity_score: number;
	is_actionable: boolean;
	recommendation: string;
	vague_aspects?: string[];
	proposed_intent?: string;
	what_we_clarified?: string[];
	inferred: {
		trigger_conditions: string[];
		exclusions: string[];
		entities: string[];
		source_types: string[];
		suggested_cadence: string;
		monitoring_type: string[];
		extraction_fields?: string[];
	};
	reasoning: string;
}

// =========================================================================
// Entity API Types
// =========================================================================

export type EntityFieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'url' | 'email';

export interface EntityFieldDefinition {
	name: string;
	type: EntityFieldType;
	description?: string;
	required?: boolean;
	default_value?: unknown;
	validation?: {
		pattern?: string;
		min?: number;
		max?: number;
		enum?: string[];
	};
}

export interface EntityLifecycleConfig {
	track_first_seen?: boolean;
	track_last_seen?: boolean;
	stale_after_days?: number;
	auto_close_after_days?: number;
}

export interface EntitySchema {
	id: string;
	customer_id: string;
	name: string;
	display_name?: string;
	description?: string;
	dedup_key: string[];
	fields: Record<string, EntityFieldDefinition>;
	lifecycle_config?: EntityLifecycleConfig;
	created_at: string;
	updated_at: string;
}

export type EntityStatus = 'active' | 'stale' | 'closed';

export interface Entity {
	id: string;
	customer_id: string;
	schema_id: string;
	dedup_hash: string;
	data: Record<string, unknown>;
	classifications: Record<string, string | string[]>;
	status: EntityStatus;
	first_seen_at: string;
	last_seen_at: string;
	closed_at?: string;
	times_seen: number;
	source_workflow_id?: string;
	source_url?: string;
	source_execution_id?: string;
	created_at: string;
	updated_at: string;
}

export type SignalConditionType =
	| 'new_entity'
	| 'entity_closed'
	| 'entity_updated'
	| 'field_value'
	| 'population_change'
	| 'threshold'
	| 'custom';

export type SignalActionType = 'email' | 'webhook' | 'slack' | 'log';

export interface SignalCondition {
	type: SignalConditionType;
	field?: string;
	operator?: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'matches';
	value?: unknown;
	threshold?: number;
	natural_language?: string;
}

export interface SignalAction {
	type: SignalActionType;
	config: {
		recipients?: string[];
		subject_template?: string;
		body_template?: string;
		url?: string;
		method?: 'POST' | 'PUT';
		headers?: Record<string, string>;
		channel?: string;
		message_template?: string;
		message?: string;
	};
}

export interface EntitySignal {
	id: string;
	customer_id: string;
	schema_id: string;
	name: string;
	description?: string;
	condition_config: SignalCondition;
	actions_config: SignalAction[];
	is_active: boolean;
	last_evaluated_at?: string;
	last_triggered_at?: string;
	trigger_count: number;
	created_at: string;
	updated_at: string;
}

export interface ListEntitySchemasResponse {
	schemas: EntitySchema[];
	total: number;
}

export interface CreateEntitySchemaResponse {
	schema: EntitySchema;
}

export interface ListEntitiesResponse {
	schema_name: string;
	entities: Entity[];
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
}

export interface QueryEntitiesResponse {
	schema_name: string;
	entities: Entity[];
	total: number;
	aggregations?: {
		type: string;
		results: Record<string, number> | Array<{ date: string; count: number }>;
	}[];
	credits: CreditsInfo;
}

export interface ExportEntitiesResponse {
	// Export returns raw data (JSON array or CSV string)
	data: Entity[] | string;
	format: 'json' | 'csv';
	count: number;
	credits: CreditsInfo;
}

export interface ListEntitySignalsResponse {
	signals: EntitySignal[];
	total: number;
}

export interface CreateEntitySignalResponse {
	signal: EntitySignal;
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
