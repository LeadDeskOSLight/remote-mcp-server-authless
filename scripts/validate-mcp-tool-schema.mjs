import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const ATTESTATION_FIELDS = [
  "internetLeadCadence",
  "appointmentPreparation",
  "emailDrafting",
  "notesPrecedence",
  "notionVerification",
  "calendarReporting",
];

function parseMcpPayload(contentType, text) {
  if (contentType.includes("text/event-stream")) {
    const messages = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5).trim()));
    const response = messages.find((message) => message.result || message.error);
    if (!response) throw new Error("MCP response did not contain a JSON-RPC result.");
    return response;
  }
  return JSON.parse(text);
}

async function postMcp(url, apiKey, body, sessionId) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${text}`);
  return {
    payload: text ? parseMcpPayload(response.headers.get("content-type") ?? "", text) : null,
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
  };
}

export function assertInitializeSchema(payload) {
  if (payload?.error) throw new Error(`tools/list failed: ${JSON.stringify(payload.error)}`);
  const tool = payload?.result?.tools?.find((candidate) => candidate.name === "initializeLeadDeskRuntime");
  if (!tool) throw new Error("initializeLeadDeskRuntime is not advertised.");
  const properties = tool.inputSchema?.properties ?? {};
  for (const field of ["requestedOperatingMode", "clientTimeZone", "installationChallenge", "contextAttestation"]) {
    if (!properties[field]) throw new Error(`initializeLeadDeskRuntime is missing ${field}.`);
  }
  const attestationProperties = properties.contextAttestation?.properties ?? {};
  for (const field of ATTESTATION_FIELDS) {
    if (!attestationProperties[field]) throw new Error(`contextAttestation is missing ${field}.`);
  }
  const nestedRequired = new Set(properties.contextAttestation?.required ?? []);
  for (const field of ATTESTATION_FIELDS) {
    if (!nestedRequired.has(field)) throw new Error(`contextAttestation does not require ${field}.`);
  }
  return tool;
}

export async function inspectMcpToolSchema(url, apiKey) {
  const initialized = await postMcp(url, apiKey, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "lead-desk-schema-regression", version: "1.0.0" },
    },
  });
  await postMcp(url, apiKey, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }, initialized.sessionId);
  const listed = await postMcp(url, apiKey, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }, initialized.sessionId);
  assertInitializeSchema(listed.payload);
  return listed.payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, apiKeyFile] = process.argv.slice(2);
  if (!url || !apiKeyFile) {
    throw new Error("Usage: node scripts/validate-mcp-tool-schema.mjs <mcp-url> <api-key-file>");
  }
  const apiKey = readFileSync(apiKeyFile, "utf8").trim();
  if (!apiKey) throw new Error("API key file is empty.");
  await inspectMcpToolSchema(url, apiKey);
  console.log("MCP_INITIALIZATION_SCHEMA=PASS");
}
