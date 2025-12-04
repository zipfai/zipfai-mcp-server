import type { QuickSearchResponse, SearchJobResponse } from "./types.js";

const ZIPF_API_BASE = "https://www.zipf.ai/api/v1";

function getHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${process.env.ZIPF_API_KEY}`,
	};
}

// Quick Search - lightweight, fast
export async function quickSearch(params: {
	query: string;
	max_results?: number;
	include_domains?: string[];
	exclude_domains?: string[];
}): Promise<QuickSearchResponse | null> {
	try {
		const response = await fetch(`${ZIPF_API_BASE}/search/quick`, {
			method: "POST",
			headers: getHeaders(),
			body: JSON.stringify({
				query: params.query,
				max_results: params.max_results ?? 10,
				include_domains: params.include_domains ?? [],
				exclude_domains: params.exclude_domains ?? [],
			}),
		});
		return (await response.json()) as QuickSearchResponse;
	} catch (error) {
		console.error("Quick search error:", error);
		return null;
	}
}

// Full Search - with AI enhancements
export async function search(params: {
	query: string;
	max_results?: number;
	include_domains?: string[];
	exclude_domains?: string[];
	interpret_query?: boolean;
	extract_metadata?: boolean;
	rerank_results?: boolean;
	generate_suggestions?: boolean;
	suggestions_top_n?: number;
	num_suggestions?: number;
	generate_summary?: boolean;
}): Promise<SearchJobResponse | null> {
	try {
		const response = await fetch(`${ZIPF_API_BASE}/search`, {
			method: "POST",
			headers: getHeaders(),
			body: JSON.stringify({
				query: params.query,
				max_results: params.max_results ?? 10,
				include_domains: params.include_domains,
				exclude_domains: params.exclude_domains,
				interpret_query: params.interpret_query ?? false,
				extract_metadata: params.extract_metadata ?? false,
				rerank_results: params.rerank_results ?? false,
				generate_suggestions: params.generate_suggestions ?? false,
				suggestions_top_n: params.suggestions_top_n,
				num_suggestions: params.num_suggestions,
				generate_summary: params.generate_summary ?? false,
			}),
		});
		return (await response.json()) as SearchJobResponse;
	} catch (error) {
		console.error("Search error:", error);
		return null;
	}
}

// Get Search Job - used internally for polling
async function getSearchJob(jobId: string): Promise<SearchJobResponse | null> {
	try {
		const response = await fetch(`${ZIPF_API_BASE}/search/jobs/${jobId}`, {
			method: "GET",
			headers: getHeaders(),
		});
		return (await response.json()) as SearchJobResponse;
	} catch (error) {
		console.error("Get search job error:", error);
		return null;
	}
}

// Helper to wait
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Full Search with internal polling for async features
export async function searchWithPolling(params: {
	query: string;
	max_results?: number;
	include_domains?: string[];
	exclude_domains?: string[];
	interpret_query?: boolean;
	extract_metadata?: boolean;
	rerank_results?: boolean;
	generate_suggestions?: boolean;
	suggestions_top_n?: number;
	num_suggestions?: number;
	generate_summary?: boolean;
}): Promise<SearchJobResponse | null> {
	// Initial search request
	const initialResult = await search(params);
	if (!initialResult) return null;

	const needsPolling = params.generate_summary || params.extract_metadata;

	if (!needsPolling) {
		return initialResult;
	}

	// Poll for async results (summary, metadata)
	const jobId = initialResult.search_job_id;
	const maxAttempts = 30; // 30 attempts * 2s = 60s max wait
	const pollInterval = 2000; // 2 seconds

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		await sleep(pollInterval);

		const job = await getSearchJob(jobId);
		if (!job) continue;

		// Check if async features are complete
		const summaryDone =
			!params.generate_summary ||
			(job.summary !== null && job.summary !== undefined);
		const metadataDone =
			!params.extract_metadata ||
			job.query_interpretation?.metadata_status === "completed" ||
			job.query_interpretation?.metadata_status === "failed";

		if (summaryDone && metadataDone) {
			return job;
		}
	}

	// Timeout - return what we have
	return await getSearchJob(jobId);
}
