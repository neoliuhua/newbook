import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { AiBaseModelPrivider } from '.';
import { createAnthropic } from '@ai-sdk/anthropic';


export class AnthropicModelProvider extends AiBaseModelPrivider {
  constructor({ globalConfig }) {
    super({ globalConfig });
    this.provider = createAnthropic({
      apiKey: this.globalConfig.aiApiKey,
      baseURL: this.globalConfig.aiApiEndpoint || undefined,
    });
  }

  LLM() {
    try {
      return this.provider.languageModel(this.globalConfig.aiModel ?? 'claude-3-5-sonnet-20241022')
    } catch (error) {
      throw error
    }
  }

  Embeddings() {
    try {
      return this.provider.textEmbeddingModel(this.globalConfig.embeddingModel ?? 'text-embedding-3-small')
    } catch (error) {
      throw error
    }
  }
}

