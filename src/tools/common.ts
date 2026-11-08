import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import { listMembers, type Message, type Space } from "../chat.js";

export const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
export const failure = (error: unknown) => ({
  isError: true,
  ...text(error instanceof Error ? error.message : String(error)),
});

// Hints for MCP clients, e.g. which calls to ask about. The server does not
// enforce them; read-only mode and the allowlist do.
export const READS: ToolAnnotations = { readOnlyHint: true };
export const ADDS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false };
export const CHANGES: ToolAnnotations = { readOnlyHint: false, destructiveHint: true };

export function spaceLine(s: Space): string {
  const label =
    s.displayName ||
    (s.spaceType === "DIRECT_MESSAGE" ? "(direct message)" : "(unnamed)");
  return `${s.name}  ${s.spaceType}  ${label}  last active ${s.lastActiveTime ?? "-"}`;
}

// users/{id} -> display name, per space. Chat messages carry only the sender's
// resource name under user auth, so names come from the space's member list.
const memberNames = new Map<string, Map<string, string>>();

export async function namesFor(space: string): Promise<Map<string, string>> {
  let names = memberNames.get(space);
  if (!names) {
    names = new Map();
    try {
      const { memberships = [] } = await listMembers(space);
      for (const m of memberships) {
        if (m.member?.name && m.member.displayName) {
          names.set(m.member.name, m.member.displayName);
        }
      }
    } catch {
      // Names are a nicety; fall back to raw user ids rather than fail the read.
    }
    memberNames.set(space, names);
  }
  return names;
}

export function formatMessage(m: Message, names: Map<string, string>): string {
  const who =
    m.sender?.displayName ||
    (m.sender?.name && names.get(m.sender.name)) ||
    m.sender?.name ||
    "unknown";
  const files = m.attachment?.length
    ? ` [attachments: ${m.attachment.map((a) => a.contentName ?? "file").join(", ")}]`
    : "";
  return (
    `[${m.createTime}] ${who}${m.sender?.type === "BOT" ? " (app)" : ""}: ` +
    `${m.text ?? ""}${files}\n  message=${m.name} thread=${m.thread?.name ?? "-"}`
  );
}
