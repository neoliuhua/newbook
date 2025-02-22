import { cache } from "@/lib/cache"
import { AzureOpenAIModelProvider } from "./providers/azureOpenAI"
import { OpenAIModelProvider } from "./providers/openAI"
import { getGlobalConfig } from "@/server/routers/config"
import { OllamaModelProvider } from "./providers/ollama"
import { AnthropicModelProvider } from "./providers/anthropic"
import { Agent } from "@mastra/core/agent";
import { createBlinkoTool } from "./tools/createBlinko"
import { DefaultVectorDB } from "@mastra/core/vector/libsql"
import { DeepSeekModelProvider } from "./providers/deepseek"
import dayjs from "dayjs"
import { createLogger, Mastra } from "@mastra/core";
import { LanguageModelV1, EmbeddingModelV1 } from "@ai-sdk/provider";
import { MarkdownTextSplitter, TokenTextSplitter } from "@langchain/textsplitters"
import { embed } from "ai";
import { prisma } from "@/server/prisma"
import { _ } from "@/lib/lodash"
import { VECTOR_DB_FILE_PATH } from "@/lib/constant"

export class AiModelFactory {
  //metadata->>'id'
  static async queryAndDeleteVectorById(indexName: string, targetId: string) {
    const store = new DefaultVectorDB({ connectionUrl: VECTOR_DB_FILE_PATH });
    try {
      const query = `
          WITH target_record AS (
            SELECT vector_id 
            FROM ${indexName} 
            WHERE metadata->>'id' = ? 
            LIMIT 1
          )
          DELETE FROM ${indexName}
          WHERE vector_id IN (SELECT vector_id FROM target_record)
          RETURNING *;`;
      //@ts-ignore
      const result = await store.turso.execute({
        sql: query,
        args: [targetId]
      });

      if (result.rows.length === 0) {
        throw new Error(`id  ${targetId} is not found`);
      }

      return {
        success: true,
        deletedData: result.rows[0]
      };

    } catch (error) {
      console.error('delete vector failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'unknown error'
      };
    }
  }

  static async queryVector(query: string, accountId: number) {
    const { VectorStore, Embeddings } = await AiModelFactory.GetProvider()
    const config = await AiModelFactory.globalConfig()
    const topK = config.embeddingTopK ?? 3
    const embeddingMinScore = config.embeddingScore ?? 0.4
    const { embedding } = await embed({
      value: query,
      model: Embeddings,
    });
    const result = await VectorStore.query('blinko', embedding, topK);
    const filteredResults = result
      .filter(({ score }) => score > embeddingMinScore)

    return (await prisma.notes.findMany({
      where: {
        accountId: accountId,
        id: {
          in: _.uniqWith(filteredResults.map(i => Number(i.metadata?.id))).filter(i => !!i) as number[]
        }
      },
      include: {
        attachments: true
      }
    })).map(i => { return { ...i, score: filteredResults.find(t => Number(t.metadata?.id) == i.id)?.score ?? 0 } }) ?? [];
  }

  static async rebuildVectorIndex(vectorStore: DefaultVectorDB) {
    try {
      await vectorStore.deleteIndex('blinko');
    } catch (error) {
      console.error('delete vector index failed:', error);
    }

    const config = await AiModelFactory.globalConfig()
    const model = config.embeddingModel.toLowerCase();
    let dimensions: number;
    switch (true) {
      case model.includes('text-embedding-3-small'):
        dimensions = 1536;
        break;
      case model.includes('text-embedding-3-large'):
        dimensions = 3072;
        break;
      case model.includes('cohere/embed-english-v3') || model.includes('bge-m3'):
        dimensions = 1024;
        break;
      case model.includes('cohere'):
        dimensions = 4096;
        break;
      case model.includes('bge-large'):
        dimensions = 1024;
        break;
      case model.includes('bge') || model.includes('bert') || model.includes('bce-embedding-base'):
        dimensions = 768;
        break;
      case model.includes('all-minilm'):
        dimensions = 384;
        break;
      default:
        dimensions = 1536;
    }
    await vectorStore.createIndex('blinko', dimensions);
  }

  static async globalConfig() {
    return cache.wrap('globalConfig', async () => {
      return await getGlobalConfig({ useAdmin: true })
    }, { ttl: 1000 })
  }

  static async ValidConfig() {
    const globalConfig = await AiModelFactory.globalConfig()
    if (!globalConfig.aiModelProvider || !globalConfig.isUseAI) {
      throw new Error('model provider or apikey not configure!')
    }
    return await AiModelFactory.globalConfig()
  }

  static async GetProvider() {
    const globalConfig = await AiModelFactory.ValidConfig()

    return cache.wrap(`GetProvider-
      ${globalConfig.aiModelProvider}-
      ${globalConfig.aiApiKey}-
      ${globalConfig.embeddingModel}-
      ${globalConfig.embeddingApiKey}-
      ${globalConfig.aiModel}-
      ${globalConfig.aiApiEndpoint}-
      ${globalConfig.embeddingTopK}-
      ${globalConfig.embeddingScore}
      `, async () => {

      const createProviderResult = async (provider: any) => ({
        LLM: provider.LLM() as LanguageModelV1,
        VectorStore: await provider.VectorStore() as DefaultVectorDB,
        Embeddings: provider.Embeddings() as EmbeddingModelV1<string>,
        MarkdownSplitter: provider.MarkdownSplitter() as MarkdownTextSplitter,
        TokenTextSplitter: provider.TokenTextSplitter() as TokenTextSplitter,
      });

      switch (globalConfig.aiModelProvider) {
        case 'OpenAI':
          return createProviderResult(new OpenAIModelProvider({ globalConfig }));
        case 'AzureOpenAI':
          return createProviderResult(new AzureOpenAIModelProvider({ globalConfig }));
        case 'Ollama':
          return createProviderResult(new OllamaModelProvider({ globalConfig }));
        case 'DeepSeek':
          return createProviderResult(new DeepSeekModelProvider({ globalConfig }));
        case 'Anthropic':
          return createProviderResult(new AnthropicModelProvider({ globalConfig }));
        default:
          throw new Error(`Unsupported AI model provider: ${globalConfig.aiModelProvider}`);
      }
    }, { ttl: 24 * 60 * 60 * 1000 })
  }



  static async BaseChatAgent({ withTools = true }: { withTools?: boolean }) {
    //globel.model.name cache
    const provider = await AiModelFactory.GetProvider()
    let tools: Record<string, any> = {}
    if (withTools) {
      tools = {
        createBlinkoTool
      }
    }
    const BlinkoAgent = new Agent({
      name: 'Blinko Chat Agent',
      instructions: `Today is ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
        "You are a versatile AI assistant who can:\n" +
        "1. Answer questions and explain concepts\n" +
        "2. Provide suggestions and analysis\n" +
        "3. Help with planning and organizing ideas\n" +
        "4. Assist with content creation and editing\n" +
        "5. Perform basic calculations and reasoning\n\n" +
        "Always respond in the user's language.\n" +
        "Maintain a friendly and professional conversational tone.",
      model: provider?.LLM!,
      ...tools
    });

    const mastra = new Mastra({
      agents: { BlinkoAgent },
      logger: createLogger({ name: 'Blinko', level: 'info' }),
    });
    return mastra.getAgent('BlinkoAgent')
  }

  static async TagAgent(tags: string[]) {
    const provider = await AiModelFactory.GetProvider();
    const systemPrompt = `You are a precision tag classification expert. Rules:
      1. Select 5 most relevant tags from existing list
      2. Create new tags in #category/subcategory format if needed
      3. Return comma-separated tags only
      
      Available tags: ${tags.join(', ')}
      Example: #technology/ai, #development/backend`;

    const agent = new Agent({
      name: 'Blinko Tagging Agent',
      instructions: systemPrompt,
      model: provider?.LLM!
    });

    return new Mastra({
      agents: { agent },
      logger: createLogger({ name: 'BlinkoTag', level: 'info' })
    }).getAgent('agent');
  }

  static async EmojiAgent() {
    const provider = await AiModelFactory.GetProvider();
    const systemPrompt = `You are an emoji recommendation expert. Rules:
      1. Analyze content theme and emotion
      2. Return 4-10 comma-separated emojis
      3. Use 💻🔧 for tech content, 😊🎉 for emotional content
      Example: 🚀,💻,🔧,📱`;

    const agent = new Agent({
      name: 'Blinko Emoji Agent',
      instructions: systemPrompt,
      model: provider?.LLM!
    });

    return new Mastra({
      agents: { agent },
      logger: createLogger({ name: 'BlinkoEmoji', level: 'info' })
    }).getAgent('agent');
  }

  static async WritingAgent(type: 'expand' | 'polish' | 'custom' = 'custom') {
    const provider = await AiModelFactory.GetProvider();
    const prompts = {
      expand: `You are a writing expansion assistant. Requirements:
        1. Use same language as input
        2. Add details and examples
        3. Maintain original style
        Original: {content}`,

      polish: `You are a text polishing expert. Requirements:
        1. Optimize wording and sentence structure
        2. Keep core meaning
        3. Use Markdown formatting
        Original: {content}`,

      custom: `You are a multi-purpose writing assistant. Requirements:
        1. Create content as needed
        2. Follow technical documentation standards
        Original: {content}`
    };

    const agent = new Agent({
      name: `Blinko Writing Agent - ${type}`,
      instructions: prompts[type],
      model: provider?.LLM!
    });

    return new Mastra({
      agents: { agent },
      logger: createLogger({ name: 'BlinkoWriting', level: 'info' })
    }).getAgent('agent');
  }

  static async CommentAgent() {
    const provider = await AiModelFactory.GetProvider();
    const systemPrompt = `You are Blinko Comment Assistant. Guidelines:
      1. Use Markdown formatting
      2. Include 1-2 relevant emojis
      3. Maintain professional tone
      4. Keep responses concise (50-150 words)
      5. Match user's language
      
      Structure:
      1. Start with greeting
      2. Provide structured insights
      3. End with conclusion`;

    const agent = new Agent({
      name: 'Blinko Comment Agent',
      instructions: systemPrompt,
      model: provider?.LLM!
    });

    return new Mastra({
      agents: { agent },
      logger: createLogger({ name: 'BlinkoComment', level: 'info' })
    }).getAgent('agent');
  }

  // static async GetAudioLoader(audioPath: string) {
  //   const globalConfig = await AiModelFactory.ValidConfig()
  //   if (globalConfig.aiModelProvider == 'OpenAI') {
  //     const provider = new OpenAIModelProvider({ globalConfig })
  //     return provider.AudioLoader(audioPath)
  //   } else {
  //     throw new Error('not support other loader')
  //   }
  // }


}
