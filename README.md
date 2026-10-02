# Nevada

Nevada is a live avatar concierge for AWS re:Invent attendees. Plan your week with her face to face: talk, type or tap, and she finds sessions, books them and fixes clashes. She shows and points at what she's talking about. Built on the Kaltura Intelligent Agents SDK and the AWS Events API.

Inspired by [How to plan re:Invent 2026 with the new AWS Events API and MCP server](https://builder.aws.com/content/3JjrKKy63DJ80xhHTHd50DUIoxx/how-to-plan-reinvent-2026-with-the-new-aws-events-api-and-mcp-server).

Not affiliated with or endorsed by AWS.

Liked this experience and want to build your own intelligent agents? [Sign up for Kaltura Conversational Agent](https://corp.kaltura.com/pricing/conversational-agent/).

## What Nevada does

1. "That clashes, but it repeats Thursday at 10 and you're free. Want that?" She solves clashes out loud and offers the swap.
2. "Book this one." Nevada knows what's on your screen, and lights up the block she's talking about.
3. "Your next one is at MGM Grand. Leave by 2:50." She warns when two venues are too far apart for the gap.
4. "It's full. Here's a repeat with seats." She finds the repeat and says if walk-up is an option.
5. "Surprise me." One wildcard session far from your usual topics that still fits your week.
6. A recap of your week to share, on request.

Everything on screen comes from your real AWS schedule. Nothing gets booked without a clear yes.

## Run it

```sh
npx nevada-reinvent
```

The first time, npx asks "Ok to proceed?". Type `y`. The terminal prints:

```
Nevada is running at http://127.0.0.1:8484/
Press Ctrl+C to stop.
```

Your browser opens and you sign in. Nevada then builds your plan.

Nothing is installed. npx fetches [nevada-reinvent](https://www.npmjs.com/package/nevada-reinvent) into its cache and runs it. To be sure you run the newest version, use `npx nevada-reinvent@latest`.

| You need | Note |
|---|---|
| Node.js 20.6 or later | Check with `node --version`. Older versions stop with a clear message. |
| An AWS Builder ID linked to your re:Invent registration | Without a registration, AWS refuses your schedule and Nevada says so. |
| A desktop browser | Chrome, Edge or another Chromium browser works best. Safari and Firefox work with limits. No phones or tablets. |
| Internet | The avatar and the AWS schedule run online. |
| A microphone (optional) | Typing works without it. |

| To | Do this |
|---|---|
| Stop | Press Ctrl+C in the terminal. |
| Start without opening the browser | `npx nevada-reinvent --no-open`. The terminal prints the link. |
| Sign out | Click the pill in the top bar ("Signed in"), then "Sign out of AWS Events". This deletes your saved sign-in and revokes it at AWS. |
| Remove | Delete `~/.nevada` (or the folder in `NEVADA_HOME`). Nothing else is installed. |

Everything runs on your computer at `127.0.0.1`. Your AWS sign-in stays on your computer. What you say and the schedule details Nevada reads are sent to Kaltura to run the avatar. Nothing is sent anywhere else.

Your sign-in is saved in `~/.nevada/tokens.json`, readable only by you. Set `NEVADA_HOME` to an absolute folder path to use another place. Use Nevada on a computer only you use. On Windows the folder relies on your user profile permissions.

### Troubleshooting

| Problem | Fix |
|---|---|
| "Ports 8484 to 8489 are in use or blocked" | Close whatever uses them, then run it again. AWS only allows these ports. |
| The sign-in screen shows again, with a message | Read the message. Then try again with the link the app opens. Each sign-in link works once, for 10 minutes. |
| "Nevada couldn't save your sign-in" | Nevada can't write to its folder. Read the terminal, then set `NEVADA_HOME` to a folder you own and sign in again. |
| "Signed in, but ..." banner | Sign-in worked, but AWS refused the schedule. "Not registered" means your Builder ID isn't linked to your re:Invent registration. Before 8 October the AWS schedule API isn't open yet, and the banner says so. |
| "Your AWS sign-in expired" | Sign in again. Saved sign-ins last 30 days. |
| "Open the link above in your browser." | Nevada couldn't open a browser. Copy the printed link into one. |
| Nevada is already running | Running the command again opens the running one. |
| No microphone | Allow the mic for `127.0.0.1` in your browser. Typing works without it. |

## Docs

| Doc | Covers |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Run from source, tests, pull requests, maintainer scripts, release |
| [docs/EXPERIENCE-UX.md](docs/EXPERIENCE-UX.md) | What the attendee sees and hears, what's built and what's planned |
| [docs/DESIGN.md](docs/DESIGN.md) | Look and feel: persona, tokens, layout, components, motion |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, identity, sign-in, security model, agent config, tools, search, evals |
| [docs/AWS-EVENTS-INTEGRATION.md](docs/AWS-EVENTS-INTEGRATION.md) | The AWS Events API contract we depend on |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [LICENSE](LICENSE) | MIT license |
