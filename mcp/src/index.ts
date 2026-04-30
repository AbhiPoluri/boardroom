#!/usr/bin/env node
/**
 * Boardroom MCP server.
 *
 * Exposes a running Boardroom instance (default localhost:7391) as MCP tools
 * so Claude Code, Cursor, or any MCP client can spawn and control the
 * agent fleet without leaving the editor.
 *
 * Configure via env:
 *   BOARDROOM_URL      — base URL (default: http://localhost:7391)
 *   BOARDROOM_API_KEY  — optional bearer token if Boardroom is protected
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const BOARDROOM_URL = (process.env.BOARDROOM_URL ?? "http://localhost:7391").replace(/\/$/, "");
const BOARDROOM_API_KEY = process.env.BOARDROOM_API_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (BOARDROOM_API_KEY) h["authorization"] = `Bearer ${BOARDROOM_API_KEY}`;
  return h;
}

async function call(
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${BOARDROOM_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON — return raw text */
  }
  if (!res.ok) {
    throw new Error(
      `Boardroom ${method} ${path} failed (${res.status}): ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`,
    );
  }
  return parsed;
}

function ok(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

const TOOLS = [
  {
    name: "boardroom_health",
    description: "Check that the Boardroom server is reachable. Use this first if other tools fail.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    schema: z.object({}),
    handler: async () => ok(await call("GET", "/api/health")),
  },
  {
    name: "boardroom_list_agents",
    description:
      "List the current agent fleet — running, finished, and recent. Returns up to `limit` agents (default 50, max 1000) plus aggregate stats and per-agent token usage.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max agents to return (1-1000)", default: 50 },
      },
      additionalProperties: false,
    },
    schema: z.object({ limit: z.number().int().min(1).max(1000).default(50) }),
    handler: async (args: { limit: number }) =>
      ok(await call("GET", `/api/agents?limit=${args.limit}`)),
  },
  {
    name: "boardroom_get_agent",
    description: "Fetch a single agent's full record by id (status, logs, cost, branch, parent task, etc).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Agent UUID" } },
      required: ["id"],
      additionalProperties: false,
    },
    schema: z.object({ id: z.string().min(1) }),
    handler: async (args: { id: string }) => ok(await call("GET", `/api/agents/${encodeURIComponent(args.id)}`)),
  },
  {
    name: "boardroom_spawn_agent",
    description:
      "Spawn a new agent to perform a task. Boardroom isolates it on its own git worktree, streams its output, and tracks cost. Returns the new agent's id and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Plain-language description of what the agent should do. Max 50,000 chars.",
        },
        type: {
          type: "string",
          enum: ["claude", "codex", "opencode", "shell"],
          description: "Agent runtime (default: claude).",
          default: "claude",
        },
        repo: {
          type: "string",
          description: "Absolute path to the repo the agent should work in. Defaults to the configured sandbox repo.",
        },
        useGitIsolation: {
          type: "boolean",
          description: "If true, create an isolated git worktree (default: true).",
          default: true,
        },
        name: { type: "string", description: "Optional human-readable name (max 200 chars)." },
        model: { type: "string", description: "Optional model override (e.g. 'haiku', 'sonnet')." },
      },
      required: ["task"],
      additionalProperties: false,
    },
    schema: z.object({
      task: z.string().min(1).max(50000),
      type: z.enum(["claude", "codex", "opencode", "shell"]).default("claude"),
      repo: z.string().optional(),
      useGitIsolation: z.boolean().default(true),
      name: z.string().max(200).optional(),
      model: z.string().optional(),
    }),
    handler: async (args: Record<string, unknown>) =>
      ok(await call("POST", "/api/agents", args)),
  },
  {
    name: "boardroom_stop_agent",
    description: "Stop a running agent by id. Idempotent — succeeds even if already stopped.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    schema: z.object({ id: z.string().min(1) }),
    handler: async (args: { id: string }) =>
      ok(await call("DELETE", `/api/agents/${encodeURIComponent(args.id)}`)),
  },
  {
    name: "boardroom_tell_orchestrator",
    description:
      "Send a plain-language goal to the Boardroom orchestrator. The orchestrator decomposes it into agent tasks and routes them across the fleet. Returns the orchestrator's plan + spawned agents.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "What you want shipped, in plain language." },
      },
      required: ["message"],
      additionalProperties: false,
    },
    schema: z.object({ message: z.string().min(1) }),
    handler: async (args: { message: string }) =>
      ok(await call("POST", "/api/chat", { message: args.message })),
  },
  {
    name: "boardroom_list_workflows",
    description: "List saved DAG pipelines (visual workflows) and any in-flight runs.",
    inputSchema: {
      type: "object",
      properties: {
        runs: {
          type: "boolean",
          description: "If true, return run history instead of saved workflows.",
          default: false,
        },
      },
      additionalProperties: false,
    },
    schema: z.object({ runs: z.boolean().default(false) }),
    handler: async (args: { runs: boolean }) =>
      ok(await call("GET", `/api/workflows${args.runs ? "?runs=1" : ""}`)),
  },
  {
    name: "boardroom_get_workflow_run",
    description: "Fetch the status, step results, and logs for a specific workflow run.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"],
      additionalProperties: false,
    },
    schema: z.object({ runId: z.string().min(1) }),
    handler: async (args: { runId: string }) =>
      ok(await call("GET", `/api/workflows?runId=${encodeURIComponent(args.runId)}`)),
  },
  {
    name: "boardroom_get_token_usage",
    description: "Return per-agent token usage and total spend for the current session.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    schema: z.object({}),
    handler: async () => ok(await call("GET", "/api/tokens")),
  },
] as const;

const server = new Server(
  { name: "boardroom", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }],
    };
  }
  try {
    const args = tool.schema.parse(req.params.arguments ?? {});
    // Each handler accepts its parsed-arg shape; cast at the call site keeps types
    // simple without losing per-tool validation above.
    return await (tool.handler as (a: unknown) => Promise<ReturnType<typeof ok>>)(args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text" as const, text: msg }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is fine for status; stdout is the MCP transport.
console.error(`[boardroom-mcp] connected to ${BOARDROOM_URL}${BOARDROOM_API_KEY ? " (authed)" : ""}`);
