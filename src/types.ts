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

export interface SearchJobResponse {
	search_job_id: string;
	status: "pending" | "running" | "completed" | "failed";
	query: string;
	results?: {
		urls: SearchResult[];
	};
	query_interpretation?: QueryInterpretation;
	suggested_queries?: SuggestedQuery[];
	summary_requested?: boolean;
	summary?: string | null;
	metadata_status?: string | null;
	execution?: {
		credits_consumed: number;
	};
	timing?: {
		started_at?: string;
		completed_at?: string;
		duration_ms?: number;
	};
}
