import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer(makeGatewayUrl: string) {
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

  server.registerTool(
    "createCalendarTask",
    {
      description:
        "Creates one 30-minute event in the Lead Desk OS Light Google Calendar. Times use America/Los_Angeles.",
      inputSchema: z.object({
        taskTitle: z.string().min(1),
        startDateTime: z.string().min(1),
        purpose: z.string().optional(),
        leadCode: z.string().optional(),
        executionNotes: z.string().optional(),
        nextAction: z.string().optional(),
        calendarRegistry: z.string().optional(),
      }),
    },
    async ({
      taskTitle,
      startDateTime,
      purpose,
      leadCode,
      executionNotes,
      nextAction,
      calendarRegistry,
    }) => {
      const executionId = crypto.randomUUID();

      const response = await fetch(makeGatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stage: "Execute",
          action: "CreateCalendarEvent",
          purpose: purpose ?? "",
          leadCode: leadCode ?? "",
          workflow: "Calendar",
          taskTitle,
          nextAction: nextAction ?? "",
          executionId,
          startDateTime,
          executionNotes: executionNotes ?? "",
          durationMinutes: 30,
          calendarRegistry: calendarRegistry ?? "Lead Desk OS Light",
        }),
      });

      const responseText = await response.text();

      if (!response.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Calendar gateway failed with HTTP ${response.status}: ${responseText}`,
            },
          ],
        };
      }

      let result: unknown;

      try {
        result = JSON.parse(responseText);
      } catch {
        result = {
          success: true,
          executionId,
          message: responseText,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

    server.registerTool(
    "createNotionOpportunity",
    {
      description:
        "Creates one opportunity in the Lead Desk OS Light Notion data source.",
      inputSchema: z.object({
        leadCode: z.string().min(1),
        workflow: z.enum([
          "Internet Lead",
          "General Engagement",
          "Re-Engagement",
          "Pricing Inquiry",
          "Appointment",
          "Demo/Test Drive",
          "Negotiation",
          "Credit",
          "Contracting",
          "Delivery",
          "Two-Way Contact",
          "Contracted",
        ]),
        stage: z.enum([
          "New Lead",
          "Two-Way Contact",
          "Appointment Set",
          "Showroom Visit",
          "Demo/Test Drive",
          "Quote Presented",
          "Negotiation",
          "Credit Submitted",
          "Contracted",
          "Delivered",
          "Lost",
        ]),
        executionNotes: z.string().optional(),
        nextAction: z.string().optional(),
      }),
    },
    async ({
      leadCode,
      workflow,
      stage,
      executionNotes,
      nextAction,
    }) => {
      const executionId = crypto.randomUUID();

      const response = await fetch(makeGatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stage,
          action: "CreateNotionOpportunity",
          purpose: "",
          leadCode,
          workflow,
          taskTitle: "",
          nextAction: nextAction ?? "",
          executionId,
          startDateTime: "",
          executionNotes: executionNotes ?? "",
          durationMinutes: 0,
          calendarRegistry: "",
        }),
      });

      const responseText = await response.text();

      if (!response.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Notion gateway failed with HTTP ${response.status}: ${responseText}`,
            },
          ],
        };
      }

      let result: unknown;

      try {
        result = JSON.parse(responseText);
      } catch {
        result = {
          success: true,
          executionId,
          message: responseText,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
    server.registerTool(
    "updateNotionOpportunity",
    {
      description:
        "Updates one existing Lead Desk OS Light Notion opportunity identified by its exact lead code.",
      inputSchema: z.object({
        leadCode: z.string().min(1),
        workflow: z.enum([
          "Internet Lead",
          "General Engagement",
          "Re-Engagement",
          "Pricing Inquiry",
          "Appointment",
          "Demo/Test Drive",
          "Negotiation",
          "Credit",
          "Contracting",
          "Delivery",
          "Two-Way Contact",
          "Contracted",
        ]),
        stage: z.enum([
          "New Lead",
          "Two-Way Contact",
          "Appointment Set",
          "Showroom Visit",
          "Demo/Test Drive",
          "Quote Presented",
          "Negotiation",
          "Credit Submitted",
          "Contracted",
          "Delivered",
          "Lost",
        ]),
        executionNotes: z.string(),
        nextAction: z.string(),
      }),
    },
    async ({
      leadCode,
      workflow,
      stage,
      executionNotes,
      nextAction,
    }) => {
      const executionId = crypto.randomUUID();

      const response = await fetch(makeGatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stage,
          action: "UpdateNotionOpportunity",
          purpose: "",
          leadCode,
          workflow,
          taskTitle: "",
          nextAction,
          executionId,
          startDateTime: "",
          executionNotes,
          durationMinutes: 0,
          calendarRegistry: "",
        }),
      });

      const responseText = await response.text();

      if (!response.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Notion gateway failed with HTTP ${response.status}: ${responseText}`,
            },
          ],
        };
      }

      let result: unknown;

      try {
        result = JSON.parse(responseText);
      } catch {
        result = {
          success: true,
          executionId,
          message: responseText,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const authorization = request.headers.get("Authorization");
    const expectedAuthorization = `Bearer ${env.LEAD_DESK_API_KEY}`;

    if (authorization !== expectedAuthorization) {
      return new Response("Unauthorized", { status: 401 });
    }

    const makeGatewayUrl = (
      env as Env & { MAKE_GATEWAY_URL: string }
    ).MAKE_GATEWAY_URL;

    const handler = createMcpHandler(() =>
      createServer(makeGatewayUrl),
    );

    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
