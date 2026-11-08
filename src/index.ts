import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runAuthFlow } from "./auth.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerMemberTools } from "./tools/members.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerSpaceTools } from "./tools/spaces.js";

async function main() {
  if (process.argv[2] === "auth") {
    await runAuthFlow();
    return;
  }

  const server = new McpServer({ name: "google-chat", version: "1.0.0" });
  registerSpaceTools(server);
  registerMessageTools(server);
  registerMemberTools(server);
  registerAttachmentTools(server);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
