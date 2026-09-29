# nevada-pair

Connects your AWS Events account to Nevada, an AI concierge for AWS re:Invent attendees.

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

For AWS re:Invent attendees. Not affiliated with or endorsed by AWS.
