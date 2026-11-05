-- RagmyAI: parsed files attached to an API chat session ("Ask doc")
-- AlterTable
ALTER TABLE "workspace_parsed_files" ADD COLUMN "sessionId" TEXT;
