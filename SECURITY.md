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

In scope: the code in this repository (`client/`, `server/`, `scripts/`) and its GitHub Actions workflows.

Out of scope: the AWS Events API itself and the `@kaltura/intelligent-agents` SDK. Report those to their own maintainers.

## Design

Nevada runs on the attendee's own machine, bound to `127.0.0.1`. State lives on disk under `~/.nevada` (file mode `0600`) and is meant for a single-user machine. See [ARCHITECTURE.md § Security model](ARCHITECTURE.md#security-model).

## Public widget ID

The package ships a public Kaltura widget ID. It carries no secret. Which abuse limits apply to it is an open question for Kaltura.
