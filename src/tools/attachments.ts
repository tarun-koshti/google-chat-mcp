import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createMessage, downloadMedia, getMessage, uploadAttachment } from "../chat.js";
import { assertWritable, fileInFilesDir, filesDir, readOnly } from "../safety.js";
import { ADDS, failure, text } from "./common.js";

// Google's upload limit.
const MAX_BYTES = 200 * 1024 * 1024;

// Chat keeps the type we send; with a generic type, images show as plain
// files instead of previews.
const TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".zip": "application/zip",
};
const contentType = (file: string) =>
  TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

// Both tools work only inside GOOGLE_CHAT_FILES_DIR, and are not registered
// without it.
export function registerAttachmentTools(server: McpServer) {
  if (!filesDir) return;

  server.registerTool(
    "download_attachment",
    {
      description:
        "Save a message's attachment into the files folder. Pass `file` when the message has " +
        "more than one. Google Drive files cannot be downloaded this way.",
      inputSchema: z.object({
        message: z.string().describe("spaces/XXXX/messages/YYYY"),
        file: z.string().optional().describe("Attachment name as shown by get_message"),
      }),
      // Reads Chat, but writes a local file.
      annotations: ADDS,
    },
    async ({ message, file }) => {
      try {
        const { attachment = [] } = await getMessage(message);
        const matches = file
          ? attachment.filter((a) => a.contentName === file)
          : attachment;
        if (matches.length !== 1) {
          return failure(
            `${matches.length} matching attachments; pass one of: ` +
              (attachment.map((a) => a.contentName).join(", ") || "(none)"),
          );
        }
        const [a] = matches;
        if (a.driveDataRef) {
          return failure(`${a.contentName} is a Google Drive file (id ${a.driveDataRef.driveFileId}); open it in Drive.`);
        }
        if (!a.attachmentDataRef?.resourceName) {
          return failure(`${a.contentName} has no downloadable data.`);
        }
        const data = await downloadMedia(a.attachmentDataRef.resourceName);
        const path = fileInFilesDir(basename(a.contentName ?? "attachment"), false);
        // "wx": never overwrite an existing file.
        writeFileSync(path, data, { flag: "wx" });
        return text(`Saved ${data.length} bytes to ${path}`);
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (readOnly) return;

  server.registerTool(
    "send_attachment",
    {
      description:
        "Upload a file from the files folder and send it AS THE USER, with optional text, " +
        "visible to everyone in the space. Get the user's approval for the file, text and space first.",
      inputSchema: z.object({
        space: z.string().describe("spaces/XXXX"),
        file: z.string().describe("File name inside the files folder"),
        text: z.string().optional(),
        thread: z.string().optional().describe("spaces/XXXX/threads/YYYY"),
      }),
      annotations: ADDS,
    },
    async ({ space, file, text: body, thread }) => {
      try {
        assertWritable(space);
        const path = fileInFilesDir(file, true);
        if (statSync(path).size > MAX_BYTES) return failure(`${file} is over 200 MB.`);
        const uploaded = await uploadAttachment(
          space,
          basename(path),
          readFileSync(path),
          contentType(path),
        );
        const sent = await createMessage(space, body, thread, [uploaded]);
        return text(`Sent ${sent.name} with ${basename(path)} at ${sent.createTime}`);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
