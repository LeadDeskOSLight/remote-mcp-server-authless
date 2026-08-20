import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const chain = readFileSync(
	new URL("../artifacts/runtime/hash-chain.jsonl", import.meta.url),
	"utf8",
)
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));
const current = chain.at(-1);
const manifestUrl = new URL(`../${current.manifestPath}`, import.meta.url);
const manifestText = readFileSync(manifestUrl);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

if (sha256(manifestText) !== current.manifestSha256) {
	throw new Error("Runtime manifest SHA-256 does not match the hash chain.");
}

const manifest = JSON.parse(manifestText);
if (
	manifest.artifactId !== current.artifactId ||
	manifest.source.commitSha !== current.sourceCommitSha ||
	manifest.previousManifestSha256 !== current.previousManifestSha256 ||
	manifest.chainSequence !== current.sequence
) {
	throw new Error("Runtime manifest identity does not match the hash chain.");
}

for (const [path, entry] of Object.entries(manifest.files)) {
	const archive = readFileSync(
		new URL(
			`../artifacts/runtime/${manifest.artifactId}/${entry.archivePath}`,
			import.meta.url,
		),
	);
	if (archive.byteLength !== entry.bytes || sha256(archive) !== entry.sha256) {
		throw new Error(`Runtime artifact file mismatch: ${path}`);
	}
}

for (let index = 1; index < chain.length; index += 1) {
	if (chain[index].previousManifestSha256 !== chain[index - 1].manifestSha256) {
		throw new Error(`Runtime hash chain is broken at sequence ${chain[index].sequence}.`);
	}
}

const permitSource = readFileSync(new URL("../src/runtime-permit.ts", import.meta.url), "utf8");
if (!permitSource.includes(`RUNTIME_ARTIFACT_ID = "${current.artifactId}"`)) {
	throw new Error("Runtime permit artifact ID is not pinned to the current manifest.");
}
if (!permitSource.includes(`"${current.manifestSha256}"`)) {
	throw new Error("Runtime permit manifest SHA-256 is not pinned to the current manifest.");
}

console.log(`Runtime artifact ${manifest.artifactId} validated: ${current.manifestSha256}`);
