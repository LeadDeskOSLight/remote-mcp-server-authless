import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTESTATION_FIELDS,
  assertInitializeSchema,
} from "../scripts/validate-mcp-tool-schema.mjs";

function payload(properties: Record<string, unknown>) {
  return {
    result: {
      tools: [{
        name: "initializeLeadDeskRuntime",
        inputSchema: { type: "object", properties },
      }],
    },
  };
}

const attestationProperties = Object.fromEntries(
  ATTESTATION_FIELDS.map((field) => [field, { type: "string" }]),
);

test("accepts the complete advertised two-phase initialization schema", () => {
  const result = assertInitializeSchema(payload({
    requestedOperatingMode: { type: "string" },
    clientTimeZone: { type: "string" },
    installationChallenge: { type: "string" },
    contextAttestation: {
      type: "object",
      properties: attestationProperties,
      required: ATTESTATION_FIELDS,
    },
  }));
  assert.equal(result.name, "initializeLeadDeskRuntime");
});

test("rejects a stale connector schema that omits phase-two inputs", () => {
  assert.throws(() => assertInitializeSchema(payload({
    requestedOperatingMode: { type: "string" },
    clientTimeZone: { type: "string" },
  })), /installationChallenge/);
});

test("rejects an incomplete Operating Context attestation schema", () => {
  const incomplete = { ...attestationProperties };
  delete incomplete.calendarReporting;
  assert.throws(() => assertInitializeSchema(payload({
    requestedOperatingMode: { type: "string" },
    clientTimeZone: { type: "string" },
    installationChallenge: { type: "string" },
    contextAttestation: {
      type: "object",
      properties: incomplete,
      required: ATTESTATION_FIELDS.filter((field) => field !== "calendarReporting"),
    },
  })), /calendarReporting/);
});
