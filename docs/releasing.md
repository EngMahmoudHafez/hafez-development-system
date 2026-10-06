# Release process

Releases are immutable checkpoints. Publishing remains a maintainer action and is never triggered by
project adoption, verification, or delegation.

1. Run `npm run validate` from a clean checkout.
2. Run the package acceptance test and inspect `npm pack --dry-run --json`.
3. Update `CHANGELOG.md`, package manifests, and plugin manifests to one SemVer version.
4. Create an annotated `vX.Y.Z` tag (cryptographically sign it when maintainer signing is configured)
   and push it to the public repository.
5. The release workflow builds the npm tarball, plugin-directory ZIP, CycloneDX SBOM, checksums,
   and GitHub provenance. The ZIP is assembled from the exact npm package contents, excluding
   development-only files and local state.
6. Inspect the generated release before separately publishing to npm or the public plugin directory.

The workflow does not publish to npm. Registry publication requires a separately reviewed job and
trusted-publisher configuration; no long-lived npm token belongs in this repository.
