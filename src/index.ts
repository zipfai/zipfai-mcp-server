import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ZIPF_API_BASE = "https://www.zipf.ai/api/v1";

const server = new McpServer({
	name: "zipfai-web-search",
	version: "0.0.1",
});

interface QuickSearchResponse {
	results: {
		title: string;
		url: string;
		description: string;
		published_date: string;
	}[];
}

async function makeQuickSearch(
	query: string,
	maxResults: number = 10,
	includeDomains: string[] = [],
	excludeDomains: string[] = [],
) {
	try {
		const response = await fetch(`${ZIPF_API_BASE}/search/quick`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.ZIPF_API_KEY}`,
			},
			body: JSON.stringify({
				query,
				max_results: maxResults,
				include_domains: includeDomains,
				exclude_domains: excludeDomains,
			}),
		});
		const data: QuickSearchResponse = await response.json();
		return data;
	} catch (error) {
		console.error(error);
		return null;
	}
}

server.registerTool(
	"zipfai_quick_web_search",
	{
		title: "ZipfAI Quick Web Search",
		description: "Search the web for URLs that match the given query",
		inputSchema: {
			query: z.string(),
			max_results: z.number().optional(),
			include_domains: z.array(z.string()).optional(),
			exclude_domains: z.array(z.string()).optional(),
		},
	},
	async ({ query, max_results, include_domains, exclude_domains }) => {
		const results = await makeQuickSearch(
			query,
			max_results ?? 10,
			include_domains ?? [],
			exclude_domains ?? [],
		);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(results, null, 2),
				},
			],
		};
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("ZipfAI Web Search MCP Server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});
