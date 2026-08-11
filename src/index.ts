import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({
    name: "Lead Desk OS Light",
    version: "1.0.0",
  });

  server.registerTool(
    "executePackageTest",
    {
      description:
        "Tests whether ChatGPT can reach the Lead Desk OS Light MCP server.",
      inputSchema: z.object({
        message: z.string().optional(),
      }),
    },
    async ({ message }) => {
      return {
        content: [
          {
            type: "text",
            text:
              message ??
              "Lead Desk OS Light MCP reached successfully.",
          },
        ],
      };
    },
  );

  return server;
}

const handler = createMcpHandler(createServer);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const authorization = request.headers.get("Authorization");
    const expectedAuthorization = `Bearer ${env.LEAD_DESK_API_KEY}`;

    if (authorization !== expectedAuthorization) {
      return new Response("Unauthorized", { status: 401 });
    }

    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
