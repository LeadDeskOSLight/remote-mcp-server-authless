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
    "createCalendarEvent",
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
          action: "createCalendarEvent",
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
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action: "createCalendarEvent",
          executionStatus: "FAILED",
          errorCode: "INVALID_GATEWAY_RESPONSE",
          message:
            "The Calendar gateway returned an invalid response. Calendar creation is not confirmed.",
        }),
      },
    ],
  };
}
      const gatewayResult = result as Record<string, unknown>;

      if (
        gatewayResult.success !== true ||
        gatewayResult.executionId !== executionId ||
        gatewayResult.action !== "createCalendarEvent" ||
        gatewayResult.executionStatus !== "EXECUTED"
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                executionId,
                action: "createCalendarEvent",
                executionStatus: "FAILED",
                errorCode: "INVALID_GATEWAY_CONFIRMATION",
                message:
                  "The Calendar gateway did not provide a valid matching execution confirmation. Calendar creation is not confirmed.",
              }),
            },
          ],
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
          action: "createNotionOpportunity",
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
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action: "createNotionOpportunity",
          executionStatus: "FAILED",
          errorCode: "INVALID_GATEWAY_RESPONSE",
          message:
            "The Notion gateway returned an invalid response. Opportunity creation is not confirmed.",
        }),
      },
    ],
  };
}
const gatewayResult = result as Record<string, unknown>;

if (
  gatewayResult.success !== true ||
  gatewayResult.executionId !== executionId ||
  gatewayResult.action !== "createNotionOpportunity" ||
  gatewayResult.executionStatus !== "EXECUTED"
) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action: "createNotionOpportunity",
          executionStatus: "FAILED",
          errorCode: "INVALID_GATEWAY_CONFIRMATION",
          message:
            "The Notion gateway did not provide a valid matching execution confirmation. Opportunity creation is not confirmed.",
        }),
      },
    ],
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
          action: "updateNotionOpportunity",
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
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action: "updateNotionOpportunity",
          executionStatus: "FAILED",
          errorCode: "INVALID_GATEWAY_RESPONSE",
          message:
            "The Notion gateway returned an invalid response. Opportunity update is not confirmed.",
        }),
      },
    ],
  };
}
const gatewayResult = result as Record<string, unknown>;

if (
  gatewayResult.success !== true ||
  gatewayResult.executionId !== executionId ||
  gatewayResult.action !== "updateNotionOpportunity" ||
  gatewayResult.executionStatus !== "EXECUTED"
) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action: "updateNotionOpportunity",
          executionStatus: "FAILED",
          errorCode: "INVALID_GATEWAY_CONFIRMATION",
          message:
            "The Notion gateway did not provide a valid matching execution confirmation. Opportunity update is not confirmed.",
        }),
      },
    ],
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
    "getNotionOpportunity",
    {
      description:
        "Retrieves the approved fields for one Lead Desk OS Light Notion opportunity identified by its exact lead code.",
      inputSchema: z.object({
        leadCode: z.string().trim().min(1),
      }),
    },
    async ({ leadCode }) => {
      const executionId = crypto.randomUUID();
      const action = "getNotionOpportunity";

      const failure = (
        errorCode: string,
        message: string,
      ) => ({
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              executionId,
              action,
              executionStatus: "FAILED",
              errorCode,
              message,
            }),
          },
        ],
      });

      let response: Response;

      try {
        response = await fetch(makeGatewayUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stage: "",
            action,
            purpose: "",
            leadCode,
            workflow: "",
            taskTitle: "",
            nextAction: "",
            executionId,
            startDateTime: "",
            executionNotes: "",
            durationMinutes: 0,
            calendarRegistry: "",
          }),
        });
      } catch {
        return failure(
          "GATEWAY_CONNECTION_FAILED",
          "The Notion gateway could not be reached.",
        );
      }

      const responseText = await response.text();

      if (!response.ok) {
        return failure(
          "GATEWAY_HTTP_ERROR",
          `The Notion gateway returned HTTP ${response.status}.`,
        );
      }

      let result: unknown;

      try {
        result = JSON.parse(responseText);
      } catch {
        return failure(
          "INVALID_GATEWAY_RESPONSE",
          "The Notion gateway returned invalid JSON.",
        );
      }

      if (
        typeof result !== "object" ||
        result === null ||
        Array.isArray(result)
      ) {
        return failure(
          "INVALID_GATEWAY_RESPONSE",
          "The Notion gateway returned an invalid response object.",
        );
      }

      const gatewayResult = result as Record<string, unknown>;

      if (
        gatewayResult.executionId !== executionId ||
        gatewayResult.action !== action
      ) {
        return failure(
          "INVALID_GATEWAY_CONFIRMATION",
          "The Notion gateway returned a mismatched execution confirmation.",
        );
      }

      if (gatewayResult.success === false) {
        const errorCode = gatewayResult.errorCode;
        const matchCount = gatewayResult.matchCount;

        const validNotFound =
          gatewayResult.executionStatus === "FAILED" &&
          errorCode === "NOT_FOUND" &&
          matchCount === 0;

        const validDuplicate =
          gatewayResult.executionStatus === "FAILED" &&
          errorCode === "DUPLICATE_OR_AMBIGUOUS" &&
          typeof matchCount === "number" &&
          matchCount >= 2;

        if (!validNotFound && !validDuplicate) {
          return failure(
            "INVALID_GATEWAY_CONFIRMATION",
            "The Notion gateway returned an invalid failure confirmation.",
          );
        }

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(gatewayResult),
            },
          ],
        };
      }

      if (
        gatewayResult.success !== true ||
        gatewayResult.executionStatus !== "EXECUTED" ||
        gatewayResult.matchCount !== 1
      ) {
        return failure(
          "INVALID_GATEWAY_CONFIRMATION",
          "The Notion gateway did not confirm exactly one opportunity.",
        );
      }

      const rawMatches = gatewayResult.matches;
      const match = Array.isArray(rawMatches)
        ? rawMatches[0]
        : rawMatches;

      if (
        typeof match !== "object" ||
        match === null ||
        Array.isArray(match)
      ) {
        return failure(
          "INVALID_GATEWAY_CONFIRMATION",
          "The Notion gateway did not return one readable opportunity.",
        );
      }

      const matchRecord = match as Record<string, unknown>;
      const rawProperties =
        matchRecord.properties_value ??
        matchRecord["Properties Value"];

      if (
        typeof rawProperties !== "object" ||
        rawProperties === null ||
        Array.isArray(rawProperties)
      ) {
        return failure(
          "INVALID_GATEWAY_CONFIRMATION",
          "The Notion gateway returned invalid opportunity properties.",
        );
      }

      const properties = rawProperties as Record<string, unknown>;

      const selectName = (value: unknown): string => {
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          const name = (value as Record<string, unknown>).name;
          return typeof name === "string" ? name : "";
        }
        return "";
      };

      const plainText = (value: unknown): string => {
        if (typeof value === "string") return value;
        if (!Array.isArray(value) || value.length === 0) return "";

        const first = value[0];

        if (
          typeof first !== "object" ||
          first === null ||
          Array.isArray(first)
        ) {
          return "";
        }

        const item = first as Record<string, unknown>;

        if (typeof item.plain_text === "string") {
          return item.plain_text;
        }

        const text = item.text;

        if (
          typeof text === "object" &&
          text !== null &&
          !Array.isArray(text)
        ) {
          const content = (text as Record<string, unknown>).content;
          return typeof content === "string" ? content : "";
        }

        return "";
      };

      const opportunity = {
        leadCode: plainText(properties["Lead Code"]),
        currentWorkflow: selectName(properties["Current Workflow"]),
        stage: selectName(properties.Stage),
        executionNotes: plainText(properties["Execution Notes"]),
        nextAction: plainText(properties["Next Action"]),
        calendarRegistry: plainText(properties["Calendar Registry"]),
      };

      if (opportunity.leadCode !== leadCode) {
        return failure(
          "INVALID_GATEWAY_CONFIRMATION",
          "The returned opportunity did not match the requested lead code.",
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              executionId,
              action,
              executionStatus: "EXECUTED",
              message: "Opportunity retrieved successfully.",
              matchCount: 1,
              opportunity,
            }),
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
