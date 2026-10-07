---
name: hafez-security
description: Perform evidence-based application security review and safe remediation for authentication, authorization, input handling, secrets, uploads, dependencies, tenancy, logging, rate limits, and common web/API vulnerability classes.
---

# Hafez Security

Security findings require evidence and explicit exploitability reasoning; do not generate alarmist checklists detached from the code.

Review the relevant attack surface:

1. Authentication: token/session lifetime, refresh/revocation, OTP behavior, password reset, MFA, login enumeration, logout, and credential handling.
2. Authorization: policies/guards, object ownership, tenant isolation, admin boundaries, mass assignment, and indirect-object access.
3. Input/output: validation, injection, unsafe deserialization, XSS, command execution, path traversal, SSRF, redirects, and response data exposure.
4. Files: MIME/content validation, storage visibility, executable uploads, path control, signed/private access, and metadata leakage.
5. Secrets/config: committed credentials, raw exception output, debug mode, unsafe defaults, environment separation, and log redaction.
6. Dependencies/supply chain: lockfile reproducibility, audit results, abandoned packages, install scripts, and CI provenance.
7. Abuse controls: rate limits, OTP resend/bruteforce limits, expensive endpoints, queues, webhooks, and replay protection.
8. Data protection: sensitive fields, encryption where justified, backups, retention, exports, and audit logs.
9. Infrastructure-facing code: CORS, trusted proxies/hosts, CSP where relevant, webhook signatures, TLS assumptions, and cloud storage permissions.
10. Add regression tests for confirmed security defects and rerun required quality/security gates.

Use read-only scouts for broad review and bounded writers for narrow remediations. The strongest lead reviews security-sensitive patches before integration.

Autopilot may fix clear reversible technical vulnerabilities locally. Pause for credentials/secret rotation, production access, disclosure/communication, destructive containment, legal/compliance/privacy policy choices, or security changes that materially alter product behavior.
