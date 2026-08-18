import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const artifact = JSON.parse(readFileSync(new URL("../artifacts/operating-context/1.0.5/operating-context.json", import.meta.url), "utf8"));
const policy: string = artifact.policyMarkdown;

test("complete approved context has integrity and late as well as early sections", () => {
  assert.equal(createHash("sha256").update(policy, "utf8").digest("hex"), artifact.operatingContextSha256);
  for (const section of artifact.requiredSections) assert.ok(policy.includes(section), section);
  assert.ok(policy.includes("## 23. Artifact Responsibilities"), "late sections must not be truncated");
});

test("distributed initialization regression probes are all present", () => {
  const probes = [
    "Co-Video with a deadline exactly one hour after the initial-outreach timing anchor",
    "Schedule the Day 2 follow-up Calendar recommendation exactly 24 elapsed hours",
    "Preparation: ChatGPT reasons from appointment purpose",
    "must automatically provide the recommended communication content",
    "Mo's explicit current `Notes:`",
    "fresh read-back matches expected changed fields",
    "Calendar creation remains `EXECUTED_UNVERIFIED`",
  ];
  for (const probe of probes) assert.ok(policy.includes(probe), probe);
});

test("readiness policy separates technical execution from installed conversational context", () => {
  assert.ok(policy.includes("A runtime permit proves execution authorization, not conversational competence."));
  assert.ok(policy.includes("Returning only a version or existence confirmation is insufficient."));
});

test("MCP contract excludes prohibited workflows and fixes Calendar reporting/routing", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const workflowDeclaration = source.slice(source.indexOf("const LIGHT_WORKFLOWS"), source.indexOf("const LIGHT_STAGES"));
  assert.ok(!workflowDeclaration.includes('"Two-Way Contact"'));
  assert.ok(!workflowDeclaration.includes('"Contracted"'));
  assert.ok(source.includes('calendarRegistry: "Lead Desk OS Light"'));
  assert.ok(source.includes('executionStatus: "EXECUTED_UNVERIFIED"'));
  assert.ok(source.includes("At least one non-empty approved field change is required."));
  assert.ok(source.includes("Fresh exact Lead Code preflight could not be verified."));
  assert.ok(source.includes('verificationStatus: "VERIFIED_SUCCESS"'));
  assert.ok(source.includes("changed and unchanged approved fields"));
  assert.ok(source.includes('"x-make-apikey": makeGatewayKey'));
  assert.ok(source.includes("MAKE_GATEWAY_AUTH_CONFIGURATION_ERROR"));
  assert.ok(source.includes('...(stage !== undefined ? { stage } : {})'));
  assert.ok(source.includes('...(workflow !== undefined ? { workflow } : {})'));
  assert.ok(source.includes('...(nextAction !== undefined ? { nextAction } : {})'));
  assert.ok(source.includes('...(executionNotes !== undefined ? { executionNotes } : {})'));
});
