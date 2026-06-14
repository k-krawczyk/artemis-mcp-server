import { z } from 'zod';

export const queueName = z.string().min(1).describe('Queue name');
export const addressName = z.string().min(1).describe('Address name');

export const routingType = z
  .enum(['anycast', 'multicast'])
  .describe('Routing type used when the queue is created');

export const confirmFlag = z
  .boolean()
  .default(false)
  .describe('Must be set to true to execute this destructive operation');

export const selector = z
  .string()
  .min(1)
  .describe('Artemis message filter (JMS selector syntax), e.g. "priority > 4"');

export const receivedMessage = z.object({
  messageId: z.string().optional(),
  subject: z.string().optional(),
  durable: z.boolean().optional(),
  bodyEncoding: z.enum(['text', 'base64']),
  body: z.string(),
  properties: z.record(z.string(), z.unknown()),
});
