# Security policy

## Supported versions

The latest published version on npm (`nevada-reinvent`). Older versions and branches get no fixes.

## Reporting a vulnerability

Report it privately. Don't put exploit details in a public issue.

1. Go to the [Security tab](../../security) of this repository.
2. If **Report a vulnerability** is there, use it. It opens a private security advisory.
3. If it isn't there, open an issue labelled `security`. Say only that you have a security report and how to reach you. A maintainer will move the details to a private channel.

Never put a token, secret or your own AWS data in a report.

Include what you can:

- What you found and where (file, endpoint or feature)
- Steps to reproduce, and what you expected instead
- Impact: what an attacker could do with it

We aim to acknowledge new reports within 5 business days.

## Scope

In scope: the code in this repository (`client/`, `server/`, `scripts/`) and its GitHub Actions workflows.

Out of scope: the AWS Events API itself and the `@kaltura/intelligent-agents` SDK. Report those to their own maintainers.

## Design

Nevada runs on the attendee's own machine, bound to `127.0.0.1`. It sets no cookies and checks the `Host` header on every request and `Sec-Fetch-Site` on requests that change state. The sign-in tokens live in `~/.nevada` (or the absolute path in `NEVADA_HOME`), in a `0600` file in a `0700` folder on macOS and Linux. It is built for a single-user machine. See [ARCHITECTURE.md § Security model](ARCHITECTURE.md#security-model).

## Public widget ID

The package ships a public Kaltura widget ID. The widget ID and partner ID are public by design and carry no secret. Kaltura applies its own usage controls.
