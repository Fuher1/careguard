# Vulnerability Disclosure Policy

## Purpose

This policy defines how CareGuard receives and responds to vulnerability reports.
It covers acknowledgement, triage, fix, and public disclosure timelines.

## Severity levels

- **P0 / Critical**: remote code execution, secret leak of production keys, payment diversion.
- **P1 / High**: unauthorized access to `/agent/*`, authentication bypass, major data exposure.
- **P2 / Medium**: information leakage, denial of service, moderate security control gap.
- **P3 / Low**: low-impact misconfigurations, outdated dependency warnings with limited exploitability.

## SLA windows

| Stage | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Acknowledgement | 24h | 24h | 72h | 5 days |
| Triage complete | 48h | 48h | 5 days | 10 days |
| Fix targeted | 7 days | 14 days | 30 days | next minor release |
| Public disclosure | fix available or 90 days after report | fix available or 90 days | fix available or 120 days | fix available or 120 days |

## Coordinated disclosure expectations

- Reporters should submit issues privately or through an agreed channel.
- The project will not publicly disclose a vulnerability before a fix is available, except when required by law.
- Credit is encouraged unless the reporter requests anonymity.
- Safe harbor: good-faith security research is welcome, and the project will not pursue legal action for responsible disclosure.

## What to expect

- We acknowledge receipt quickly and confirm the issue is receiving attention.
- We classify severity and communicate expected timelines.
- We coordinate on mitigation and fix release timing.
- Once fixed, we disclose publicly consistent with the agreed embargo timeline.

## Related docs

- `docs/SECURITY.md`
- `docs/security/threat-model-review.md`
