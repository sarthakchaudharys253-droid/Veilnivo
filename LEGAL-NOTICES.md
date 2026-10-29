# Public privacy, terms and safety pages

The static public routes `/privacy/`, `/terms/`, `/acceptable-use/`, `/support/` and `/legal/` describe the implemented beta. They work without an account and are linked from sign-in, Settings and Privacy & trust. Links from the messenger open a new tab to preserve drafts. These pages do not introduce chat inspection, an AI moderation service, legal-request automation or billing.

## Current privacy boundary

Accounts use a username and password; no phone number, Gmail account or other email address is required. This is not complete anonymity. The backend handles identity/authentication records, public and wrapped private keys, encrypted messages/files, routing and receipt metadata, contact/invitation state, group names/membership and sessions. Hosts may process connection/request data. Essential cookies and browser storage are described in the notice.

Peer/group message contents are encrypted on the client. Ollama Cloud remains inactive. If enabled separately, only explicit assistant prompts may reach its provider after the assistant notice is accepted. The exact configured chat-lock code is intercepted locally. There is no suspicion score, routine private-chat scanning, crime classifier, secret plaintext copy or automatic government notification.

Reports require a real operator-controlled contact and user-chosen information. There is no new report inbox in this release. Publishing an email address does not create a staffed grievance process. Never substitute a public GitHub issue for confidential privacy, abuse or vulnerability reports.

## Operator details

`src/components/legal/LegalPage.tsx` holds the public operator/contact configuration. The operator explicitly supplied `sarthakchaudharys253@gmail.com` for public privacy and abuse contact; it is also labeled for legal requests. No email was sent or mailbox delivery verified during implementation. A public legal entity name, postal address, appointed grievance officer and staffed response process have not been supplied. Do not invent them or promise a service level. The responsible operator and applicable contact/grievance process need review before treating these beta pages as complete formal launch notices.

## Legal readiness is separate from page publication

These pages document current behavior and do not certify compliance in India or any other country. Operator-specific legal review must determine applicability, controller/grievance details, response procedures, legal bases, international transfers, preservation obligations, children/age handling and required incident practices. Do not claim those processes exist merely because they appear in a draft policy.

In particular, current account erasure cascades records immediately and there is no legal-hold workflow. The application logger is disabled and hosting is currently in Singapore. Those implementation facts must be assessed against any applicable registration-record retention, logging, incident-response and preservation duties before a broad launch. Do not silently add plaintext surveillance or promise retention/deletion behavior that the code does not implement.

Primary references consulted on 29 October 2026:

- [India IT Rules, consolidated through 10 February 2026](https://mib.gov.in/sites/default/files/2026-05/it-rules-2021-2.pdf).
- [Official DPDP Rules 2025 Gazette and phased commencement](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
- [CERT-In directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf).
- [EU data-protection guidance](https://europa.eu/youreurope/business/governance-and-sustainability/digital-and-data-compliance/data-protection-gdpr/index_en.htm).
- [Netlify privacy statement](https://www.netlify.com/privacy/) and [Render privacy information](https://render.com/privacy).

Keep the effective date, product notices and actual data practices in sync. Material future AI or moderation changes require a separate transparent implementation and notice review; this release changes no encryption or AI activation settings.
