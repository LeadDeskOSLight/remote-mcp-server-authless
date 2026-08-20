# Version-controlled runtime artifacts

This directory preserves immutable, reviewable snapshots of certified Lead Desk OS Light Worker source states.

## Current artifact

- Artifact ID: `2026-08-20-758b14b0`
- Release-candidate commit: `758b14b0ce0e2ee020fae3269e22cc7ece123e6c`
- Manifest SHA-256: `1c22a7c19dd3be74f27b5c30b39522f21dad81f1bd023cc22cfb2b174d4a22f1`
- Hash-chain sequence: `2`
- Reproducibility: source and dependency lockfile pinned

The release-candidate commit contains the complete functional runtime change. The following certification commit pins the resulting artifact ID and manifest hash in `src/runtime-permit.ts`; it may also add non-runtime validation files or formatting-only changes. This two-phase process avoids a circular claim in which a commit attempts to contain its own commit and manifest identities.

## Genesis artifact

- Artifact ID: `2026-08-14-a75f0495`
- Source commit: `a75f0495fe629a97c7c6119d582a710210fb4723`
- Manifest SHA-256: `fb54d7c6823a945b4ddbd6e8b87803ef64d672390f48fbb389327f53d6956baf`
- Hash-chain sequence: `1`

Archived files are exact copies from their certified Git commits. Run `npm run validate:runtime-artifact` to verify every current archived file, the manifest, the hash chain, and the runtime-permit pin.

This first artifact is **source-pinned**, not yet a byte-for-byte reproducible dependency build: the certified commit did not contain a dependency lockfile. A later artifact should add and certify a lockfile before claiming full build reproducibility.
