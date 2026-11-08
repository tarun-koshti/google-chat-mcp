import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  addMember,
  getMember,
  listMembers,
  removeMember,
  type Membership,
} from "../chat.js";
import { assertWritable, readOnly } from "../safety.js";
import { ADDS, CHANGES, READS, failure, text } from "./common.js";

const space = z.string().describe("spaces/XXXX");
const member = z.string().describe("Email, or users/{id} from list_members");

const memberLine = (m: Membership) =>
  `${m.member?.name ?? "-"}  ${m.member?.displayName ?? "-"}  ${m.member?.type ?? "-"}  ` +
  `${m.role ?? "-"}  ${m.state ?? "-"}`;

export function registerMemberTools(server: McpServer) {
  server.registerTool(
    "list_members",
    {
      description:
        "Members of a space: user id, name, type (HUMAN/BOT), role (member/manager) and state (joined/invited).",
      inputSchema: z.object({ space, pageToken: z.string().optional() }),
      annotations: READS,
    },
    async ({ space, pageToken }) => {
      try {
        const { memberships = [], nextPageToken } = await listMembers(space, pageToken);
        const lines = memberships.map(memberLine);
        if (nextPageToken) lines.push(`nextPageToken=${nextPageToken}`);
        return text(lines.join("\n") || "No members visible.");
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_member",
    {
      description: "One person's membership in a space: role, state and when they joined.",
      inputSchema: z.object({ space, member }),
      annotations: READS,
    },
    async ({ space, member }) => {
      try {
        const m = await getMember(space, member);
        return text(`${memberLine(m)}  since ${m.createTime ?? "-"}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (readOnly) return;

  server.registerTool(
    "add_member",
    {
      description:
        "Add a person to a space by email. They are notified, or get an invitation if they do not " +
        "auto-accept. Get the user's approval first.",
      inputSchema: z.object({ space, email: member }),
      annotations: ADDS,
    },
    async ({ space, email }) => {
      try {
        assertWritable(space);
        // The create response leaves the display name empty, so name the
        // person from the input.
        const m = await addMember(space, email);
        return text(`Added ${email} to ${space}: ${m.member?.name ?? "-"}  ${m.state ?? "-"}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "remove_member",
    {
      description:
        "Remove a person from a space. Removing a manager needs the user to be a manager. " +
        "Get the user's approval first.",
      inputSchema: z.object({ space, member }),
      annotations: CHANGES,
    },
    async ({ space, member }) => {
      try {
        assertWritable(space);
        await removeMember(space, member);
        return text(`Removed ${member} from ${space}`);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
