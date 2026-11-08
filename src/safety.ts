import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const env = (name: string) => process.env[name]?.trim() || undefined;

// Read-only mode: write tools are not registered, and sign-in asks Google for
// read-only scopes only, so the token itself cannot write.
export const readOnly = env("GOOGLE_CHAT_READ_ONLY") === "true";

// Optional allowlist (comma-separated spaces/XXXX) for every tool that writes
// to or deletes a space. Unset means any space the user is in.
const allowedSpaces = env("GOOGLE_CHAT_ALLOWED_SPACES")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function assertWritable(space: string) {
  if (allowedSpaces && !allowedSpaces.includes(space)) {
    throw new Error(`${space} is not in GOOGLE_CHAT_ALLOWED_SPACES`);
  }
}

// A new space cannot be on the allowlist yet, so creating one is refused
// while the allowlist is set.
export function assertCanCreateSpaces() {
  if (allowedSpaces) {
    throw new Error("Creating spaces is off while GOOGLE_CHAT_ALLOWED_SPACES is set");
  }
}

// spaces/AAA/messages/BBB -> spaces/AAA
export const spaceOf = (resource: string) =>
  resource.split("/").slice(0, 2).join("/");

// The only folder the attachment tools read from or write to. Unset means the
// attachment tools are not registered at all.
export const filesDir = env("GOOGLE_CHAT_FILES_DIR");

// Resolves `name` inside filesDir. Refuses ../, absolute paths, and symlinks
// that point outside, so an agent cannot upload ~/.ssh or .env into a chat.
export function fileInFilesDir(name: string, mustExist: boolean): string {
  if (!filesDir) throw new Error("GOOGLE_CHAT_FILES_DIR is not set");
  const root = realpathSync(filesDir);
  const path = resolve(root, name);
  const real = mustExist ? realpathSync(path) : path;
  const rel = relative(root, real);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${name} is outside GOOGLE_CHAT_FILES_DIR`);
  }
  return real;
}
