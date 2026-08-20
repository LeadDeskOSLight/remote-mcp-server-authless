import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RUNTIME_ARTIFACT_ID, RUNTIME_MANIFEST_SHA256 } from "../src/runtime-permit.ts";

const chain = readFileSync(
	new URL("../artifacts/runtime/hash-chain.jsonl", import.meta.url),
	"utf8",
)
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));
const current = chain.at(-1);

test("runtime permit identity is pinned to the current immutable manifest", () => {
	assert.equal(RUNTIME_ARTIFACT_ID, current.artifactId);
	assert.equal(RUNTIME_MANIFEST_SHA256, current.manifestSha256);
	const manifest = readFileSync(new URL(`../${current.manifestPath}`, import.meta.url), "utf8")
		.replace(/\\r\\n/g, "\\n");
	assert.equal(createHash("sha256").update(manifest, "utf8").digest("hex"), current.manifestSha256);
});

test("runtime hash chain is contiguous", () => {
	for (let index = 1; index < chain.length; index += 1) {
		assert.equal(chain[index].sequence, chain[index - 1].sequence + 1);
		assert.equal(chain[index].previousManifestSha256, chain[index - 1].manifestSha256);
	}
});
