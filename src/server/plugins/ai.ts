import { _ } from '@/lib/lodash';
import "pdf-parse";
import { ChatOpenAI, ClientOptions, OpenAIEmbeddings, } from "@langchain/openai";
import path from 'path';
import fs from 'fs';
import type { Document } from "@langchain/core/documents";
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { StringOutputParser } from '@langchain/core/output_parsers';
import { OpenAIWhisperAudio } from "@langchain/community/document_loaders/fs/openai_whisper_audio";
import { prisma } from '../prisma';
import { AiModelFactory } from './ai/aiModelFactory';
import { ProgressResult } from './memos';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured";
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { BaseDocumentLoader } from '@langchain/core/document_loaders/base';
import { FileService } from './files';
import { AiPrompt } from './ai/aiPrompt';
import { Context } from '../context';
import dayjs from 'dayjs';
import { CreateNotification } from '../routers/notification';
import { NotificationType } from '@/lib/prismaZodType';
import { z } from 'zod';
import { CoreMessage, DefaultVectorDB } from '@mastra/core';
import { MDocument } from "@mastra/rag";
import { embed, embedMany } from 'ai';
import { VECTOR_PATH } from '@/lib/constant';
//https://js.langchain.com/docs/introduction/
//https://smith.langchain.com/onboarding
//https://js.langchain.com/docs/tutorials/qa_chat_history

export class AiService {
  static async loadFileContent(filePath: string): Promise<string> {
    try {
      let loader: BaseDocumentLoader;
      switch (true) {
        case filePath.endsWith('.pdf'):
          loader = new PDFLoader(filePath);
          break;
        case filePath.endsWith('.docx') || filePath.endsWith('.doc'):
          loader = new DocxLoader(filePath);
          break;
        case filePath.endsWith('.txt'):
          loader = new TextLoader(filePath);
          break;
        case filePath.endsWith('.csv'):
          console.log('load csv')
          loader = new CSVLoader(filePath);
          break;
        default:
          loader = new UnstructuredLoader(filePath);
      }
      const docs = await loader.load();
      return docs.map(doc => doc.pageContent).join('\n');
    } catch (error) {
      console.error('File loading error:', error);
      throw new Error(`can not load file: ${filePath}`);
    }
    return ''
  }

  static async embeddingDeleteAll(id: number, VectorStore: DefaultVectorDB) {
    await VectorStore.truncateIndex('blinko')
  }

  static async embeddingDeleteAllAttachments(filePath: string, VectorStore: DefaultVectorDB) {
    await VectorStore.truncateIndex('blinko')
  }

  static async embeddingUpsert({ id, content, type, createTime, updatedAt }: { id: number, content: string, type: 'update' | 'insert', createTime: Date, updatedAt?: Date }) {
    try {
      console.log('embeddingUpsertxxxx')
      const { VectorStore, Embeddings } = await AiModelFactory.GetProvider()
      const config = await AiModelFactory.globalConfig()

      if (config.excludeEmbeddingTagId) {
        const tag = await prisma.tag.findUnique({ where: { id: config.excludeEmbeddingTagId } })
        if (tag && content.includes(tag.name)) {
          console.warn('this note is not allowed to be embedded:', tag.name)
          return { ok: true, msg: 'tag is not allowed to be embedded' }
        }
      }

      console.log(content, 'contentxxx')
      const chunks = await MDocument.fromMarkdown(content).chunk();
      console.log(chunks, 'xxxxx')
      if (type == 'update') {
        AiModelFactory.queryAndDeleteVectorById(id)
      }

      const { embeddings } = await embedMany({
        values: chunks.map(chunk => chunk.text),
        model: Embeddings,
      });

      console.log(embeddings, 'embeddingsxxx')

      await VectorStore.upsert(
        'blinko',
        embeddings,
        chunks?.map(chunk => ({ text: chunk.text, id, noteId: id })),
      );

      try {
        await prisma.notes.update({
          where: { id },
          data: {
            metadata: {
              isIndexed: true
            },
            updatedAt,
          },

        })
      } catch (error) {
        console.log(error)
      }

      return { ok: true }
    } catch (error) {
      console.log(error, 'errorxxx')
      return { ok: false, error: error?.message }
    }
  }

  //api/file/123.pdf
  static async embeddingInsertAttachments({ id, updatedAt, filePath }: { id: number, updatedAt?: Date, filePath: string }) {
    try {
      const absolutePath = await FileService.getFile(filePath)
      const content = await AiService.loadFileContent(absolutePath);
      const { VectorStore, TokenTextSplitter, Embeddings } = await AiModelFactory.GetProvider()

      const doc = MDocument.fromText(content);
      const chunks = await doc.chunk();

      const { embeddings } = await embedMany({
        values: chunks.map(chunk => chunk.text),
        model: Embeddings,
      });

      await VectorStore.upsert(
        'blinko',
        embeddings,
        chunks?.map(chunk => ({ text: chunk.text, id, noteId: id })),
      );

      try {
        await prisma.notes.update({
          where: { id },
          data: {
            metadata: {
              isIndexed: true,
              isAttachmentsIndexed: true
            },
            updatedAt
          }
        })
      } catch (error) {
        console.log(error)
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error }
    }
  }



  static async embeddingDelete({ id }: { id: number }) {
    AiModelFactory.queryAndDeleteVectorById(id)
    return { ok: true }
  }


  static async *rebuildEmbeddingIndex({ force = false }: { force?: boolean }): AsyncGenerator<ProgressResult & { progress?: { current: number, total: number } }, void, unknown> {
    const { VectorStore } = await AiModelFactory.GetProvider()
    if (force) {
      await AiModelFactory.rebuildVectorIndex({
        vectorStore: VectorStore,
        isDelete: true
      })
    }
    const notes = await prisma.notes.findMany({
      include: {
        attachments: true
      },
      where: {
        isRecycle: false
      }
    });
    const total = notes.length;
    const BATCH_SIZE = 5;

    let current = 0;

    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
      const noteBatch = notes.slice(i, i + BATCH_SIZE);
      for (const note of noteBatch) {
        current++;
        try {
          //@ts-ignore
          if (note.metadata?.isIndexed && !force) {
            yield {
              type: 'skip' as const,
              content: note.content.slice(0, 30),
              progress: { current, total }
            };
            continue;
          }
          if (note?.content != '') {
            const { ok, error } = await AiService.embeddingUpsert({
              createTime: note.createdAt,
              updatedAt: note.updatedAt,
              id: note?.id,
              content: note?.content,
              type: 'update' as const
            });
            if (ok) {
              yield {
                type: 'success' as const,
                content: note?.content.slice(0, 30) ?? '',
                progress: { current, total }
              };
            } else {
              yield {
                type: 'error' as const,
                content: note?.content.slice(0, 30) ?? '',
                error,
                progress: { current, total }
              };
            }
          }
          if (note?.attachments) {
            for (const attachment of note.attachments) {
              const { ok, error } = await AiService.embeddingInsertAttachments({
                id: note.id,
                updatedAt: note.updatedAt,
                filePath: attachment?.path
              });
              if (ok) {
                yield {
                  type: 'success' as const,
                  content: decodeURIComponent(attachment?.path),
                  progress: { current, total }
                };
              } else {
                yield {
                  type: 'error' as const,
                  content: decodeURIComponent(attachment?.path),
                  error,
                  progress: { current, total }
                };
              }
            }
          }

        } catch (error) {
          yield {
            type: 'error' as const,
            content: note.content.slice(0, 30),
            error,
            progress: { current, total }
          };
        }
      }
    }
  }


  static getChatHistory({ conversations }: { conversations: { role: string, content: string }[] }) {
    const conversationMessage = conversations.map(i => {
      if (i.role == 'user') {
        return new HumanMessage(i.content)
      }
      return new AIMessage(i.content)
    })
    conversationMessage.pop()
    return conversationMessage
  }

  static async enhanceQuery({ query, ctx }: { query: string, ctx: Context }) {
    const { VectorStore, Embeddings } = await AiModelFactory.GetProvider()
    const config = await AiModelFactory.globalConfig()

    const { embedding } = await embed({
      value: query,
      model: Embeddings,
    });

    const results = await VectorStore.query('blinko', embedding, 20);

    const DISTANCE_THRESHOLD = config.embeddingScore ?? 0.3

    const filteredResultsWithScore = results
      .filter(({ score }) => score > DISTANCE_THRESHOLD)
      .sort((a, b) => a.score - b.score)
      .map(({ metadata, score }) => ({
        metadata,
        distance: score
      }));
    console.log(filteredResultsWithScore)
    const notes = await prisma.notes.findMany({
      where: {
        id: { in: filteredResultsWithScore.map(i => i.metadata?.id).filter(i => !!i) },
        accountId: Number(ctx.id)
      },
      include: {
        tags: { include: { tag: true } },
        attachments: true,
        _count: {
          select: {
            comments: true
          }
        }
      }
    })
    const sortedNotes = notes.sort((a, b) => {
      const scoreA = filteredResultsWithScore.find(r => r.metadata?.id === a.id)?.distance ?? Infinity;
      const scoreB = filteredResultsWithScore.find(r => r.metadata?.id === b.id)?.distance ?? Infinity;
      return scoreA - scoreB;
    });

    return sortedNotes;
  }

  static async completions({ question, conversations, withTools = false, ctx }: { question: string, conversations: CoreMessage[], withTools?: boolean, ctx: Context }) {
    try {
      console.log('completions')
      conversations.push({
        role: 'user',
        content: question
      })
      const notes = await AiModelFactory.queryVector(question, Number(ctx.id))
      conversations.push({
        role: 'system',
        content: `This is the note content which search from vector database: ${notes.map(i => i.content).join('\n')}`
      })
      const agent = await AiModelFactory.BaseChatAgent({ withTools })
      const result = await agent.stream(conversations)
      return { result, notes }
    } catch (error) {
      console.log(error)
      throw new Error(error)
    }
  }

  static async autoTag({ content, tags }: { content: string, tags: string[] }) {
    try {
      const agent = await AiModelFactory.TagAgent(tags)
      const result = await agent.generate("Please select and suggest appropriate tags for the above content")

      return result?.text?.trim().split(',').map(tag => tag.trim()).filter(Boolean) ?? [];
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  }

  static async autoEmoji({ content }: { content: string }) {
    try {
      const agent = await AiModelFactory.EmojiAgent()
      const result = await agent.generate("Please select and suggest appropriate emojis for the above content")
      return result?.text?.trim().split(',').map(tag => tag.trim()).filter(Boolean) ?? [];
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  }

  static async writing({
    question,
    type = 'custom',
    content
  }: {
    question: string,
    type?: 'expand' | 'polish' | 'custom',
    content?: string
  }) {
    try {
      // const { LLM } = await AiModelFactory.GetProvider({ withOutVectorStore: true });
      // const writingPrompt = AiPrompt.WritingPrompt(type, content);
      // const writingChain = writingPrompt.pipe(LLM).pipe(new StringOutputParser());
      const agent = await AiModelFactory.WritingAgent(type)
      const result = await agent.stream([
        {
          role: 'user',
          content: question
        },
        {
          role: 'system',
          content: `This is the user's note content: ${content || ''}`
        }
      ]);

      return { result };
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  }

  static async speechToText(audioPath: string) {
    // const loader = await AiModelFactory.GetAudioLoader(audioPath)
    // const docs = await loader.load();
    // return docs
    return null
  }

  static async AIComment({ content, noteId }: { content: string, noteId: number }) {
    try {
      const note = await prisma.notes.findUnique({
        where: { id: noteId },
        select: { content: true, accountId: true }
      })

      if (!note) {
        throw new Error('Note not found')
      }

      // const { LLM } = await AiModelFactory.GetProvider();
      // const commentPrompt = AiPrompt.CommentPrompt();
      // const commentChain = commentPrompt.pipe(LLM).pipe(new StringOutputParser());
      // const aiResponse = await commentChain.invoke({
      //   content,
      //   noteContent: note.content
      // });

      const agent = await AiModelFactory.CommentAgent()
      const result = await agent.generate([
        {
          role: 'user',
          content: content
        },
        {
          role: 'user',
          content: `This is the note content: ${note.content}`
        }
      ])

      const comment = await prisma.comments.create({
        data: {
          content: result.text.trim(),
          noteId,
          guestName: 'Blinko AI',
          guestIP: '',
          guestUA: ''
        },
        include: {
          account: {
            select: {
              id: true,
              name: true,
              nickname: true,
              image: true
            }
          }
        }
      });
      await CreateNotification({
        accountId: note.accountId ?? 0,
        title: 'comment-notification',
        content: 'comment-notification',
        type: NotificationType.COMMENT,
      })
      return comment;
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  }
}