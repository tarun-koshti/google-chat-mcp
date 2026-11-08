import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createGroupChat,
  createSpace,
  deleteSpace,
  findDirectMessage,
  findGroupChats,
  getSpace,
  listSpaces,
  updateSpace,
  type Space,
} from "../chat.js";
import { assertCanCreateSpaces, assertWritable, readOnly } from "../safety.js";
import { ADDS, CHANGES, READS, failure, spaceLine, text } from "./common.js";

const spaceType = z.enum(["SPACE", "GROUP_CHAT", "DIRECT_MESSAGE"]);
const emails = z
  .array(z.string())
  .min(2)
  .max(49)
  .describe("The other people (not you): emails or users/{id} from list_members");

export function registerSpaceTools(server: McpServer) {
  server.registerTool(
    "list_spaces",
    {
      description:
        "List the Google Chat spaces, group chats and direct messages the user is in, " +
        "most recently active first. Use the returned space name (spaces/XXXX) with read_messages.",
      inputSchema: z.object({
        type: spaceType.optional(),
        pageToken: z.string().optional(),
      }),
      annotations: READS,
    },
    async ({ type, pageToken }) => {
      try {
        const { spaces = [], nextPageToken } = await listSpaces(
          type ? `spaceType = "${type}"` : undefined,
          100,
          pageToken,
        );
        spaces.sort((a, b) =>
          (b.lastActiveTime ?? "").localeCompare(a.lastActiveTime ?? ""),
        );
        const lines = spaces.map(spaceLine);
        if (nextPageToken) lines.push(`nextPageToken=${nextPageToken}`);
        return text(lines.join("\n") || "No spaces.");
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "search_spaces",
    {
      description:
        "Find spaces and group chats by name (case-insensitive, part of the name is enough), " +
        "most recently active first. The Chat API cannot filter by name, so this lists every " +
        "space the user is in and matches locally.",
      inputSchema: z.object({
        query: z.string().min(1),
        type: spaceType.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: READS,
    },
    async ({ query, type, limit = 25 }) => {
      try {
        const needle = query.toLowerCase();
        const found: Space[] = [];
        let pageToken: string | undefined;
        do {
          const page = await listSpaces(
            type ? `spaceType = "${type}"` : undefined,
            1000,
            pageToken,
          );
          for (const s of page.spaces ?? []) {
            if (s.displayName?.toLowerCase().includes(needle)) found.push(s);
          }
          pageToken = page.nextPageToken;
        } while (pageToken);
        if (!found.length) return text(`No spaces matching "${query}".`);
        found.sort((a, b) =>
          (b.lastActiveTime ?? "").localeCompare(a.lastActiveTime ?? ""),
        );
        const lines = found.slice(0, limit).map(spaceLine);
        if (found.length > limit) {
          lines.push(`...and ${found.length - limit} more; narrow the query or raise limit.`);
        }
        return text(lines.join("\n"));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_space",
    {
      description: "Details of one space: name, type, description, guidelines, member count, link.",
      inputSchema: z.object({ space: z.string().describe("spaces/XXXX") }),
      annotations: READS,
    },
    async ({ space }) => {
      try {
        const s = await getSpace(space);
        return text(
          [
            spaceLine(s),
            `created ${s.createTime ?? "-"}`,
            `members ${s.membershipCount?.joinedDirectHumanUserCount ?? "-"} people, ` +
              `${s.membershipCount?.joinedGroupCount ?? 0} groups`,
            `description: ${s.spaceDetails?.description || "-"}`,
            `guidelines: ${s.spaceDetails?.guidelines || "-"}`,
            `link: ${s.spaceUri ?? "-"}`,
          ].join("\n"),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "find_direct_message",
    {
      description:
        "Find the 1:1 direct message space with a colleague by their email address.",
      inputSchema: z.object({ email: z.string().describe("Email, or users/{id} from list_members") }),
      annotations: READS,
    },
    async ({ email }) => {
      try {
        const space = await findDirectMessage(email);
        return text(`${space.name}  last active ${space.lastActiveTime ?? "-"}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "find_group_chats",
    {
      description:
        "Find group chats whose members are exactly the user plus the given people.",
      inputSchema: z.object({ emails }),
      annotations: READS,
    },
    async ({ emails }) => {
      try {
        const { spaces = [] } = await findGroupChats(emails);
        return text(spaces.map(spaceLine).join("\n") || "No group chat with exactly these people.");
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (readOnly) return;

  server.registerTool(
    "update_space",
    {
      description:
        "Rename a space or change its description or guidelines. Names apply to named spaces only, " +
        "not group chats or DMs. Visible to everyone in the space; get the user's approval first.",
      inputSchema: z.object({
        space: z.string().describe("spaces/XXXX"),
        displayName: z.string().min(1).optional(),
        description: z.string().optional(),
        guidelines: z.string().optional(),
      }),
      annotations: CHANGES,
    },
    async ({ space, displayName, description, guidelines }) => {
      try {
        assertWritable(space);
        const fields: Partial<Space> = {};
        const mask: string[] = [];
        if (displayName !== undefined) {
          fields.displayName = displayName;
          mask.push("displayName");
        }
        if (description !== undefined || guidelines !== undefined) {
          // The API replaces both description and guidelines together, so
          // keep the current value of whichever one was not passed.
          const current = (await getSpace(space)).spaceDetails ?? {};
          fields.spaceDetails = {
            description: description ?? current.description ?? "",
            guidelines: guidelines ?? current.guidelines ?? "",
          };
          mask.push("spaceDetails");
        }
        if (!mask.length) return failure("Nothing to update.");
        // The update response leaves lastActiveTime empty, so no spaceLine here.
        const s = await updateSpace(space, fields, mask);
        return text(`Updated ${s.name}  ${s.displayName ?? ""}  (${mask.join(", ")})`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_space",
    {
      description:
        "Create a named space with the user as its only member. The name must be unique in " +
        "the organisation. Get the user's approval first.",
      inputSchema: z.object({
        displayName: z.string().min(1),
        description: z.string().optional(),
      }),
      annotations: ADDS,
    },
    async ({ displayName, description }) => {
      try {
        assertCanCreateSpaces();
        const s = await createSpace(displayName, description);
        return text(`Created ${spaceLine(s)}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "delete_space",
    {
      description:
        "Permanently delete a space and every message in it, for everyone. Cannot be undone; " +
        "get the user's approval first.",
      inputSchema: z.object({ space: z.string().describe("spaces/XXXX") }),
      annotations: CHANGES,
    },
    async ({ space }) => {
      try {
        assertWritable(space);
        await deleteSpace(space);
        return text(`Deleted ${space}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_group_chat",
    {
      description:
        "Start an unnamed group chat with the user and 2 to 49 other people. If a group chat with " +
        "exactly these people already exists, it is returned instead. Get the user's approval first.",
      inputSchema: z.object({ emails }),
      annotations: ADDS,
    },
    async ({ emails }) => {
      try {
        assertCanCreateSpaces();
        const { spaces = [] } = await findGroupChats(emails);
        if (spaces.length) return text(`Already exists: ${spaceLine(spaces[0])}`);
        const s = await createGroupChat(emails);
        return text(`Created ${spaceLine(s)}`);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
