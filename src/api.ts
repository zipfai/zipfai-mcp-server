import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { QuickSearchResponse, SearchJobResponse } from "./types.js";

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

function getHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${getApiKey()}`,
	};
}

// Quick Search - lightweight, fast
export async function quickSearch(params: {
	query: string;
	max_results?: number;
	include_domains?: string[];
	exclude_domains?: string[];
}): Promise<QuickSearchResponse> {
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
	return handleResponse<QuickSearchResponse>(response);
}

// Full Search - with AI enhancements
async function search(params: {
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
}): Promise<SearchJobResponse> {
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

// Helper to wait
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polling configuration
const POLL_CONFIG = {
	initialInterval: 500, // Start with 500ms
	maxInterval: 4000, // Cap at 4 seconds
	backoffMultiplier: 1.5, // Increase by 50% each time
	maxDuration: 60000, // 60 seconds total timeout
};

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
}): Promise<SearchJobResponse> {
	// Initial search request
	const initialResult = await search(params);

	const needsPolling = params.generate_summary || params.extract_metadata;

	if (!needsPolling) {
		return initialResult;
	}

	// Poll for async results (summary, metadata) with exponential backoff
	const jobId = initialResult.search_job_id;
	const startTime = Date.now();
	let currentInterval = POLL_CONFIG.initialInterval;
	let lastSuccessfulJob: SearchJobResponse = initialResult;

	while (Date.now() - startTime < POLL_CONFIG.maxDuration) {
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

		// Exponential backoff with cap
		currentInterval = Math.min(
			currentInterval * POLL_CONFIG.backoffMultiplier,
			POLL_CONFIG.maxInterval,
		);
	}

	// Timeout - return the last successful response we got
	console.error(
		`Polling timeout after ${POLL_CONFIG.maxDuration}ms, returning partial results`,
	);
	return lastSuccessfulJob;
}
