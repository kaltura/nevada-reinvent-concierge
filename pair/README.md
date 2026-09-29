# nevada-pair

Connects your AWS Events account to Nevada, an AI Conversational Personal Assistant Avatar for AWS re:Invent attendees.

Nevada is an experiment, inspired by [How to plan re:Invent 2026 with the new AWS Events API and MCP server](https://builder.aws.com/content/3JjrKKy63DJ80xhHTHd50DUIoxx/how-to-plan-reinvent-2026-with-the-new-aws-events-api-and-mcp-server). It is not affiliated with or endorsed by AWS.

## Use

Nevada shows you a command with your own code. Paste it into a terminal and press Return:

```sh
npx -y nevada-pair@latest ABC123 https://your-nevada-url
```

Your browser opens the AWS Builder ID sign-in. After you sign in, your Nevada tab carries on by itself.

Needs [Node.js](https://nodejs.org) 20 or later.

## What it does

1. Checks with Nevada that your code is still valid.
2. Opens the AWS sign-in on this computer, with a local callback on `127.0.0.1`, port 8484 to 8489.
3. Sends the AWS tokens and your code to Nevada over HTTPS.

It talks only to `oauth.awsevents.com` and the Nevada URL you give it. It stores nothing on disk, prints nothing secret and has no dependencies.

## Legal

- Free and open source under the [MIT license](LICENSE). Copyright Kaltura, Inc. It comes as is, with no warranty.
- Amazon Web Services, AWS and re:Invent are trademarks of Amazon.com, Inc.
