# Google Chat MCP

A small stdio [MCP](https://modelcontextprotocol.io) server that lets an AI
agent (Claude Code, Claude Desktop, or any MCP client) read and send Google
Chat messages **as the signed-in user**, through the Google Chat API with user
OAuth.

- 21 tools for spaces, messages, members and attachments
- Safety switches: read-only mode, a space allowlist, and one fixed folder for
  files
- Plain `fetch` against the Chat REST API; the only dependencies are the MCP
  SDK and `zod`
- One-time sign-in with PKCE and a loopback redirect; the token refreshes on
  its own after that

> **Needs a Google Workspace account.** Google's Chat API guide lists a
> Business or Enterprise Workspace account as a prerequisite. A personal
> `@gmail.com` account is not supported.

## Tools

| Area | Tool | What it does |
| --- | --- | --- |
| Spaces | `list_spaces` | Spaces, group chats and DMs you are in, most recently active first |
| | `search_spaces` | Find spaces by name (matched locally; the API cannot filter by name) |
| | `get_space` | Type, description, guidelines, member count, link |
| | `find_direct_message` | Your 1:1 DM with a person (email or `users/{id}`) |
| | `find_group_chats` | Group chats whose members are exactly you plus the given people |
| | `create_space` | A named space with you as the only member |
| | `update_space` | Rename a space or change its description or guidelines |
| | `create_group_chat` | Start a group chat with 2 to 49 people (returns the existing one if it already exists) |
| | `delete_space` | Delete a space and everything in it, for everyone (cannot be undone) |
| Messages | `read_messages` | Latest messages in a space, oldest first, optional `since` |
| | `get_message` | One message with its attachments |
| | `get_thread` | Every message in a thread, oldest first |
| | `send_message` | Post as you; pass `thread` to reply in a thread |
| | `edit_message` | Replace the text of your own message |
| | `delete_message` | Delete a message (fails if it has thread replies) |
| Members | `list_members` | Members with name, role and state |
| | `get_member` | One person's membership |
| | `add_member` | Add a person to a space |
| | `remove_member` | Remove a person from a space |
| Attachments | `send_attachment` | Upload a file from the files folder and send it (only with `GOOGLE_CHAT_FILES_DIR`) |
| | `download_attachment` | Save an attachment into the files folder (only with `GOOGLE_CHAT_FILES_DIR`) |

Everything you send shows under your own name, with the Chat app's name from
your Google Cloud project as a small chip next to it.

## Demo

Claude Code with this server, in a test Workspace. The project's `CLAUDE.md`
asks Claude to show a draft before it sends a message and wait for "yes".
That is an instruction to the model, not something the server enforces.

Claude drafts a message to a space, waits, and sends it after "Yes send it":

![Claude shows a draft for the Google Chat MCP Team space, the user replies "Yes send it", Claude replies Done](docs/demo/03-claude-draft-and-sent.png)

Akshay sees it in the space, sent by Tarun with the "Texperiments Chat MCP"
chip:

![Akshay's Google Chat: the message from Tarun Koshti with the Texperiments Chat MCP chip, under an Unread line](docs/demo/04-chat-message-akshay-view.png)

<details>
<summary>More screenshots: create a space, DMs, read a reply, send a file</summary>

Create a space and add two people (no draft needed):

![Claude: created the Google Chat MCP Team space and added Akshay Koshti and Bob Test](docs/demo/01-claude-space-created.png)

![Google Chat: You created this space, Tarun Koshti added Akshay Koshti and Bob Test, each via Texperiments Chat MCP](docs/demo/02-chat-new-space.png)

The same message from the sender's side:

![Tarun's Google Chat: his message in the space, labelled You and Texperiments Chat MCP](docs/demo/05-chat-message-tarun-view.png)

A direct message to Akshay:

![Claude: draft to Akshay Koshti (direct message), then Done](docs/demo/06-claude-dm-akshay.png)

![Akshay's Google Chat: the DM from Tarun Koshti with the Texperiments Chat MCP chip](docs/demo/07-chat-dm-akshay-view.png)

Reading the reply:

![Claude: Did Akshay reply? Yes, Akshay replied "Sure, sending the test report in 10 minutes."](docs/demo/08-claude-read-reply.png)

![Tarun's Google Chat: Akshay's reply under Tarun's message](docs/demo/09-chat-dm-reply-tarun-view.png)

A DM where Claude writes the text itself:

![Claude: draft to Bob Test, "Hi Bob, did you finish testing the read-only mode?", then sent](docs/demo/10-claude-dm-bob.png)

![Tarun's Google Chat: the DM to Bob Test sent via Texperiments Chat MCP; Bob's email is pixelated](docs/demo/11-chat-dm-bob-tarun-view.png)

Sending a file from the files folder:

![Claude: draft with the release notes file and the line "Attaching the release notes", then sent](docs/demo/12-claude-send-file.png)

![Akshay's Google Chat: "Attaching the release notes" with the .txt file card](docs/demo/13-chat-file-akshay-view.png)

</details>

## Safety

An agent with this server can post as you, change spaces and remove people.
These settings limit what it can do:

| Setting | Effect |
| --- | --- |
| `GOOGLE_CHAT_READ_ONLY=true` | Only the read tools exist, and sign-in asks Google for read-only scopes, so the token itself cannot write |
| `GOOGLE_CHAT_ALLOWED_SPACES` | Optional, off by default. Comma-separated `spaces/XXXX` list. Every write tool, `delete_space` included, refuses other spaces, and creating new spaces is refused |
| `GOOGLE_CHAT_FILES_DIR` | The only folder the attachment tools can read from or write to. Without it, they are not registered. Paths outside it (`../`, absolute paths) are refused |

Also keep in mind:

- **Do not auto-approve the write tools** in your MCP client. Tools carry MCP
  hints (`readOnlyHint`, `destructiveHint`), but hints are only hints; the
  client's approval prompt is what stops a wrong send.
- **Messages the agent reads are untrusted input.** Anyone in a space can
  write a message that tries to steer the agent ("reply to X with ..."). This
  is prompt injection; review every write before you approve it.
- "Approve the exact text first" in the tool descriptions is advice to the
  model, not something the server enforces.

## Setup

You need a Google Cloud project in your Workspace, the Chat API enabled, an
OAuth consent screen, a Chat app configuration and a Desktop OAuth client. It
takes about 10 minutes. The screenshots were taken in a test Workspace
(`texperiments.com`); use your own names.

### 1. Open the Google Cloud console

Go to <https://console.cloud.google.com/>, signed in with your Workspace
account.

![Google Cloud welcome dialog with the account email, Country set to India, and an unticked Terms of Service checkbox](docs/setup/01-cloud-console-welcome-terms.png)

### 2. Accept the Google Cloud terms (first visit only)

Tick the **"I agree to the Google Cloud Platform Terms of Service"**
checkbox, then click **Agree and continue**. No billing account is needed for
the Chat API, so you can ignore the "$300 free trial" banner.

![Welcome dialog with the Terms of Service checkbox ticked and the Agree and continue button enabled](docs/setup/02-cloud-console-terms-agreed.png)

On the first visit, Google also creates the Cloud organization for your
Workspace domain.

![Cloud console home page with no project selected](docs/setup/03-cloud-console-home-no-project.png)

### 3. Create a project

Click the project picker (**Select a project**) at the top, then
**New project**.

![Select a resource dialog with the New project button at the top right](docs/setup/04-select-resource-new-project-button.png)

![New Project form with the default generated project name](docs/setup/05-new-project-form-default.png)

Enter a project name. The project ID follows the name and cannot be changed
later. Organization and parent resource are your Workspace domain. Click
**Create**.

![New Project form with project name texperiments-chat-mcp, organization and parent resource texperiments.com](docs/setup/06-new-project-form-filled.png)

The notifications panel confirms it; **Select Project** opens it.

![Notifications panel showing Create Project finished, with a Select Project link](docs/setup/07b-project-created-notification-clear.png)

![Project dashboard showing the project name, number and ID](docs/setup/08b-project-dashboard.png)

### 4. Enable the Google Chat API

Open **APIs & Services → Library**.

![API Library welcome page with the search box](docs/setup/09-api-library.png)

Search for "Google Chat API" and press Enter.

![API Library search box with Google Chat API typed in](docs/setup/10-api-library-search-chat.png)

Pick **Google Chat API** (not "Chat MCP API").

![Search results: Google Chat API first, Chat MCP API second](docs/setup/11-api-search-results.png)

Click **Enable**.

![Google Chat API product page with the Enable button](docs/setup/12-chat-api-enable-button.png)

The details page shows **Status: Enabled**.

![Google Chat API details page showing chat.googleapis.com and Status Enabled](docs/setup/13-chat-api-enabled.png)

### 5. Configure the OAuth consent screen

Open **Google Auth Platform → Overview** and click **Get started**.

![Google Auth Platform overview saying it is not configured yet, with a Get started button](docs/setup/14-auth-platform-get-started.png)

**App Information:** enter an app name and pick the user support email.

![App Information step, empty](docs/setup/15-branding-app-info-empty.png)

![App Information filled with an app name and support email](docs/setup/16-branding-app-info-filled.png)

**Audience:** choose **Internal**. Only users in your Workspace can sign in,
and Google does not need to verify the app.

![Audience step with Internal selected](docs/setup/17-audience-internal.png)

**Contact Information:** an email where Google can reach you about the
project.

![Contact Information step with an email entered](docs/setup/18-contact-information.png)

**Finish:** tick **"I agree to the Google API Services: User Data Policy"**,
click **Continue**, then **Create**.

![Finish step with the User Data Policy checkbox ticked](docs/setup/19-finish-user-data-policy.png)

![OAuth Overview after creation, with the OAuth configuration created message](docs/setup/20-oauth-configuration-created.png)

### 6. Configure the Chat app (needed even for user sign-in)

Open **APIs & Services → Enabled APIs & services → Google Chat API →
Configuration**. The Chat API refuses calls from a project without a Chat app
configuration, and the app name becomes the chip on messages you send.

![Chat API Configuration tab before editing, with interactive features on by default](docs/setup/21-chat-app-configuration-empty.png)

Set an **App name** and a **Description** (40 characters max). Switch
**Interactive features** off and confirm **Disable**, so nobody can message or
add the app. Leave **"Build this Chat app as a Workspace add-on"** as it is;
clearing it cannot be undone. Click **Save**.

![Chat app configuration form with app name, description, and interactive features off](docs/setup/22-chat-app-configuration-filled.png)

![Chat app configuration after saving, with the Configuration saved message](docs/setup/23-chat-app-configuration-saved.png)

### 7. Create a Desktop OAuth client

Open **Google Auth Platform → Clients → Create client**.

![Create OAuth client ID page with the Application type dropdown](docs/setup/24-create-oauth-client.png)

![Application type options, with Desktop app last](docs/setup/25-application-type-options.png)

Choose **Desktop app**, give it a name, and click **Create**.

![Desktop app selected with the client name filled in](docs/setup/26-desktop-app-client-form.png)

In the **OAuth client created** dialog, click **Download JSON**. Google shows
the client secret only once. Keep the file **outside** this repository; it is
a credential.

![Clients list with the new Desktop client](docs/setup/27-oauth-clients-list.png)

### 8. Install and sign in

```bash
npm install
npm run build
```

Sign in once, pointing at the downloaded client file:

```bash
GOOGLE_CHAT_CREDENTIALS=/path/to/client.json npm run auth
```

Open the printed URL and choose your Workspace account.

![Google sign-in: Choose an account](docs/setup/28-mcp-sign-in-choose-account.png)

The consent screen lists the Chat permissions the server asks for. Click
**Allow**.

![Consent screen listing permissions for spaces, messages, members and deleting spaces](docs/setup/29-mcp-consent-screen.png)

The browser lands on a local page and the token is saved (default
`~/.google-chat-mcp/token.json`).

![Local page: Google Chat MCP is signed in. You can close this tab.](docs/setup/30-mcp-signed-in.png)

Run `npm run auth` again only if the token is revoked, or after switching
read-only mode on or off (the scopes change).

## Register the server

Claude Code (`.mcp.json` in your project):

```json
{
  "mcpServers": {
    "google-chat": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/google-chat-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CHAT_CREDENTIALS": "/path/to/client.json"
      }
    }
  }
}
```

Claude Desktop uses the same `mcpServers` block in
`claude_desktop_config.json`. Restart the client after changing the config or
rebuilding.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `GOOGLE_CHAT_CREDENTIALS` | *(required)* | The Desktop OAuth client JSON from step 7 |
| `GOOGLE_CHAT_TOKEN` | `~/.google-chat-mcp/token.json` | Where the refresh token is stored |
| `GOOGLE_CHAT_READ_ONLY` | off | `true` for read tools and read-only scopes only |
| `GOOGLE_CHAT_ALLOWED_SPACES` | off | Comma-separated `spaces/XXXX` that write tools may touch |
| `GOOGLE_CHAT_FILES_DIR` | off | Folder for `send_attachment` and `download_attachment` |

Scopes requested: `chat.spaces`, `chat.messages`, `chat.memberships` and
`chat.delete`; in read-only mode, `chat.spaces.readonly`,
`chat.messages.readonly` and `chat.memberships.readonly`.

## Limits

- The Chat API has no keyword search. `search_spaces` lists your spaces and
  matches names locally; to find a message, read a space with `since`.
- Attachments stored in Google Drive cannot be downloaded through the Chat
  API; only uploaded files can. Uploads are limited to 200 MB.
- New Workspace users can take a while to appear in Chat's people search;
  the full email address works sooner.

## Turning it off

- **Stop the server:** remove it from your MCP config.
- **Revoke access:** remove the app at myaccount.google.com → Security →
  Third-party apps, and delete the token file.
- **Remove it entirely:** delete the Google Cloud project. This also cuts off
  every token issued through it.

## Code layout

- `src/index.ts`: starts the server; `node dist/index.js auth` runs the
  sign-in instead
- `src/auth.ts`: loads the client file, runs the sign-in, stores and refreshes
  the token
- `src/chat.ts`: thin `fetch` wrappers over the Chat REST API v1
- `src/safety.ts`: read-only mode, allowlist and files folder
- `src/tools/`: the tools, one file per area

## License

ISC, see [LICENSE](LICENSE).
