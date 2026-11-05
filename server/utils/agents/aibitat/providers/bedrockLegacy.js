/**
 * RagmyAI: legacy AWS Bedrock agent provider (IAM credentials, bedrock-runtime
 * Converse API via @langchain/aws). Ported from AnythingLLM v1.8.5 and adapted
 * to the v1.19.0 UnTooled helpers. Registered under the provider key "bedrock"
 * (see aibitat/index.js); upstream's Mantle provider is registered as "bedrock_mantle".
 * Reads AWS_BEDROCK_LEGACY_LLM_* env vars.
 */
const {
  SUPPORTED_CONNECTION_METHODS,
} = require("../../../AiProviders/bedrockLegacy/utils.js");
const Provider = require("./ai-provider.js");
const InheritMultiple = require("./helpers/classes.js");
const UnTooled = require("./helpers/untooled.js");
const { ChatBedrockConverse } = require("@langchain/aws");
const {
  HumanMessage,
  SystemMessage,
  AIMessage,
} = require("@langchain/core/messages");

class AWSBedrockLegacyProvider extends InheritMultiple([Provider, UnTooled]) {
  model;

  constructor(config = {}) {
    super();
    const model =
      config.model || process.env.AWS_BEDROCK_LEGACY_LLM_MODEL_PREFERENCE || null;
    const client = new ChatBedrockConverse({
      region: process.env.AWS_BEDROCK_LEGACY_LLM_REGION,
      credentials: this.credentials,
      model,
    });

    this._client = client;
    this.model = model;
    this.verbose = true;
  }

  /**
   * Gets the credentials for AWS Bedrock based on the authentication method.
   * @returns {object|undefined} The credentials object.
   */
  get credentials() {
    switch (this.authMethod) {
      case "iam": // explicit credentials
        return {
          accessKeyId: process.env.AWS_BEDROCK_LEGACY_LLM_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_BEDROCK_LEGACY_LLM_ACCESS_KEY,
        };
      case "sessionToken": // temporary credentials
        return {
          accessKeyId: process.env.AWS_BEDROCK_LEGACY_LLM_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_BEDROCK_LEGACY_LLM_ACCESS_KEY,
          sessionToken: process.env.AWS_BEDROCK_LEGACY_LLM_SESSION_TOKEN,
        };
      // IAM role: the AWS SDK fills credentials from the process environment
      case "iam_role":
      default:
        return undefined;
    }
  }

  /**
   * @returns {"iam" | "iam_role" | "sessionToken"} The authentication method.
   */
  get authMethod() {
    const method = process.env.AWS_BEDROCK_LEGACY_LLM_CONNECTION_METHOD || "iam";
    return SUPPORTED_CONNECTION_METHODS.includes(method) ? method : "iam";
  }

  get client() {
    return this._client;
  }

  #convertToLangchainPrototypes(chats = []) {
    const langchainChats = [];
    const roleToMessageMap = {
      system: SystemMessage,
      user: HumanMessage,
      assistant: AIMessage,
    };

    for (const chat of chats) {
      if (!roleToMessageMap.hasOwnProperty(chat.role)) continue;
      const MessageClass = roleToMessageMap[chat.role];
      langchainChats.push(new MessageClass({ content: chat.content }));
    }

    return langchainChats;
  }

  async #handleFunctionCallChat({ messages = [] }) {
    const response = await this.client
      .invoke(this.#convertToLangchainPrototypes(messages))
      .then((res) => res)
      .catch((e) => {
        console.error(e);
        return null;
      });

    return response?.content ?? "";
  }

  /**
   * Prompt-based (untooled) tool calling, as in v1.8.5. Native tool calling
   * is not used for this provider.
   */
  supportsNativeToolCalling() {
    return false;
  }

  async complete(messages, functions = []) {
    return await UnTooled.prototype.complete.call(
      this,
      messages,
      functions,
      this.#handleFunctionCallChat.bind(this)
    );
  }

  /**
   * @param _usage The completion to get the cost for.
   * @returns {number} Stubbed, no cost tracking.
   */
  getCost(_usage) {
    return 0;
  }
}

module.exports = AWSBedrockLegacyProvider;
