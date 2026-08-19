import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [endpoint, apiKeyFile, leadCode = "Catherine-28-Elantra", calendarStartDateTime] = process.argv.slice(2);
if (!endpoint || !apiKeyFile) {
  throw new Error("Usage: node scripts/canary-runtime-lifecycle.mjs <https://.../mcp> <api-key-file> [lead-code] [calendar-start-rfc3339]");
}

const apiKey = (await readFile(apiKeyFile, "utf8")).trim();
if (!/^[\x20-\x7e]{32,512}$/.test(apiKey)) throw new Error("The canary API key file is invalid.");

const client = new Client({ name: "lead-desk-canary-audit", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
});
const prompt = createInterface({ input, output });

function payload(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error("Tool returned no JSON text payload.");
  return JSON.parse(text);
}

async function call(name, args) {
  return payload(await client.callTool({ name, arguments: args }));
}

const attestation = {
  internetLeadCadence:
    "Co-Video at anchor+1h; Day 2 at anchor+24h; Days 3-7 at 24h intervals; each is a fixed 30-minute Calendar candidate; meaningful response ends cadence",
  appointmentPreparation:
    "Evaluate appointment preparation and qualifying confirmations as fixed 30-minute Calendar candidates",
  emailDrafting:
    "When email is recommended, automatically supply independently copyable subject and body",
  notesPrecedence:
    "Mo's explicit current Notes: override conflicting or stale source-system AI-summary interpretation",
  notionVerification: "Create and update require fresh read-back before VERIFIED_SUCCESS",
  calendarReporting: "Successful Calendar creation is EXECUTED_UNVERIFIED",
};

try {
  await client.connect(transport);
  await prompt.question("Runtime Health clone must be waiting in Run once. Press Enter when ready: ");
  const first = await call("initializeLeadDeskRuntime", {
    requestedOperatingMode: "PRODUCTION",
    clientTimeZone: "America/Los_Angeles",
  });
  if (first.errorCode !== "OPERATING_CONTEXT_INSTALLATION_REQUIRED") {
    throw new Error(`Expected Operating Context installation challenge; received ${first.errorCode ?? first.runtimeStatus}`);
  }
  const policy = first.operatingContext?.policyMarkdown;
  for (const marker of [
    "Co-Video with a deadline exactly one hour after the initial-outreach timing anchor",
    "Preparation: ChatGPT reasons from appointment purpose",
    "must automatically provide the recommended communication content",
    "Mo's explicit current `Notes:`",
    "fresh read-back matches expected changed fields",
    "Calendar creation remains `EXECUTED_UNVERIFIED`",
    "## 23. Artifact Responsibilities",
  ]) {
    if (typeof policy !== "string" || !policy.includes(marker)) throw new Error(`Operating Context marker missing: ${marker}`);
  }
  console.log("PHASE1=CONTEXT_INSTALLED FULL_CONTEXT_MARKERS=PASS");

  await prompt.question("Restart Runtime Health clone in Run once, then press Enter: ");
  const ready = await call("initializeLeadDeskRuntime", {
    requestedOperatingMode: "PRODUCTION",
    clientTimeZone: "America/Los_Angeles",
    installationChallenge: first.installationChallenge,
    contextAttestation: attestation,
  });
  if (ready.runtimeStatus !== "READY" || ready.technicalReadiness !== "READY" ||
      ready.operationalContextStatus !== "READY" || typeof ready.runtimePermit !== "string") {
    throw new Error(`Initialization did not become READY: ${ready.errorCode ?? ready.runtimeStatus}`);
  }
  const runtimePermit = ready.runtimePermit;
  console.log(`PHASE2=READY PERMIT_LENGTH=${runtimePermit.length}`);

  const position = Math.min(runtimePermit.length - 1, runtimePermit.indexOf(".") + 2);
  const mutated = runtimePermit.slice(0, position) + (runtimePermit[position] === "A" ? "B" : "A") + runtimePermit.slice(position + 1);
  const tampered = await call("getNotionOpportunity", { runtimePermit: mutated, leadCode });
  if (tampered.errorCode !== "RUNTIME_PERMIT_TAMPERED") {
    throw new Error(`Mutated permit was not rejected safely: ${tampered.errorCode ?? tampered.executionStatus}`);
  }
  console.log("TAMPERED_PERMIT=REJECTED");

  await prompt.question("Start Notion clone in Run once, then Gateway clone in Run once. Press Enter when both are waiting: ");
  const lookup = await call("getNotionOpportunity", { runtimePermit, leadCode });
  if (lookup.success !== true || lookup.executionStatus !== "EXECUTED" || lookup.matchCount !== 1) {
    throw new Error(`Exact permit lookup failed: ${lookup.errorCode ?? lookup.executionStatus}`);
  }
  if ("runtimePermit" in lookup || "permitFingerprint" in lookup) {
    throw new Error("Internal permit continuity receipt escaped the Worker boundary.");
  }
  console.log(`EXACT_PERMIT_LOOKUP=PASS MATCH_COUNT=${lookup.matchCount} EXECUTION_ID=${lookup.executionId}`);
  console.log("MAKE_PERMIT_CONTINUITY=PASS RECEIPT_REDACTED=PASS");

  if (calendarStartDateTime) {
    await prompt.question("Start Calendar clone in Run once, then Gateway clone in Run once. Press Enter when both are waiting: ");
    const calendar = await call("createCalendarEvent", {
      runtimePermit,
      taskTitle: "AUDIT — Canary Permit Continuity",
      startDateTime: calendarStartDateTime,
      purpose: "Authorized canary runtime-permit continuity validation",
      leadCode: "AUDIT-CANARY-PERMIT-CONTINUITY",
      executionNotes: "Temporary canary audit event. Delete after visual verification.",
      nextAction: "Delete temporary audit event after verification.",
    });
    if (calendar.success !== true || calendar.executionStatus !== "EXECUTED_UNVERIFIED" ||
        calendar.verificationStatus !== "UNVERIFIED") {
      throw new Error(`Calendar permit continuity failed: ${calendar.errorCode ?? calendar.executionStatus}`);
    }
    if ("runtimePermit" in calendar || "permitFingerprint" in calendar) {
      throw new Error("Internal Calendar permit continuity receipt escaped the Worker boundary.");
    }
    console.log(`CALENDAR_PERMIT_CONTINUITY=PASS EXECUTION_ID=${calendar.executionId} DELETE_TEST_EVENT=REQUIRED`);
  }
  console.log("CANARY_RUNTIME_LIFECYCLE=PASS");
} finally {
  prompt.close();
  await client.close();
}
