import assert from "node:assert/strict";
import test from "node:test";
import { isValidLosAngelesDateTime } from "../src/calendar-time.ts";

test("accepts PST and PDT timestamps with the correct Los Angeles offset", () => {
  assert.equal(isValidLosAngelesDateTime("2026-01-15T09:00:00-08:00"), true);
  assert.equal(isValidLosAngelesDateTime("2026-08-17T09:00:00-07:00"), true);
});

test("rejects missing or mismatched offsets and spring-forward gaps", () => {
  assert.equal(isValidLosAngelesDateTime("2026-08-17T09:00:00Z"), false);
  assert.equal(isValidLosAngelesDateTime("2026-08-17T09:00:00-08:00"), false);
  assert.equal(isValidLosAngelesDateTime("2026-03-08T02:30:00-08:00"), false);
});

test("accepts either explicit fall-back occurrence", () => {
  assert.equal(isValidLosAngelesDateTime("2026-11-01T01:30:00-07:00"), true);
  assert.equal(isValidLosAngelesDateTime("2026-11-01T01:30:00-08:00"), true);
});
