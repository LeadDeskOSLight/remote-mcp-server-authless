# Version-controlled runtime artifacts

This directory preserves immutable, reviewable snapshots of certified Lead Desk OS Light Worker source states.

## Genesis artifact

- Artifact ID: `2026-08-14-a75f0495`
- Source commit: `a75f0495fe629a97c7c6119d582a710210fb4723`
- Manifest SHA-256: `fb54d7c6823a945b4ddbd6e8b87803ef64d672390f48fbb389327f53d6956baf`
- Hash-chain sequence: `1`

The archived files are exact UTF-8 copies from the certified Git commit. Verify each archived file against `manifest.json`, then verify the manifest itself against `../hash-chain.jsonl`.

This first artifact is **source-pinned**, not yet a byte-for-byte reproducible dependency build: the certified commit did not contain a dependency lockfile. A later artifact should add and certify a lockfile before claiming full build reproducibility.
