import { z } from 'zod';

const jsonValue = z.unknown().refine((v) => {
  try { return JSON.stringify(v).length < 200000; } catch { return false; }
}, '内容过大或无法序列化');

export const settingsSchema = z.object({
  genre: z.string().max(100).optional(), visualStyle: z.string().max(100).optional(),
  aspectRatio: z.string().max(30).optional(), difficulty: z.string().max(50).optional(),
  sound: z.boolean().optional(), language: z.string().max(30).optional(),
}).catchall(z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]));

const referenceId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const mentionSchema = z.object({
  nodeId: referenceId, label: z.string().min(1).max(200),
  start: z.number().int().min(0), end: z.number().int().min(1),
}).strict();

// Keep unknown legacy fields, while validating fields that drive real model context.
const nodeDataSchema = z.object({
  content: z.string().max(30000).optional(),
  description: z.string().max(15000).optional(),
  assetId: referenceId.optional(), assetIds: z.array(referenceId).max(20).optional(),
  referenceNodeIds: z.array(referenceId).max(100).optional(),
  mentions: z.array(mentionSchema).max(100).optional(),
  specifications: z.record(z.string().max(100), z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()])).optional(),
}).catchall(jsonValue);

export const nodeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), type: z.string().max(50),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: nodeDataSchema,
}).passthrough();

export const edgeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), source: z.string().max(100), target: z.string().max(100),
}).passthrough();

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(150).default('未命名游戏'),
  description: z.string().max(4000).default(''), templateId: z.string().max(100).optional(),
  nodes: z.array(nodeSchema).max(300).optional(), settings: settingsSchema.optional(),
}).strict();

export const projectPatchSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(), description: z.string().max(4000).optional(),
  nodes: z.array(nodeSchema).max(300).optional(), edges: z.array(edgeSchema).max(800).optional(),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(.05).max(10) }).optional(),
  settings: settingsSchema.optional(), messages: z.array(z.object({
    id: z.string().max(100), role: z.enum(['user', 'assistant', 'system']), content: z.string().max(30000), createdAt: z.string().max(100), jobId: z.string().max(100).optional(),
  }).passthrough()).max(1000).optional(),
}).strict();

export const jobSchema = z.object({
  // Do not trim: mention offsets describe exactly the text submitted by the editor.
  prompt: z.string().min(3, '请至少输入 3 个字符的游戏创意').max(30000).refine((value) => value.trim().length >= 3, '请至少输入 3 个字符的游戏创意'),
  mode: z.enum(['generate', 'iterate']).default('generate'), nodeId: z.string().max(100).optional(),
  sourceVersionId: z.string().max(100).optional(), settings: settingsSchema.optional(),
  referenceAssetIds: z.array(z.string().max(100)).max(20).optional(),
  referenceNodeIds: z.array(z.string().max(100)).max(100).optional(),
  mentions: z.array(mentionSchema).max(100).optional(),
}).strict();

export const versionSchema = z.object({
  html: z.string().min(100).max(3000000), title: z.string().max(200).optional(),
  summary: z.string().max(6000).optional(), controls: z.string().max(4000).optional(), prompt: z.string().max(30000).optional(),
}).strict();

export function validateHtml(html) {
  if (typeof html !== 'string' || html.length < 100 || html.length > 3000000) throw new Error('返回的游戏代码为空或超出大小限制。');
  if (!/<html[\s>]/i.test(html) || !/<script[\s>]/i.test(html) || !/<\/html\s*>/i.test(html)) throw new Error('需要包含 HTML 文档和 JavaScript 的完整可玩游戏。');
  if (/<script[^>]+src\s*=/i.test(html) || /<link[^>]+href\s*=[^>]*https?:/i.test(html)) throw new Error('游戏必须独立运行，不能依赖外部脚本或样式库。');
  return html;
}

export function parseSchema(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues.map((issue) => `${issue.path.join('.') || '请求'}: ${issue.message}`).join('；'));
    error.status = 400; error.code = 'INVALID_INPUT'; throw error;
  }
  return result.data;
}
