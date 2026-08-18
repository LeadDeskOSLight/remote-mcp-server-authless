import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export function sanitize(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === "object") {
    if (value.name === "x-make-apikey" && typeof value.value === "string") {
      return { ...value, value: "SET_MAKE_GATEWAY_KEY" };
    }
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]),
    );
  }
  if (typeof value !== "string") return value;

  if (/^https:\/\/hook\.[^.]+\.make\.com\//.test(value)) return "SET_MAKE_WEBHOOK_URL";
  if (/apikey|api[_-]?key|secret/i.test(key) && /^[\x20-\x7E]{32,512}$/.test(value)) {
    return "SET_MAKE_GATEWAY_KEY";
  }
  return value.replace(/(?<=\"x-make-apikey\"\s*:\s*\")[^\"]+(?=\")/gi, "SET_MAKE_GATEWAY_KEY");
}

export function installGatewayPermitForwarding(value) {
  if (Array.isArray(value)) {
    value.forEach(installGatewayPermitForwarding);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.id === 8 && value.module === "http:MakeRequest" && value.mapper) {
    delete value.mapper.bodyDataStructure;
    delete value.mapper.dataStructureBodyContent;
    value.mapper.inputMethod = "jsonString";
    value.mapper.jsonStringBodyContent = JSON.stringify({
      runtimePermit: "{{2.runtimePermit}}",
      stage: "{{2.stage}}",
      action: "{{2.action}}",
      purpose: "{{2.purpose}}",
      leadCode: "{{2.leadCode}}",
      workflow: "{{2.workflow}}",
      taskTitle: "{{2.taskTitle}}",
      nextAction: "{{2.nextAction}}",
      executionId: "{{2.executionId}}",
      startDateTime: "{{2.startDateTime}}",
      executionNotes: "{{2.executionNotes}}",
      durationMinutes: "{{2.durationMinutes}}",
      calendarRegistry: "{{2.calendarRegistry}}",
    });
  }
  Object.values(value).forEach(installGatewayPermitForwarding);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) throw new Error("Provide one or more Make blueprint JSON paths.");
  const outputDirectory = new URL("../artifacts/make-blueprints/", import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  for (const input of inputs) {
    const parsed = JSON.parse(await readFile(input, "utf8"));
    if (basename(input).startsWith("Integration Gateway")) installGatewayPermitForwarding(parsed);
    const sanitized = sanitize(parsed);
    const outputName = basename(input).replace(/\.blueprint\.json$/i, ".sanitized.blueprint.json");
    await writeFile(join(outputDirectory.pathname, outputName), `${JSON.stringify(sanitized, null, 2)}\n`);
  }
}
