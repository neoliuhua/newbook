import { router, authProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '../prisma';

export const conversationRouter = router({
  create: authProcedure
    .meta({ 
      openapi: { 
        method: 'POST', 
        path: '/v1/conversation/create', 
        summary: 'Create a new conversation', 
        protect: true, 
        tags: ['Conversation'] 
      } 
    })
    .input(z.object({
      title: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return await prisma.conversation.create({
        data: {
          title: input.title,
          accountId: Number(ctx.id),
        }
      });
    }),

  list: authProcedure
    .input(z.object({
      page: z.number().default(1),
      size: z.number().default(20),
    }))
    .query(async ({ input, ctx }) => {
      const skip = (input.page - 1) * input.size;
      const [total, conversations] = await Promise.all([
        prisma.conversation.count({
          where: { accountId: Number(ctx.id) }
        }),
        prisma.conversation.findMany({
          where: { accountId: Number(ctx.id) },
          skip,
          take: input.size,
          orderBy: { createdAt: 'desc' }
        })
      ]);
      return { total, items: conversations };
    }),

  update: authProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      model: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return await prisma.conversation.update({
        where: { 
          id: input.id,
          accountId: Number(ctx.id)
        },
        data: {
          title: input.title,
        }
      });
    }),

  delete: authProcedure
    .meta({ 
      openapi: { 
        method: 'POST', 
        path: '/v1/conversation/delete', 
        summary: 'Delete a conversation', 
        protect: true, 
        tags: ['Conversation'] 
      } 
    })
    .input(z.object({
      id: z.number()
    }))
    .mutation(async ({ input, ctx }) => {
      return await prisma.conversation.delete({
        where: { 
          id: input.id,
          accountId: Number(ctx.id)
        }
      });
    }),
}); 