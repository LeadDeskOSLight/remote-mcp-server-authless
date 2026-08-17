import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import operatingContextArtifact from "../artifacts/operating-context/1.0.2/operating-context.json";

const RUNTIME_ARTIFACT_ID = "2026-08-14-a75f0495";
const RUNTIME_MANIFEST_SHA256 =
  "fb54d7c6823a945b4ddbd6e8b87803ef64d672390f48fbb389327f53d6956baf";
const RUNTIME_VERSION = "1.0.0";
const RUNTIME_TIME_ZONE = "America/Los_Angeles";
const MAX_PERMIT_LIFETIME_MS = 60 * 60 * 1000;
const OPERATING_CONTEXT_SCHEMA_VERSION = 1;
const OPERATING_CONTEXT_VERSION = "1.0.2";
const OPERATING_CONTEXT_SHA256 =
  "a10ddae9c1f34eab3200cdf849dcba8726566a773b0fa1e06b3a1dfc68dfbd31";
const DAILY_SESSION_CONTEXT_VERSION = "1.0.0";

type OperatingContextValidation =
  | { ok: true }
  | { ok: false; errorCode: string; message: string };

type RuntimePermitClaims = {
  version: 1;
  runtimeVersion: string;
  artifactId: string;
  manifestSha256: string;
  operatingContextVersion: string;
  operatingContextSha256: string;
  operatingMode: "PRODUCTION";
  readiness: "READY";
  businessDate: string;
  issuedAt: number;
  expiresAt: number;
  permitId: string;
};

type PermitValidation =
  | { ok: true; claims: RuntimePermitClaims }
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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importPermitKey(signingKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    permitTextEncoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function losAngelesParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RUNTIME_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function losAngelesBusinessDate(date: Date): string {
  const { year, month, day } = losAngelesParts(date);
  return (
    String(year) +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

function losAngelesOffsetMs(date: Date): number {
  const parts = losAngelesParts(date);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function nextLosAngelesDayBoundary(date: Date): Date {
  const current = losAngelesParts(date);
  const nextLocalDate = new Date(
    Date.UTC(current.year, current.month - 1, current.day + 1),
  );
  const targetAsUtc = Date.UTC(
    nextLocalDate.getUTCFullYear(),
    nextLocalDate.getUTCMonth(),
    nextLocalDate.getUTCDate(),
  );

  let candidate = new Date(targetAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = new Date(targetAsUtc - losAngelesOffsetMs(candidate));
  }
  return candidate;
}

async function issueRuntimePermit(
  signingKey: string,
  now = new Date(),
): Promise<{ runtimePermit: string; claims: RuntimePermitClaims }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const maximumExpiry = now.getTime() + MAX_PERMIT_LIFETIME_MS;
  const dayBoundary = nextLosAngelesDayBoundary(now).getTime();
  const expiresAt = Math.floor(Math.min(maximumExpiry, dayBoundary) / 1000);

  const claims: RuntimePermitClaims = {
    version: 1,
    runtimeVersion: RUNTIME_VERSION,
    artifactId: RUNTIME_ARTIFACT_ID,
    manifestSha256: RUNTIME_MANIFEST_SHA256,
    operatingContextVersion: OPERATING_CONTEXT_VERSION,
    operatingContextSha256: OPERATING_CONTEXT_SHA256,
    operatingMode: "PRODUCTION",
    readiness: "READY",
    businessDate: losAngelesBusinessDate(now),
    issuedAt,
    expiresAt,
    permitId: crypto.randomUUID(),
  };

  const encodedClaims = base64UrlEncode(
    permitTextEncoder.encode(JSON.stringify(claims)),
  );
  const key = await importPermitKey(signingKey);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      permitTextEncoder.encode("v1." + encodedClaims),
    ),
  );

  return {
    runtimePermit:
      "v1." + encodedClaims + "." + base64UrlEncode(signature),
    claims,
  };
}

async function validateRuntimePermit(
  runtimePermit: string,
  signingKey: string,
  now = new Date(),
): Promise<PermitValidation> {
  if (!signingKey) {
    return {
      ok: false,
      errorCode: "RUNTIME_PERMIT_CONFIGURATION_ERROR",
      message: "Runtime permit validation is unavailable.",
    };
  }

  try {
    const [prefix, encodedClaims, encodedSignature, extra] =
      runtimePermit.split(".");
    if (prefix !== "v1" || !encodedClaims || !encodedSignature || extra) {
      throw new Error("Malformed permit");
    }

    const key = await importPermitKey(signingKey);
    const signatureValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(encodedSignature),
      permitTextEncoder.encode("v1." + encodedClaims),
    );
    if (!signatureValid) {
      return {
        ok: false,
        errorCode: "RUNTIME_PERMIT_TAMPERED",
        message: "The runtime permit signature is invalid.",
      };
    }

    const claims = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedClaims)),
    ) as RuntimePermitClaims;
    const nowSeconds = Math.floor(now.getTime() / 1000);

    if (
      claims.version !== 1 ||
      claims.runtimeVersion !== RUNTIME_VERSION ||
      claims.artifactId !== RUNTIME_ARTIFACT_ID ||
      claims.manifestSha256 !== RUNTIME_MANIFEST_SHA256 ||
      claims.operatingContextVersion !== OPERATING_CONTEXT_VERSION ||
      claims.operatingContextSha256 !== OPERATING_CONTEXT_SHA256
    ) {
      return {
        ok: false,
        errorCode: "RUNTIME_PERMIT_VERSION_MISMATCH",
        message: "The runtime permit does not match the certified runtime.",
      };
    }

    if (
      claims.operatingMode !== "PRODUCTION" ||
      claims.readiness !== "READY"
    ) {
      return {
        ok: false,
        errorCode: "RUNTIME_PERMIT_MODE_MISMATCH",
        message: "The runtime permit is not valid for production operation.",
      };
    }

    if (claims.businessDate !== losAngelesBusinessDate(now)) {
      return {
        ok: false,
        errorCode: "RUNTIME_PERMIT_WRONG_DAY",
        message:
          "The runtime permit is not valid for the current Los Angeles business date.",
      };
    }

    if (
      !Number.isInteger(claims.issuedAt) ||
      !Number.isInteger(claims.expiresAt) ||
      claims.expiresAt <= claims.issuedAt ||
      claims.expiresAt - claims.issuedAt > MAX_PERMIT_LIFETIME_MS / 1000 ||
      nowSeconds >= claims.expiresAt
    ) {
      return {
        ok: false,
        errorCode: "RUNTIME_PERMIT_EXPIRED",
        message: "The runtime permit has expired or has an invalid lifetime.",
      };
    }

    return { ok: true, claims };
  } catch {
    return {
      ok: false,
      errorCode: "INVALID_RUNTIME_PERMIT",
      message: "The runtime permit is malformed.",
    };
  }
}


function createServer(
  makeGatewayUrl: string,
  makeRuntimeHealthUrl: string,
  makeRuntimeHealthKey: string,
  runtimePermitSigningKey: string,
) {
  const server = new McpServer({
    name: "Lead Desk OS Light",
    version: RUNTIME_VERSION,
  });

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
        startDateTime: z.string().min(1),
        purpose: z.string().optional(),
        leadCode: z.string().optional(),
        executionNotes: z.string().optional(),
        nextAction: z.string().optional(),
        calendarRegistry: z.string().optional(),
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
      calendarRegistry,
    }) => {
      const permitError = await requireRuntimePermit(
        runtimePermit,
        "createCalendarEvent",
      );
      if (permitError) return permitError;

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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        runtimePermit: z.string().min(1),
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
        text: JSON.stringify(gatewayResult),
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(gatewayResult),
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
                      ...gatewayResult,
                      errorCode: "DUPLICATE_LEAD_CODE",
                      message:
                        "Multiple opportunities share the requested lead code. No record was selected.",
                    }
                  : gatewayResult,
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
    }),
  },
    async ({ requestedOperatingMode, clientTimeZone }) => {
  const executionId = crypto.randomUUID();
  const action = "initializeLeadDeskRuntime";
  const artifactId = RUNTIME_ARTIFACT_ID;
  const manifestSha256 = RUNTIME_MANIFEST_SHA256;
  const requestedAt = new Date().toISOString();
  const operatingContextValidation = await validateOperatingContext();
  const operationalContextStatus = operatingContextValidation.ok
    ? "READY"
    : "NOT_READY";

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

const { runtimePermit, claims } = await issueRuntimePermit(
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
const makeRuntimeHealthUrl = workerEnv.MAKE_RUNTIME_HEALTH_URL;
const makeRuntimeHealthKey = workerEnv.MAKE_RUNTIME_HEALTH_KEY;
const runtimePermitSigningKey = workerEnv.LEAD_DESK_RUNTIME_SIGNING_KEY;

const handler = createMcpHandler(() =>
  createServer(
    makeGatewayUrl,
    makeRuntimeHealthUrl,
    makeRuntimeHealthKey,
    runtimePermitSigningKey,
  ),
);

    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
