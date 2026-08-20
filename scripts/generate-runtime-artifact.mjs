import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repository = "LeadDeskOSLight/remote-mcp-server-authless";
const sourceCommit = process.argv[2];

if (!sourceCommit) {
	throw new Error("Usage: node scripts/generate-runtime-artifact.mjs <release-candidate-commit>");
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const commitSha = git("rev-parse", `${sourceCommit}^{commit}`);
const shortSha = commitSha.slice(0, 8);
const committedAt = git("show", "-s", "--format=%cI", commitSha);
const date = committedAt.slice(0, 10);
const artifactId = `${date}-${shortSha}`;
const artifactDirectory = join("artifacts", "runtime", artifactId);
const files = [
	"src/index.ts",
	"src/runtime-permit.ts",
	"src/calendar-time.ts",
	"package.json",
	"package-lock.json",
	"wrangler.jsonc",
	"tsconfig.json",
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifestFiles = {};

for (const path of files) {
	const content = execFileSync("git", ["show", `${commitSha}:${path}`]);
	const archivePath = join("source", path);
	const destination = join(artifactDirectory, archivePath);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, content);
	manifestFiles[path] = {
		sha256: sha256(content),
		githubBlobSha: git("rev-parse", `${commitSha}:${path}`),
		bytes: content.byteLength,
		archivePath,
	};
}

const previousRecords = readFileSync(join("artifacts", "runtime", "hash-chain.jsonl"), "utf8")
	.trim()
	.split("\n")
	.filter(Boolean)
	.map((line) => JSON.parse(line))
	.filter((record) => record.artifactId !== artifactId);
const previous = previousRecords.at(-1);

const manifest = {
	schemaVersion: 2,
	artifactId,
	artifactType: "release-candidate-cloudflare-worker-runtime",
	generatedAt: committedAt,
	source: {
		repository,
		commitSha,
		treeSha: git("rev-parse", `${commitSha}^{tree}`),
		commitMessage: git("show", "-s", "--format=%s", commitSha),
		committedAt,
		branchAtCertification: "audit/runtime-permit-context-readiness",
	},
	runtime: {
		platform: "Cloudflare Workers",
		entrypoint: "src/index.ts",
		workerName: "remote-mcp-server-authless",
		compatibilityDate: "2026-07-02",
		compatibilityFlags: ["nodejs_compat"],
	},
	reproducibility: {
		level: "source-and-lockfile-pinned",
		dependencyLockfile: "package-lock.json",
		note: "This immutable release-candidate commit contains all functional runtime changes. The following certification commit pins the calculated manifest identity in src/runtime-permit.ts and may add non-runtime validation files or formatting-only changes.",
	},
	files: manifestFiles,
	previousManifestSha256: previous.manifestSha256,
	chainSequence: previous.sequence + 1,
};

mkdirSync(artifactDirectory, { recursive: true });
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(join(artifactDirectory, "manifest.json"), manifestText);
const manifestSha256 = sha256(manifestText);
const chainRecord = {
	schemaVersion: 1,
	sequence: manifest.chainSequence,
	artifactId,
	sourceCommitSha: commitSha,
	manifestPath: `${artifactDirectory}/manifest.json`,
	manifestSha256,
	previousManifestSha256: previous.manifestSha256,
	recordedAt: committedAt,
};
writeFileSync(
	join("artifacts", "runtime", "hash-chain.jsonl"),
	`${previousRecords.map((record) => JSON.stringify(record)).join("\n")}\n${JSON.stringify(chainRecord)}\n`,
);

console.log(JSON.stringify({ artifactId, manifestSha256, sourceCommitSha: commitSha }, null, 2));
