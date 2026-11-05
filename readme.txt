sudo docker buildx build --platform linux/amd64 -t koosoftware/anything-llm:ragmyai-v1.19.0.1 -f ./docker/Dockerfile .
sudo docker push koosoftware/anything-llm:ragmyai-v1.19.0.1

v1.19.0.1 (not released yet)
------------------------
Based on upstream AnythingLLM v1.19.0 (pg branch). RagmyAI customizations re-applied from v1.8.5.10:
- AWS Bedrock split for backward compatibility with the RagmyAI server:
  "bedrock" = legacy IAM / bedrock-runtime Converse provider (Llama 4 Scout), env AWS_BEDROCK_LEGACY_LLM_*
  "bedrock_mantle" = upstream API-key / Mantle provider (Gemma 4), env AWS_BEDROCK_LLM_*
- Developer API: DELETE /v1/workspace/:slug/delete-chats, POST /v1/workspace/:slug/parse-file,
  DELETE /v1/workspace/:slug/delete-parsed-files
- Parsed files per API chat session (workspace_parsed_files.sessionId, new migration) injected into stream-chat
- chatId returned in stream-chat responses for agent (@agent) chats (normal chats return it upstream)
- Link scraping hardening: block images/media/fonts and iframe navigations, always close Chrome
- Optional max output tokens: GEMINI_LLM_MAX_TOKENS, AZURE_OPENAI_MAX_TOKENS
- server/yarn.lock: @aws-sdk/client-bedrock-runtime 3.775.0 and @langchain/aws 0.0.5 (plus their dependencies) locked to the
  versions used by v1.8.5.10, because the latest AWS SDK requires Node 20 and the Docker image uses Node 18
Not ported (now upstream or unused): Postgres/pgvector setup, Groq rewrite, Gemma thinking tweak on the Gemini API,
native embedder / LanceDB caches, Bedrock Mantle frontend settings.

===== History from the v1.8.5 fork =====

v1.8.5.10 (15-Oct-2026)
------------------------
- Fix scrapping https://www.qncor.ca/investors?d8751c07_page=1 will freeze the server

v1.8.5.9 (29-Sep-2026)
-----------------------
- Fix scrapping https://alice-bob.com will freeze the server

v1.8.5.8 (24-Sep-2026)
-----------------------
- Revert Gemini 2.5 Flash not to use reasoning_effort none
- Added max token to Azure OpenAI

v1.8.5.7 (24-Sep-2026)
-----------------------
- Set Gemini 2.5 Flash to use reasoning_effort none

v1.8.5.6 (24-Sep-2026)
-----------------------
- Added max token to Gemini

v1.8.5.5 (23-Sep-2026)
-----------------------
- Fix max token not working in AWS Bedrock Mantle

v1.8.5.4 (28-Aug-2026)
-----------------------
- Fix bedrock mantle path for Gemma 4 31B


v1.8.5.3 (28-Aug-2026)
------------------------
- Added bedrock mantle


v1.8.5.2
-----------
- Remove <thought> from Gemini API using gemma4
- Fix slow chat response when vector count not empty