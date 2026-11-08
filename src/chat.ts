import { randomBytes } from "node:crypto";

import { getAccessToken } from "./auth.js";

const BASE = "https://chat.googleapis.com";

type Query = Record<string, string | string[] | undefined>;

async function send(
  path: string,
  init: { method?: string; query?: Query; headers?: Record<string, string>; body?: BodyInit } = {},
): Promise<Response> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    // Arrays become repeated params (users=a&users=b).
    for (const item of [v].flat()) {
      if (item !== undefined && item !== "") url.searchParams.append(k, item);
    }
  }
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${await getAccessToken()}`, ...init.headers },
    body: init.body,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).error?.message ?? text;
    } catch {}
    throw new Error(`Chat API ${res.status} on ${path}: ${message}`);
  }
  return res;
}

async function call<T>(
  path: string,
  init: { method?: string; query?: Query; body?: unknown } = {},
): Promise<T> {
  const res = await send(`v1/${path}`, {
    method: init.method,
    query: init.query,
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export interface Space {
  name: string;
  displayName?: string;
  spaceType?: string;
  lastActiveTime?: string;
  createTime?: string;
  spaceUri?: string;
  spaceDetails?: { description?: string; guidelines?: string };
  membershipCount?: { joinedDirectHumanUserCount?: number; joinedGroupCount?: number };
}

export interface Attachment {
  name?: string;
  contentName?: string;
  contentType?: string;
  attachmentDataRef?: { resourceName?: string };
  driveDataRef?: { driveFileId?: string };
}

export interface Message {
  name: string;
  sender?: { name: string; displayName?: string; type?: string };
  createTime: string;
  lastUpdateTime?: string;
  text?: string;
  formattedText?: string;
  thread?: { name: string };
  threadReply?: boolean;
  attachment?: Attachment[];
}

export interface Membership {
  name?: string;
  state?: string;
  role?: string;
  createTime?: string;
  member?: { name: string; displayName?: string; type?: string };
}

// People are passed as an email or users/{id}; the API takes users/{either}.
const userName = (user: string) => (user.startsWith("users/") ? user : `users/${user}`);
const asUser = (user: string) => ({ name: userName(user), type: "HUMAN" });

// Spaces

export function listSpaces(filter?: string, pageSize = 100, pageToken?: string) {
  return call<{ spaces?: Space[]; nextPageToken?: string }>("spaces", {
    query: { filter, pageSize: String(pageSize), pageToken },
  });
}

export function getSpace(space: string) {
  return call<Space>(space);
}

export function updateSpace(space: string, fields: Partial<Space>, updateMask: string[]) {
  return call<Space>(space, {
    method: "PATCH",
    query: { updateMask: updateMask.join(",") },
    body: fields,
  });
}

// A named space with the caller as its only member.
export function createSpace(displayName: string, description?: string) {
  return call<Space>("spaces", {
    method: "POST",
    body: {
      spaceType: "SPACE",
      displayName,
      ...(description ? { spaceDetails: { description } } : {}),
    },
  });
}

// Cascading and permanent: messages and memberships go with it.
export function deleteSpace(space: string) {
  return call<object>(space, { method: "DELETE" });
}

export function findDirectMessage(user: string) {
  return call<Space>("spaces:findDirectMessage", {
    query: { name: userName(user) },
  });
}

// Group chats whose members are exactly the caller plus `users`.
export function findGroupChats(users: string[]) {
  return call<{ spaces?: Space[] }>("spaces:findGroupChats", {
    query: {
      users: users.map(userName),
      spaceView: "SPACE_VIEW_EXPANDED",
      pageSize: "30",
    },
  });
}

export function createGroupChat(users: string[]) {
  return call<Space>("spaces:setup", {
    method: "POST",
    body: {
      space: { spaceType: "GROUP_CHAT" },
      memberships: users.map((u) => ({ member: asUser(u) })),
    },
  });
}

// Messages

export function listMessages(
  space: string,
  opts: { pageSize?: number; filter?: string; pageToken?: string; orderBy?: string },
) {
  return call<{ messages?: Message[]; nextPageToken?: string }>(
    `${space}/messages`,
    {
      query: {
        pageSize: String(opts.pageSize ?? 25),
        orderBy: opts.orderBy,
        filter: opts.filter,
        pageToken: opts.pageToken,
      },
    },
  );
}

export function getMessage(message: string) {
  return call<Message>(message);
}

export function createMessage(
  space: string,
  text: string | undefined,
  threadName?: string,
  attachment?: unknown[],
) {
  return call<Message>(`${space}/messages`, {
    method: "POST",
    query: threadName
      ? { messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" }
      : {},
    body: {
      text,
      ...(threadName ? { thread: { name: threadName } } : {}),
      ...(attachment ? { attachment } : {}),
    },
  });
}

export function updateMessage(message: string, text: string) {
  return call<Message>(message, {
    method: "PATCH",
    query: { updateMask: "text" },
    body: { text },
  });
}

// Fails if the message has thread replies (force is left off).
export function deleteMessage(message: string) {
  return call<object>(message, { method: "DELETE" });
}

// Members. `member` is an email or users/{id}; both work as the member id.

const memberPath = (space: string, member: string) =>
  `${space}/members/${member.replace(/^users\//, "")}`;

export function listMembers(space: string, pageToken?: string) {
  return call<{ memberships?: Membership[]; nextPageToken?: string }>(
    `${space}/members`,
    { query: { pageSize: "1000", pageToken } },
  );
}

export function getMember(space: string, member: string) {
  return call<Membership>(memberPath(space, member));
}

export function addMember(space: string, user: string) {
  return call<Membership>(`${space}/members`, {
    method: "POST",
    body: { member: asUser(user) },
  });
}

export function removeMember(space: string, member: string) {
  return call<Membership>(memberPath(space, member), { method: "DELETE" });
}

// Attachments

// Multipart upload: a JSON part with the file name, then the file bytes.
// Returns the object to pass in a message's `attachment` list.
export async function uploadAttachment(
  space: string,
  filename: string,
  data: Buffer,
  contentType: string,
) {
  const boundary = `chat-mcp-${randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ filename })}\r\n` +
        `--${boundary}\r\ncontent-type: ${contentType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await send(`upload/v1/${space}/attachments:upload`, {
    method: "POST",
    query: { uploadType: "multipart" },
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()) as { attachmentDataRef: { resourceName?: string } };
}

// Uploaded files only; Google Drive attachments need the Drive API.
export async function downloadMedia(resourceName: string) {
  const res = await send(`v1/media/${resourceName}`, { query: { alt: "media" } });
  return Buffer.from(await res.arrayBuffer());
}
