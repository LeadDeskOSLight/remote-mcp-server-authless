import assert from "node:assert/strict";
import test from "node:test";
import {
  issueContextChallenge,
  issueRuntimePermit,
  validateContextChallenge,
  validateRuntimePermit,
} from "../src/runtime-permit.ts";

const secret = "production-test-secret-with-sufficient-entropy";
const now = new Date("2026-08-17T19:00:00.000Z");

test("the exact issued permit validates byte-for-byte", async () => {
  const issued = await issueRuntimePermit(secret, now);
  const transported = JSON.parse(JSON.stringify({ runtimePermit: issued.runtimePermit })).runtimePermit;
  assert.equal(transported, issued.runtimePermit);
  const result = await validateRuntimePermit(transported, secret, new Date(now.getTime() + 1_000));
  assert.equal(result.ok, true);
  assert.ok(issued.runtimePermit.length < 100, "permit should remain short enough for reliable opaque transport");
});

test("mutation is rejected without weakening integrity", async () => {
  const { runtimePermit } = await issueRuntimePermit(secret, now);
  const position = runtimePermit.indexOf(".") + 2;
  const replacement = runtimePermit[position] === "A" ? "B" : "A";
  const mutated = runtimePermit.slice(0, position) + replacement + runtimePermit.slice(position + 1);
  const result = await validateRuntimePermit(mutated, secret, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "RUNTIME_PERMIT_TAMPERED");
});

test("a signer/validator secret mismatch is diagnosable as signature failure", async () => {
  const { runtimePermit } = await issueRuntimePermit(secret, now);
  const result = await validateRuntimePermit(runtimePermit, "different-deployment-secret", now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "RUNTIME_PERMIT_TAMPERED");
});

test("context challenge is signed, expiring, and bound to the current artifacts", async () => {
  const challenge = await issueContextChallenge(secret, now);
  assert.equal(await validateContextChallenge(challenge, secret, new Date(now.getTime() + 1_000)), true);
  assert.equal(await validateContextChallenge(challenge, secret, new Date(now.getTime() + 601_000)), false);
});
