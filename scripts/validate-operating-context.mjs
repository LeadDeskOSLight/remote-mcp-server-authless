import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const artifactPath = new URL(
	"../artifacts/operating-context/1.0.0/operating-context.json",
	import.meta.url,
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const hashChainPath = new URL("../artifacts/operating-context/hash-chain.jsonl", import.meta.url);
const hashChain = readFileSync(hashChainPath, "utf8")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));

const expected = {
	schemaVersion: 1,
	operatingContextVersion: "1.0.0",
	operatingContextSha256: "2bedaef81202e88e60338740e00e2e4cb0a9abe6feb929e753a18d1dd2277a8e",
	contentType: "text/markdown",
};

for (const [key, value] of Object.entries(expected)) {
	if (artifact[key] !== value) {
		throw new Error(`Operating Context ${key} mismatch.`);
	}
}

if (typeof artifact.policyMarkdown !== "string" || artifact.policyMarkdown.trim().length === 0) {
	throw new Error("Operating Context policyMarkdown is missing.");
}

for (const section of artifact.requiredSections ?? []) {
	if (!artifact.policyMarkdown.includes(section)) {
		throw new Error(`Operating Context required section missing: ${section}`);
	}
}

const calculatedSha256 = createHash("sha256").update(artifact.policyMarkdown, "utf8").digest("hex");

if (calculatedSha256 !== expected.operatingContextSha256) {
	throw new Error(`Operating Context SHA-256 mismatch: ${calculatedSha256}`);
}

const currentChainRecord = hashChain.at(-1);
if (
	currentChainRecord?.operatingContextVersion !== expected.operatingContextVersion ||
	currentChainRecord?.policySha256 !== expected.operatingContextSha256
) {
	throw new Error("Operating Context hash-chain record mismatch.");
}

console.log(`Operating Context ${artifact.operatingContextVersion} validated: ${calculatedSha256}`);
