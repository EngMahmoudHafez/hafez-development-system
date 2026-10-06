# Evidence model

Rank evidence from strongest to weakest:

1. A command result produced in the current environment.
2. A manifest or lockfile.
3. CI configuration and its recorded result.
4. Source code and runtime configuration.
5. Project documentation.
6. Naming or directory heuristics.

Every recommendation should include evidence, confidence, and a safer alternative when confidence is low. Never read or print secret values from environment files or credential stores.

Prioritize stabilization when current build or test evidence is red. Prioritize integration when one repository has a verified contract while another still uses mocks. Prioritize hardening when delivery exists but security, deployment, recovery, or operational evidence is missing.
