import assert from "node:assert/strict";
import test from "node:test";
import { installGatewayPermitForwarding, sanitize } from "../scripts/sanitize-make-blueprints.mjs";

test("Make blueprint sanitizer removes webhook URLs and gateway keys", () => {
  const sanitized = sanitize({
    mapper: {
      url: "https://hook.us2.make.com/example",
      headers: [{ name: "x-make-apikey", value: "a".repeat(64) }],
    },
  });
  const source = JSON.stringify(sanitized);
  assert.match(source, /SET_MAKE_WEBHOOK_URL/);
  assert.match(source, /SET_MAKE_GATEWAY_KEY/);
  assert.ok(!source.includes("a".repeat(64)));
});

test("Gateway opportunity route forwards the opaque permit in raw JSON", () => {
  const opportunity: any = {
    id: 8,
    module: "http:MakeRequest",
    mapper: {
      inputMethod: "dataStructure",
      bodyDataStructure: 123,
      dataStructureBodyContent: { action: "{{2.action}}" },
    },
  };
  installGatewayPermitForwarding(opportunity);
  assert.equal(opportunity.mapper.inputMethod, "jsonString");
  assert.equal(opportunity.mapper.bodyDataStructure, undefined);
  assert.equal(opportunity.mapper.dataStructureBodyContent, undefined);
  assert.match(opportunity.mapper.jsonStringBodyContent, /\{\{2\.runtimePermit\}\}/);
});
