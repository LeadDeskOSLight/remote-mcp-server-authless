import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import operatingContextArtifact from "../artifacts/operating-context/1.0.5/operating-context.json";
import { isValidLosAngelesDateTime } from "./calendar-time";
import {
  OPERATING_CONTEXT_SHA256,
  OPERATING_CONTEXT_VERSION,
  RUNTIME_ARTIFACT_ID,
  RUNTIME_MANIFEST_SHA256,
  RUNTIME_TIME_ZONE,
  RUNTIME_VERSION,
  issueContextChallenge,
  issueRuntimePermit,
  permitFingerprint,
  validateContextChallenge,
  validateRuntimePermit,
} from "./runtime-permit";

const OPERATING_CONTEXT_SCHEMA_VERSION = 1;
const DAILY_SESSION_CONTEXT_VERSION = "1.0.0";
const LIGHT_WORKFLOWS = [
  "Internet Lead", "General Engagement", "Re-Engagement", "Pricing Inquiry",
  "Appointment", "Demo/Test Drive", "Negotiation", "Credit", "Contracting", "Delivery",
] as const;
const LIGHT_STAGES = [
  "New Lead", "Two-Way Contact", "Appointment Set", "Showroom Visit", "Demo/Test Drive",
  "Quote Presented", "Negotiation", "Credit Submitted", "Contracted", "Delivered", "Lost",
] as const;

const contextAttestationSchema = z.object({
  internetLeadCadence: z.literal(
    "Co-Video at anchor+1h; Day 2 at anchor+24h; Days 3-7 at 24h intervals; each is a fixed 30-minute Calendar candidate; meaningful response ends cadence",
  ),
  appointmentPreparation: z.literal(
    "Evaluate appointment preparation and qualifying confirmations as fixed 30-minute Calendar candidates",
  ),
  emailDrafting: z.literal(
    "When email is recommended, automatically supply independently copyable subject and body",
  ),
  notesPrecedence: z.literal(
    "Mo's explicit current Notes: override conflicting or stale source-system AI-summary interpretation",
  ),
  notionVerification: z.literal(
    "Create and update require fresh read-back before VERIFIED_SUCCESS",
  ),
  calendarReporting: z.literal(
    "Successful Calendar creation is EXECUTED_UNVERIFIED",
  ),
});

type OperatingContextValidation =
  | { ok: true }
  | { ok: false; errorCode: string; message: string };

const permitTextEncoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", permitTextEncoder.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function validateOperatingContext(): Promise<OperatingContextValidation> {
  if (
    operatingContextArtifact.schemaVersion !== OPERATING_CONTEXT_SCHEMA_VERSION ||
    operatingContextArtifact.operatingContextVersion !==
      OPERATING_CONTEXT_VERSION ||
    operatingContextArtifact.operatingContextSha256 !==
      OPERATING_CONTEXT_SHA256 ||
    operatingContextArtifact.contentType !== "text/markdown" ||
    !operatingContextArtifact.policyMarkdown.trim()
  ) {
    return {
      ok: false,
      errorCode: "OPERATING_CONTEXT_INVALID",
      message: "The approved sales-assistant operating context is unavailable.",
    };
  }

  if (
    !operatingContextArtifact.requiredSections.every((section) =>
      operatingContextArtifact.policyMarkdown.includes(section),
    )
  ) {
    return {
      ok: false,
      errorCode: "OPERATING_CONTEXT_INCOMPLETE",
      message: "The approved sales-assistant operating context is incomplete.",
    };
  }

  if (
    (await sha256Hex(operatingContextArtifact.policyMarkdown)) !==
    OPERATING_CONTEXT_SHA256
  ) {
    return {
      ok: false,
      errorCode: "OPERATING_CONTEXT_INTEGRITY_MISMATCH",
      message: "The sales-assistant operating context failed integrity validation.",
    };
  }

  return { ok: true };
}

function createServer(
  makeGatewayUrl: string,
  makeGatewayKey: string,
  makeRuntimeHealthUrl: string,
  makeRuntimeHealthKey: string,
  runtimePermitSigningKey: string,
) {
  const server = new McpServer({
    name: "Lead Desk OS Light",
    version: RUNTIME_VERSION,
  });

  type ApprovedOpportunity = {
    leadCode: string;
    currentWorkflow: string;
    stage: string;
    executionNotes: string;
    nextAction: string;
  };

  const permitContinuity = async (runtimePermit: string) => ({
    runtimePermit,
    permitFingerprint: await permitFingerprint(runtimePermit),
  });

  const hasMatchingPermitReceipt = (
    result: Record<string, unknown>,
    expectedPermit: string,
    expectedFingerprint: string,
  ) => result.runtimePermit === expectedPermit &&
    result.permitFingerprint === expectedFingerprint;

  const withoutPermitReceipt = (result: Record<string, unknown>) => {
    const {
      runtimePermit: _runtimePermit,
      permitFingerprint: _permitFingerprint,
      ...safeResult
    } = result;
    return safeResult;
  };

  const lookupForVerification = async (runtimePermit: string, leadCode: string): Promise<{
    matchCount: number;
    opportunity?: ApprovedOpportunity;
    errorCode?: string;
  }> => {
    const executionId = crypto.randomUUID();
    const continuity = await permitContinuity(runtimePermit);
    let response: Response;
    try {
      response = await fetch(makeGatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-make-apikey": makeGatewayKey,
        },
        body: JSON.stringify({
          ...continuity,
          stage: "", action: "getNotionOpportunity", purpose: "", leadCode,
          workflow: "", taskTitle: "", nextAction: "", executionId,
          startDateTime: "", executionNotes: "", durationMinutes: 0,
          calendarRegistry: "",
        }),
      });
    } catch { return { matchCount: -1, errorCode: "GATEWAY_CONNECTION_FAILED" }; }
    if (!response.ok) return { matchCount: -1, errorCode: "GATEWAY_HTTP_ERROR" };
    let result: Record<string, unknown>;
    try { result = JSON.parse(await response.text()) as Record<string, unknown>; }
    catch { return { matchCount: -1, errorCode: "INVALID_GATEWAY_RESPONSE" }; }
    if (!hasMatchingPermitReceipt(result, runtimePermit, continuity.permitFingerprint) ||
        result.executionId !== executionId || result.action !== "getNotionOpportunity")
      return { matchCount: -1, errorCode: "INVALID_GATEWAY_CONFIRMATION" };
    if (result.success === false) {
      if (result.errorCode === "NOT_FOUND" && result.matchCount === 0) return { matchCount: 0 };
      if ((result.errorCode === "DUPLICATE_LEAD_CODE" || result.errorCode === "DUPLICATE_OR_AMBIGUOUS") && typeof result.matchCount === "number" && result.matchCount >= 2)
        return { matchCount: result.matchCount };
      return { matchCount: -1, errorCode: "INVALID_GATEWAY_CONFIRMATION" };
    }
    if (result.success !== true || result.executionStatus !== "EXECUTED" || result.matchCount !== 1)
      return { matchCount: -1, errorCode: "INVALID_GATEWAY_CONFIRMATION" };
    const raw = Array.isArray(result.matches) ? result.matches[0] : result.matches;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { matchCount: -1, errorCode: "INVALID_GATEWAY_CONFIRMATION" };
    const properties = (raw as Record<string, unknown>).properties_value ?? (raw as Record<string, unknown>)["Properties Value"];
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return { matchCount: -1, errorCode: "INVALID_GATEWAY_CONFIRMATION" };
    const p = properties as Record<string, unknown>;
    const select = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).name === "string" ? (value as Record<string, unknown>).name as string : "";
    const text = (value: unknown) => {
      if (typeof value === "string") return value;
      if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return "";
      const item = value[0] as Record<string, unknown>;
      if (typeof item.plain_text === "string") return item.plain_text;
      const nested = item.text;
      return nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).content === "string" ? (nested as Record<string, unknown>).content as string : "";
    };
    const opportunity = {
      leadCode: text(p["Lead Code"]), currentWorkflow: select(p["Current Workflow"]),
      stage: select(p.Stage), executionNotes: text(p["Execution Notes"]), nextAction: text(p["Next Action"]),
    };
    return opportunity.leadCode === leadCode ? { matchCount: 1, opportunity } : { matchCount: -1, errorCode: "INVALID_GATEWAY_CONFIRMATION" };
  };

  const requireRuntimePermit = async (
    runtimePermit: string,
    action: string,
  ) => {
    const validation = await validateRuntimePermit(
      runtimePermit,
      runtimePermitSigningKey,
    );
    if (validation.ok) return null;

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            action,
            executionStatus: "REJECTED",
            errorCode: validation.errorCode,
            message: validation.message,
            permitFingerprint: validation.permitFingerprint,
          }),
        },
      ],
    };
  };

  server.registerTool(
    "executePackageTest",
    {
      description:
        "Tests whether ChatGPT can reach the Lead Desk OS Light MCP server.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        runtimePermit: z.string().min(1),
        taskTitle: z.string().min(1),
        startDateTime: z.string().refine(isValidLosAngelesDateTime, {
          message:
            "Use an RFC 3339 timestamp whose explicit offset matches America/Los_Angeles; nonexistent or mismatched DST times are rejected.",
        }),
        purpose: z.string().optional(),
        leadCode: z.string().optional(),
        executionNotes: z.string().optional(),
        nextAction: z.string().optional(),
      }),
    },
    async ({
      runtimePermit,
      taskTitle,
      startDateTime,
      purpose,
      leadCode,
      executionNotes,
      nextAction,
    }) => {
      const permitError = await requireRuntimePermit(
        runtimePermit,
        "createCalendarEvent",
      );
      if (permitError) return permitError;

      const executionId = crypto.randomUUID();
      const continuity = await permitContinuity(runtimePermit);

      const response = await fetch(makeGatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-make-apikey": makeGatewayKey,
        },
        body: JSON.stringify({
          ...continuity,
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
          calendarRegistry: "Lead Desk OS Light",
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
        gatewayResult.executionStatus !== "EXECUTED" ||
        !hasMatchingPermitReceipt(gatewayResult, runtimePermit, continuity.permitFingerprint)
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
            text: JSON.stringify({
              ...withoutPermitReceipt(gatewayResult),
              success: true,
              executionStatus: "EXECUTED_UNVERIFIED",
              verificationStatus: "UNVERIFIED",
              message:
                "Calendar event creation was executed but is unverified because Light has no Calendar read-back capability.",
            }),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        runtimePermit: z.string().min(1),
        leadCode: z.string().trim().min(1),
        workflow: z.enum(LIGHT_WORKFLOWS),
        stage: z.enum(LIGHT_STAGES),
        executionNotes: z.string().optional(),
        nextAction: z.string().optional(),
      }),
    },
    async ({
      runtimePermit,
      leadCode,
      workflow,
      stage,
      executionNotes,
      nextAction,
    }) => {
      const permitError = await requireRuntimePermit(
        runtimePermit,
        "createNotionOpportunity",
      );
      if (permitError) return permitError;

      const preflight = await lookupForVerification(runtimePermit, leadCode);
      if (preflight.errorCode) return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ success: false, action: "createNotionOpportunity", executionStatus: "REJECTED", errorCode: preflight.errorCode, message: "Fresh exact Lead Code preflight could not be verified. No create was attempted." }) }],
      };
      if (preflight.matchCount !== 0) return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ success: false, action: "createNotionOpportunity", executionStatus: "REJECTED", errorCode: preflight.matchCount === 1 ? "OPPORTUNITY_ALREADY_EXISTS" : "DUPLICATE_LEAD_CODE", matchCount: preflight.matchCount, message: "Create requires exactly zero fresh Lead Code matches. No create was attempted." }) }],
      };

      const executionId = crypto.randomUUID();
      const continuity = await permitContinuity(runtimePermit);

      const response = await fetch(makeGatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-make-apikey": makeGatewayKey,
        },
        body: JSON.stringify({
          ...continuity,
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
  !hasMatchingPermitReceipt(gatewayResult, runtimePermit, continuity.permitFingerprint) ||
  gatewayResult.executionId !== executionId ||
  gatewayResult.action !== "createNotionOpportunity"
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
            "The Notion gateway returned a mismatched execution confirmation. Opportunity creation is not confirmed.",
        }),
      },
    ],
  };
}

if (gatewayResult.success === false) {
  const validAlreadyExists =
    gatewayResult.executionStatus === "REJECTED" &&
    gatewayResult.errorCode === "OPPORTUNITY_ALREADY_EXISTS" &&
    gatewayResult.matchCount === 1;

  const validDuplicateLeadCode =
    gatewayResult.executionStatus === "REJECTED" &&
    gatewayResult.errorCode === "DUPLICATE_LEAD_CODE" &&
    typeof gatewayResult.matchCount === "number" &&
    gatewayResult.matchCount >= 2;

  if (!validAlreadyExists && !validDuplicateLeadCode) {
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
              "The Notion gateway returned an invalid rejection confirmation. Opportunity creation is not confirmed.",
          }),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(withoutPermitReceipt(gatewayResult)),
      },
    ],
  };
}

if (
  gatewayResult.success !== true ||
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

const verifiedCreate = await lookupForVerification(runtimePermit, leadCode);
const expectedCreate = {
  leadCode,
  currentWorkflow: workflow,
  stage,
  executionNotes: executionNotes ?? "",
  nextAction: nextAction ?? "",
};
if (verifiedCreate.matchCount !== 1 || !verifiedCreate.opportunity ||
  Object.entries(expectedCreate).some(([key, value]) => verifiedCreate.opportunity?.[key as keyof ApprovedOpportunity] !== value)) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ success: false, executionId, action: "createNotionOpportunity", executionStatus: "EXECUTED_UNVERIFIED", errorCode: verifiedCreate.errorCode ?? "READ_BACK_MISMATCH", message: "Create executed, but fresh read-back did not match every expected field. Do not retry automatically." }) }],
  };
}

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...withoutPermitReceipt(gatewayResult), executionStatus: "VERIFIED_SUCCESS", verificationStatus: "VERIFIED_SUCCESS", opportunity: verifiedCreate.opportunity }),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        runtimePermit: z.string().min(1),
        leadCode: z.string().trim().min(1),
        workflow: z.enum(LIGHT_WORKFLOWS).optional(),
        stage: z.enum(LIGHT_STAGES).optional(),
        executionNotes: z.string().min(1).optional(),
        nextAction: z.string().min(1).optional(),
      }).refine(
        (value) => value.workflow !== undefined || value.stage !== undefined ||
          value.executionNotes !== undefined || value.nextAction !== undefined,
        { message: "At least one non-empty approved field change is required." },
      ),
    },
    async ({
      runtimePermit,
      leadCode,
      workflow,
      stage,
      executionNotes,
      nextAction,
    }) => {
      const permitError = await requireRuntimePermit(
        runtimePermit,
        "updateNotionOpportunity",
      );
      if (permitError) return permitError;

      const beforeUpdate = await lookupForVerification(runtimePermit, leadCode);
      if (beforeUpdate.matchCount !== 1 || !beforeUpdate.opportunity) return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ success: false, action: "updateNotionOpportunity", executionStatus: "REJECTED", errorCode: beforeUpdate.errorCode ?? (beforeUpdate.matchCount === 0 ? "NOT_FOUND" : "DUPLICATE_LEAD_CODE"), matchCount: beforeUpdate.matchCount, message: "Update requires exactly one fresh Lead Code match. No update was attempted." }) }],
      };

      const executionId = crypto.randomUUID();
      const continuity = await permitContinuity(runtimePermit);

      const response = await fetch(makeGatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-make-apikey": makeGatewayKey,
        },
        body: JSON.stringify({
          ...continuity,
          action: "updateNotionOpportunity",
          purpose: "",
          leadCode,
          taskTitle: "",
          executionId,
          startDateTime: "",
          durationMinutes: 0,
          calendarRegistry: "",
          ...(stage !== undefined ? { stage } : {}),
          ...(workflow !== undefined ? { workflow } : {}),
          ...(nextAction !== undefined ? { nextAction } : {}),
          ...(executionNotes !== undefined ? { executionNotes } : {}),
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
  !hasMatchingPermitReceipt(gatewayResult, runtimePermit, continuity.permitFingerprint) ||
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
const afterUpdate = await lookupForVerification(runtimePermit, leadCode);
const expectedUpdate: ApprovedOpportunity = {
  ...beforeUpdate.opportunity,
  ...(workflow !== undefined ? { currentWorkflow: workflow } : {}),
  ...(stage !== undefined ? { stage } : {}),
  ...(executionNotes !== undefined ? { executionNotes } : {}),
  ...(nextAction !== undefined ? { nextAction } : {}),
};
if (afterUpdate.matchCount !== 1 || !afterUpdate.opportunity ||
  Object.entries(expectedUpdate).some(([key, value]) => afterUpdate.opportunity?.[key as keyof ApprovedOpportunity] !== value)) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ success: false, executionId, action: "updateNotionOpportunity", executionStatus: "EXECUTED_UNVERIFIED", errorCode: afterUpdate.errorCode ?? "READ_BACK_MISMATCH", message: "Update executed, but fresh read-back did not match changed and unchanged approved fields. Do not retry automatically." }) }],
  };
}
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...withoutPermitReceipt(gatewayResult), executionStatus: "VERIFIED_SUCCESS", verificationStatus: "VERIFIED_SUCCESS", opportunity: afterUpdate.opportunity }),
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        runtimePermit: z.string().min(1),
        leadCode: z.string().trim().min(1),
      }),
    },
    async ({ runtimePermit, leadCode }) => {
      const action = "getNotionOpportunity";
      const permitError = await requireRuntimePermit(runtimePermit, action);
      if (permitError) return permitError;

      const executionId = crypto.randomUUID();
      const continuity = await permitContinuity(runtimePermit);

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
            "x-make-apikey": makeGatewayKey,
          },
          body: JSON.stringify({
            ...continuity,
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
        !hasMatchingPermitReceipt(gatewayResult, runtimePermit, continuity.permitFingerprint) ||
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
          (errorCode === "DUPLICATE_LEAD_CODE" ||
            errorCode === "DUPLICATE_OR_AMBIGUOUS") &&
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
              text: JSON.stringify(
                validDuplicate
                  ? {
                      ...withoutPermitReceipt(gatewayResult),
                      errorCode: "DUPLICATE_LEAD_CODE",
                      message:
                        "Multiple opportunities share the requested lead code. No record was selected.",
                    }
                  : withoutPermitReceipt(gatewayResult),
              ),
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
  server.registerTool(
  "initializeLeadDeskRuntime",
  {
    description:
      "Starts Lead Desk OS Light for a fresh conversation by validating technical readiness, installing the complete approved Sales Assistant Operating Context, establishing daily session context, and issuing a runtime permit only when both readiness dimensions are READY.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: z.object({
      requestedOperatingMode: z.literal("PRODUCTION"),
      clientTimeZone: z.literal("America/Los_Angeles"),
      installationChallenge: z.string().optional(),
      contextAttestation: contextAttestationSchema.optional(),
    }),
  },
    async ({ requestedOperatingMode, clientTimeZone, installationChallenge, contextAttestation }) => {
  const executionId = crypto.randomUUID();
  const action = "initializeLeadDeskRuntime";
  const artifactId = RUNTIME_ARTIFACT_ID;
  const manifestSha256 = RUNTIME_MANIFEST_SHA256;
  const requestedAt = new Date().toISOString();
  const operatingContextValidation = await validateOperatingContext();
  const operationalContextStatus = operatingContextValidation.ok
    ? "READY"
    : "NOT_READY";

  if (!makeGatewayKey) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "NOT_READY",
          operationalContextStatus,
          errorCode: "MAKE_GATEWAY_AUTH_CONFIGURATION_ERROR",
          message: "The certified action gateway authentication key is not configured.",
        }),
      }],
    };
  }

  if (!runtimePermitSigningKey) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            executionId,
            action,
            runtimeStatus: "NOT_READY",
            technicalReadiness: "NOT_READY",
            operationalContextStatus,
            errorCode: "RUNTIME_PERMIT_CONFIGURATION_ERROR",
            message: "Runtime permit signing is not configured.",
          }),
        },
      ],
    };
  }

  const response = await fetch(makeRuntimeHealthUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-make-apikey": makeRuntimeHealthKey,
    },
    body: JSON.stringify({
      action,
      executionId,
      artifactId,
      manifestSha256,
      requestedAt,
    }),
  });

  const responseText = await response.text();
      if (!response.ok) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "NOT_READY",
          operationalContextStatus,
          errorCode: "RUNTIME_HEALTH_HTTP_ERROR",
          message: `Runtime health endpoint returned HTTP ${response.status}.`,
        }),
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
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "NOT_READY",
          operationalContextStatus,
          errorCode: "INVALID_RUNTIME_HEALTH_RESPONSE",
          message: "Runtime health endpoint returned invalid JSON.",
        }),
      },
    ],
  };
}
      if (
  typeof result !== "object" ||
  result === null ||
  Array.isArray(result)
) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "NOT_READY",
          operationalContextStatus,
          errorCode: "INVALID_RUNTIME_HEALTH_RESPONSE",
          message: "Runtime health endpoint returned an invalid response object.",
        }),
      },
    ],
  };
}

const runtimeResult = result as {
  success?: boolean;
  executionId?: string;
  action?: string;
  runtimeStatus?: string;
  artifactId?: string;
  manifestSha256?: string;
  checks?: {
    notion?: string;
    calendar?: string;
  };
};

if (
  runtimeResult.executionId !== executionId ||
  runtimeResult.action !== action ||
  runtimeResult.artifactId !== artifactId ||
  runtimeResult.manifestSha256 !== manifestSha256
) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "NOT_READY",
          operationalContextStatus,
          errorCode: "INVALID_RUNTIME_HEALTH_CONFIRMATION",
          message: "Runtime health endpoint returned a mismatched confirmation.",
        }),
      },
    ],
  };
}
      if (
  runtimeResult.success !== true ||
  runtimeResult.runtimeStatus !== "READY" ||
  typeof runtimeResult.checks !== "object" ||
  runtimeResult.checks === null ||
  runtimeResult.checks.notion !== "READY" ||
  runtimeResult.checks.calendar !== "READY"
) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "NOT_READY",
          operationalContextStatus,
          errorCode: "RUNTIME_NOT_READY",
          message: "Runtime health checks did not confirm full readiness.",
        }),
      },
    ],
  };
}

if (!operatingContextValidation.ok) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "READY",
          operationalContextStatus: "NOT_READY",
          errorCode: operatingContextValidation.errorCode,
          message: operatingContextValidation.message,
        }),
      },
    ],
  };
}

if (!installationChallenge || !contextAttestation) {
  const challenge = await issueContextChallenge(runtimePermitSigningKey);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          executionId,
          action,
          runtimeStatus: "NOT_READY",
          technicalReadiness: "READY",
          operationalContextStatus: "INSTALLATION_REQUIRED",
          errorCode: "OPERATING_CONTEXT_INSTALLATION_REQUIRED",
          message:
            "Read and apply the complete Operating Context, then call initialization again with the challenge and all attestation answers. Production handling remains blocked.",
          installationChallenge: challenge,
          operatingContext: {
            schemaVersion: operatingContextArtifact.schemaVersion,
            operatingContextVersion: operatingContextArtifact.operatingContextVersion,
            operatingContextSha256: operatingContextArtifact.operatingContextSha256,
            contentType: operatingContextArtifact.contentType,
            policyMarkdown: operatingContextArtifact.policyMarkdown,
          },
          attestationInstructions: {
            internetLeadCadence:
              "State the exact Co-Video, Day 2, Day 3-7, duration, Calendar-candidate, and termination rule.",
            appointmentPreparation:
              "State how appointment preparation and qualifying confirmations are evaluated for Calendar.",
            emailDrafting:
              "State what must be supplied automatically when email is recommended.",
            notesPrecedence:
              "State the source precedence rule for Mo's Notes: and an AI summary.",
            notionVerification:
              "State the verification requirement for Notion create/update.",
            calendarReporting:
              "State the reporting status after successful Calendar creation.",
          },
        }),
      },
    ],
  };
}

if (!(await validateContextChallenge(installationChallenge, runtimePermitSigningKey))) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        success: false,
        executionId,
        action,
        runtimeStatus: "NOT_READY",
        technicalReadiness: "READY",
        operationalContextStatus: "NOT_READY",
        errorCode: "OPERATING_CONTEXT_ATTESTATION_INVALID",
        message: "The Operating Context installation challenge is invalid or expired. Reinitialize to receive the complete current context again.",
      }),
    }],
  };
}

const { runtimePermit, claims, permitFingerprint } = await issueRuntimePermit(
  runtimePermitSigningKey,
);
const permitIssuedAt = new Date(claims.issuedAt * 1000).toISOString();
const permitExpiresAt = new Date(claims.expiresAt * 1000).toISOString();

return {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        ...runtimeResult,
        requestedOperatingMode,
        clientTimeZone,
        runtimeStatus: "READY",
        technicalReadiness: "READY",
        operationalContextStatus: "READY",
        businessDate: claims.businessDate,
        timeZone: RUNTIME_TIME_ZONE,
        dailySessionContextVersion: DAILY_SESSION_CONTEXT_VERSION,
        dailySessionContext: {
          businessDate: claims.businessDate,
          timeZone: RUNTIME_TIME_ZONE,
          technicalReadiness: "READY",
          operationalContextStatus: "READY",
          checks: runtimeResult.checks,
          permitIssuedAt,
          permitExpiresAt,
        },
        operatingContext: {
          schemaVersion: operatingContextArtifact.schemaVersion,
          operatingContextVersion:
            operatingContextArtifact.operatingContextVersion,
          operatingContextSha256:
            operatingContextArtifact.operatingContextSha256,
          contentType: operatingContextArtifact.contentType,
          policyMarkdown: operatingContextArtifact.policyMarkdown,
        },
        permitIssuedAt,
        permitExpiresAt,
        permitFingerprint,
        runtimePermit,
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
    const workerEnv = env as Env & {
      LEAD_DESK_API_KEY: string;
      MAKE_GATEWAY_URL: string;
      MAKE_GATEWAY_KEY: string;
      MAKE_RUNTIME_HEALTH_URL: string;
      MAKE_RUNTIME_HEALTH_KEY: string;
      LEAD_DESK_RUNTIME_SIGNING_KEY: string;
    };
    const authorization = request.headers.get("Authorization");
    const expectedAuthorization = `Bearer ${workerEnv.LEAD_DESK_API_KEY}`;

    if (authorization !== expectedAuthorization) {
      return new Response("Unauthorized", { status: 401 });
    }

const makeGatewayUrl = workerEnv.MAKE_GATEWAY_URL;
const makeGatewayKey = workerEnv.MAKE_GATEWAY_KEY;
const makeRuntimeHealthUrl = workerEnv.MAKE_RUNTIME_HEALTH_URL;
const makeRuntimeHealthKey = workerEnv.MAKE_RUNTIME_HEALTH_KEY;
const runtimePermitSigningKey = workerEnv.LEAD_DESK_RUNTIME_SIGNING_KEY;

const handler = createMcpHandler(() =>
  createServer(
    makeGatewayUrl,
    makeGatewayKey,
    makeRuntimeHealthUrl,
    makeRuntimeHealthKey,
    runtimePermitSigningKey,
  ),
);

    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
