# Security policy

## Supported versions

Only `main` is supported. We don't maintain older branches or tags.

## Reporting a vulnerability

Report privately through GitHub. Don't open a public issue.

1. Go to the [Security tab](../../security) of this repository.
2. Click **Report a vulnerability** to open a private security advisory.

Include what you can:

- What you found and where (file, endpoint or feature)
- Steps to reproduce, and what you expected instead
- Impact: what an attacker could do with it

We aim to acknowledge new reports within 5 business days.

## Scope

In scope: the code in this repository (`client/`, `server/`, `pair/`, `scripts/`) and its GitHub Actions workflows.

Out of scope: the AWS Events API itself and the `@kaltura/intelligent-agents` SDK. Report those to their own maintainers.

## Current phase

Nevada is in Phase 1: one attendee, one server, localhost only. All state (pairing, tokens, catalog) lives in server memory, so a restart clears it. See [ROADMAP.md](ROADMAP.md) for what's planned next.
