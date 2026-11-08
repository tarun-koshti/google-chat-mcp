import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";

import { readOnly } from "./safety.js";

// Read-only mode asks only for read-only scopes, so even a write call that
// slipped through would be refused by Google.
export const SCOPES = (
  readOnly
    ? ["chat.spaces.readonly", "chat.messages.readonly", "chat.memberships.readonly"]
    : ["chat.spaces", "chat.messages", "chat.memberships", "chat.delete"]
).map((scope) => `https://www.googleapis.com/auth/${scope}`);

// The OAuth client file downloaded from Google Cloud ("Download JSON" on a
// Desktop client). Path comes from the MCP config so the secret never has to
// live inside this folder.
const credentialsPath = process.env.GOOGLE_CHAT_CREDENTIALS?.trim();
// Refresh token lives in the user's home, outside every repo.
const tokenPath =
  process.env.GOOGLE_CHAT_TOKEN?.trim() ||
  join(homedir(), ".google-chat-mcp", "token.json");

interface ClientConfig {
  client_id: string;
  client_secret: string;
  token_uri: string;
  auth_uri: string;
}

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

function loadClient(): ClientConfig {
  if (!credentialsPath) {
    throw new Error("GOOGLE_CHAT_CREDENTIALS is not set");
  }
  const raw = JSON.parse(readFileSync(credentialsPath, "utf8"));
  const client = raw.installed ?? raw.web;
  if (!client?.client_id) {
    throw new Error(`${credentialsPath} is not an OAuth client file`);
  }
  return client;
}

function saveToken(token: StoredToken) {
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function tokenRequest(
  client: ClientConfig,
  params: Record<string, string>,
) {
  const res = await fetch(client.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      ...params,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `Token request failed (${res.status}): ${body.error_description ?? body.error}`,
    );
  }
  return body as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
}

let cached: StoredToken | undefined;

export async function getAccessToken(): Promise<string> {
  if (!cached) {
    if (!existsSync(tokenPath)) {
      throw new Error(
        `Not signed in: no token at ${tokenPath}. Run "npm run auth" once.`,
      );
    }
    cached = JSON.parse(readFileSync(tokenPath, "utf8")) as StoredToken;
  }
  // Refresh a minute early so a request never goes out with a token that
  // expires mid-flight.
  if (Date.now() < cached.expires_at - 60_000) return cached.access_token;

  const refreshed = await tokenRequest(loadClient(), {
    grant_type: "refresh_token",
    refresh_token: cached.refresh_token,
  });
  cached = {
    ...cached,
    access_token: refreshed.access_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope ?? cached.scope,
  };
  saveToken(cached);
  return cached.access_token;
}

// One-time interactive sign-in: loopback redirect + PKCE, as Google
// recommends for desktop clients. Prints the consent URL and waits for the
// browser to come back to the local port.
export async function runAuthFlow(): Promise<void> {
  const client = loadClient();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const code = await new Promise<{ code: string; redirectUri: string }>(
    (resolveCode, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get("error");
        const got = url.searchParams.get("code");
        if (error || !got || url.searchParams.get("state") !== state) {
          res.writeHead(400).end(`Sign-in failed: ${error ?? "bad state"}`);
          server.close();
          reject(new Error(`Sign-in failed: ${error ?? "bad state"}`));
          return;
        }
        res
          .writeHead(200, { "content-type": "text/plain" })
          .end("Google Chat MCP is signed in. You can close this tab.");
        server.close();
        resolveCode({ code: got, redirectUri });
      });
      let redirectUri = "";
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        const authUrl = new URL(client.auth_uri);
        authUrl.search = new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString();
        console.log(`Open this URL to sign in:\n${authUrl.toString()}`);
      });
    },
  );

  const token = await tokenRequest(client, {
    grant_type: "authorization_code",
    code: code.code,
    redirect_uri: code.redirectUri,
    code_verifier: verifier,
  });
  if (!token.refresh_token) {
    throw new Error("Google returned no refresh token; run auth again");
  }
  saveToken({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + token.expires_in * 1000,
    scope: token.scope,
  });
  console.log(`Signed in. Token saved to ${tokenPath}`);
}
