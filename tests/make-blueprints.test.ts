import assert from "node:assert/strict";
import test from "node:test";
import {
  installCapabilityPermitReceipt,
  installGatewayPermitForwarding,
  sanitize,
} from "../scripts/sanitize-make-blueprints.mjs";

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

test("Make blueprint sanitizer removes environment identifiers and account emails", () => {
  const sanitized = sanitize({
    hook: 123,
    connection: "notion2",
    label: "Owner user@example.com",
  });
  assert.deepEqual(sanitized, {
    hook: "SET_MAKE_WEBHOOK_ID",
    connection: "SET_MAKE_CONNECTION",
    label: "Owner SET_ACCOUNT_EMAIL",
  });
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
  assert.match(opportunity.mapper.jsonStringBodyContent, /\{\{2\.permitFingerprint\}\}/);
});

test("every Gateway route forwards the opaque permit and fingerprint", () => {
  for (const id of [6, 8, 14]) {
    const module: any = {
      id,
      module: "http:MakeRequest",
      mapper: { inputMethod: "jsonString", jsonStringBodyContent: '{"action":"{{2.action}}"}' },
    };
    installGatewayPermitForwarding(module);
    assert.match(module.mapper.jsonStringBodyContent, /\{\{2\.runtimePermit\}\}/);
    assert.match(module.mapper.jsonStringBodyContent, /\{\{2\.permitFingerprint\}\}/);
  }
});

test("Gateway and downstream responses return an internal continuity receipt", () => {
  for (const [id, source] of [[10, 8], [13, 6]] as const) {
    const gateway: any = { id, module: "gateway:WebhookRespond", mapper: { body: '{"success":true}' } };
    installGatewayPermitForwarding(gateway);
    assert.match(gateway.mapper.body, new RegExp(`\\{\\{${source}\\.data\\.runtimePermit\\}\\}`));
    assert.match(gateway.mapper.body, new RegExp(`\\{\\{${source}\\.data\\.permitFingerprint\\}\\}`));
  }

  const capability: any = { id: 5, module: "gateway:WebhookRespond", mapper: { body: '{"success":true}' } };
  installCapabilityPermitReceipt(capability);
  assert.match(capability.mapper.body, /\{\{3\.runtimePermit\}\}/);
  assert.match(capability.mapper.body, /\{\{3\.permitFingerprint\}\}/);
});

test("permit receipt installation is idempotent", () => {
  const gateway: any = { id: 13, module: "gateway:WebhookRespond", mapper: { body: '{"success":true}' } };
  installGatewayPermitForwarding(gateway);
  installGatewayPermitForwarding(gateway);
  assert.equal((gateway.mapper.body.match(/"runtimePermit"/g) ?? []).length, 1);
  assert.equal((gateway.mapper.body.match(/"permitFingerprint"/g) ?? []).length, 1);

  const capability: any = { id: 5, module: "gateway:WebhookRespond", mapper: { body: '{"success":true}' } };
  installCapabilityPermitReceipt(capability);
  installCapabilityPermitReceipt(capability);
  assert.equal((capability.mapper.body.match(/"runtimePermit"/g) ?? []).length, 1);
  assert.equal((capability.mapper.body.match(/"permitFingerprint"/g) ?? []).length, 1);
});
