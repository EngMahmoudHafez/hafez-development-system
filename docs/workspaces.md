# Multi-repository workspaces

A workspace is a generic product graph whose members may be APIs, web applications, mobile clients,
workers, infrastructure, documentation, or other repositories. Repository names and directory paths
carry no architectural meaning by themselves.

The workspace contract records:

- stable member identifiers and explicit repository paths;
- optional roles used only as descriptive metadata;
- contract producers, consumers, and the artifact that connects them;
- workspace-level compatibility gates stored as argument arrays;
- the last observed revision for each member.

Inspection is read-only. Workspace creation or migration must preview every write. A contract edge is
accepted only when both member identifiers exist; Hafez never invents a producer/consumer relationship
from package names or folder layout.

Preview workspace readiness with `hafez workspace-verify <root>`. Add `--execute` only after reviewing
the configured commands. Readiness requires every member and contract artifact to exist and every
required compatibility gate to pass; a missing gate never becomes implicit success.
