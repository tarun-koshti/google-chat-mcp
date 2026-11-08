import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createMessage,
  deleteMessage,
  getMessage,
  listMessages,
  updateMessage,
} from "../chat.js";
import { assertWritable, readOnly, spaceOf } from "../safety.js";
import { ADDS, CHANGES, READS, failure, formatMessage, namesFor, text } from "./common.js";

const messageName = z.string().describe("spaces/XXXX/messages/YYYY");

export function registerMessageTools(server: McpServer) {
  server.registerTool(
    "read_messages",
    {
      description:
        "Read messages in a space, oldest first in the output. Returns the most recent `limit` " +
        "messages, optionally only those after `since` (RFC 3339, e.g. 2026-10-30T00:00:00+05:30).",
      inputSchema: z.object({
        space: z.string().describe("spaces/XXXX"),
        limit: z.number().int().min(1).max(100).optional(),
        since: z.string().optional(),
        pageToken: z.string().optional(),
      }),
      annotations: READS,
    },
    async ({ space, limit, since, pageToken }) => {
      try {
        const [{ messages = [], nextPageToken }, names] = await Promise.all([
          listMessages(space, {
            pageSize: limit ?? 25,
            orderBy: "createTime desc",
            filter: since ? `createTime > "${since}"` : undefined,
            pageToken,
          }),
          namesFor(space),
        ]);
        const lines = messages.reverse().map((m) => formatMessage(m, names));
        if (nextPageToken) lines.unshift(`older messages: pageToken=${nextPageToken}`);
        return text(lines.join("\n") || "No messages.");
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_message",
    {
      description:
        "One message with its sender, text, thread and attachments (name and type).",
      inputSchema: z.object({ message: messageName }),
      annotations: READS,
    },
    async ({ message }) => {
      try {
        const [m, names] = await Promise.all([
          getMessage(message),
          namesFor(spaceOf(message)),
        ]);
        const files = (m.attachment ?? []).map(
          (a) =>
            `  attachment: ${a.contentName ?? "file"} (${a.contentType ?? "?"})` +
            (a.driveDataRef ? " [Google Drive file]" : ""),
        );
        const edited = m.lastUpdateTime ? [`  edited ${m.lastUpdateTime}`] : [];
        return text([formatMessage(m, names), ...edited, ...files].join("\n"));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_thread",
    {
      description:
        "Every message in a thread, oldest first. Get the thread name from read_messages.",
      inputSchema: z.object({
        thread: z.string().describe("spaces/XXXX/threads/YYYY"),
        limit: z.number().int().min(1).max(100).optional(),
        pageToken: z.string().optional(),
      }),
      annotations: READS,
    },
    async ({ thread, limit, pageToken }) => {
      try {
        const space = spaceOf(thread);
        const [{ messages = [], nextPageToken }, names] = await Promise.all([
          listMessages(space, {
            pageSize: limit ?? 100,
            filter: `thread.name = ${thread}`,
            pageToken,
          }),
          namesFor(space),
        ]);
        const lines = messages.map((m) => formatMessage(m, names));
        if (nextPageToken) lines.push(`more replies: pageToken=${nextPageToken}`);
        return text(lines.join("\n") || "No messages in this thread.");
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (readOnly) return;

  server.registerTool(
    "send_message",
    {
      description:
        "Send a Google Chat message AS THE USER, visible to everyone in the space. Only call this " +
        "after the user has approved this exact text and destination in the conversation; any " +
        "rewording needs a fresh approval. Pass `thread` (from read_messages) to reply in a thread.",
      inputSchema: z.object({
        space: z.string().describe("spaces/XXXX"),
        text: z.string().min(1),
        thread: z.string().optional().describe("spaces/XXXX/threads/YYYY"),
      }),
      annotations: ADDS,
    },
    async ({ space, text: body, thread }) => {
      try {
        assertWritable(space);
        const sent = await createMessage(space, body, thread);
        return text(`Sent ${sent.name} at ${sent.createTime}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "edit_message",
    {
      description:
        "Replace the text of one of the user's own messages. Everyone sees it as edited. " +
        "Get the user's approval for the new text first.",
      inputSchema: z.object({ message: messageName, text: z.string().min(1) }),
      annotations: CHANGES,
    },
    async ({ message, text: body }) => {
      try {
        assertWritable(spaceOf(message));
        const m = await updateMessage(message, body);
        return text(`Edited ${m.name}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "delete_message",
    {
      description:
        "Delete one of the user's own messages. Fails if the message has thread replies. " +
        "Cannot be undone; get the user's approval first.",
      inputSchema: z.object({ message: messageName }),
      annotations: CHANGES,
    },
    async ({ message }) => {
      try {
        assertWritable(spaceOf(message));
        await deleteMessage(message);
        return text(`Deleted ${message}`);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
