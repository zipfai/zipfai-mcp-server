#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getPluginRoot(): string {
	// Go up from build/ to project root
	return resolve(__dirname, "..");
}

function runClaude(args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("claude", args, { stdio: "inherit", shell: true });
		proc.on("close", (code) => resolve(code === 0));
		proc.on("error", () => resolve(false));
	});
}

function saveApiKey(apiKey: string): void {
	// Save API key to ~/.zipfai/config so the plugin can read it
	const configDir = resolve(homedir(), ".zipfai");
	const configFile = resolve(configDir, "config.json");

	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}

	writeFileSync(configFile, JSON.stringify({ apiKey }, null, 2));
	console.log(`API key saved to ${configFile}`);
}

async function install(apiKey: string): Promise<void> {
	console.log("Installing ZipfAI plugin to Claude Code...\n");

	// Save API key
	saveApiKey(apiKey);

	const pluginRoot = getPluginRoot();

	// Step 1: Try to add marketplace (may already exist)
	console.log("Adding ZipfAI marketplace...");
	await runClaude(["plugin", "marketplace", "add", pluginRoot]);
	// Ignore failure - marketplace might already exist

	// Step 2: Install plugin from marketplace
	console.log("\nInstalling zipfai-web-search plugin...");
	const installSuccess = await runClaude([
		"plugin",
		"install",
		"zipfai-web-search@zipfai",
	]);

	if (installSuccess) {
		console.log("\nInstalled successfully!");
		console.log("\nNext steps:");
		console.log("  1. Restart Claude Code");
		console.log('  2. Try: "Search for TypeScript best practices"');
		console.log("\nTo uninstall: npx zipfai-mcp-server uninstall");
	} else {
		console.error("\nPlugin installation failed.");
		process.exit(1);
	}
}

async function uninstall(): Promise<void> {
	console.log("Removing ZipfAI plugin from Claude Code...\n");

	// Uninstall the plugin
	await runClaude(["plugin", "uninstall", "zipfai-web-search@zipfai"]);

	// Also remove the marketplace
	console.log("Removing ZipfAI marketplace...");
	await runClaude(["plugin", "marketplace", "remove", "zipfai"]);

	console.log("Uninstalled successfully!");
}

function printHelp(): void {
	console.log(`
ZipfAI Web Search Plugin

Usage:
  npx zipfai-mcp-server install --api-key=<key>
  npx zipfai-mcp-server uninstall

Commands:
  install     Install plugin to Claude Code
  uninstall   Remove plugin from Claude Code

Options:
  --api-key   Your ZipfAI API key (required for install)
  --help      Show this help message
`);
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			"api-key": { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});

	const command = positionals[0];

	if (values.help || !command) {
		printHelp();
		process.exit(0);
	}

	switch (command) {
		case "install": {
			const apiKey = values["api-key"];
			if (!apiKey) {
				console.error("Error: --api-key is required\n");
				printHelp();
				process.exit(1);
			}
			await install(apiKey);
			break;
		}
		case "uninstall":
			await uninstall();
			break;
		default:
			console.error(`Unknown command: ${command}\n`);
			printHelp();
			process.exit(1);
	}
}

main();
