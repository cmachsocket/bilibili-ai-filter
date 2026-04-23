// background.ts - 处理AI分析和重定向逻辑

interface AIMessage {
  type: 'VIDEO_TITLE';
  title: string;
  url: string;
}

interface UpdateConfigMessage {
  type: 'UPDATE_CONFIG';
  apiKey?: string;
  redirectUrl: string;
}

interface RecordData {
  title: string;
  url: string;
  decision: string;
  timestamp: number;
}

interface AIResponse {
  should_redirect: boolean;
  reason: string;
  redirect_url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractApiErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return '';
  }

  const message = payload.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  const error = payload.error;
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  const baseResp = payload.base_resp;
  if (isRecord(baseResp)) {
    const statusMsg = baseResp.status_msg;
    if (typeof statusMsg === 'string' && statusMsg.trim()) {
      return statusMsg;
    }
  }

  return '';
}

type EnvGlobal = typeof globalThis & {
  BUILD_MINIMAX_API_KEY?: string;
  importScripts?: (...urls: string[]) => void;
};

const envGlobal = globalThis as EnvGlobal;

// 在 service worker 场景下尝试加载构建注入脚本。
if (typeof envGlobal.importScripts === 'function') {
  try {
    envGlobal.importScripts('build-env.js');
  } catch {
    // 忽略加载失败，继续走手动输入 API Key 的回退路径。
  }
}

function extractFirstJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth++;
      continue;
    }

    if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

function isVideoSubRoute(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.startsWith('/video');
  } catch {
    return false;
  }
}

const DEFAULT_REDIRECT_PAGE = 'https://www.runoob.com/pytorch/pytorch-basic.html';
const API_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2';
const MODEL = 'MiniMax-M2.7';

let apiKey: string | null = (envGlobal.BUILD_MINIMAX_API_KEY || '').trim() || null;
let redirectUrl: string = DEFAULT_REDIRECT_PAGE;

browser.runtime.onInstalled.addListener(() => {
  console.log('B站视频AI筛选器已安装');
});

browser.runtime.onMessage.addListener(async (msg: unknown, sender) => {
  const message = msg as AIMessage | UpdateConfigMessage;

  if (message.type === 'VIDEO_TITLE') {
    if (!isVideoSubRoute(message.url)) {
      return;
    }

    const shouldRedirect = await handleVideoTitle(message.title, message.url, sender.tab?.id);
    if (shouldRedirect) {
      if (sender.tab?.id != null) {
        try {
          await browser.tabs.sendMessage(sender.tab.id, {
            type: 'REDIRECT',
            url: redirectUrl
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (!msg.includes('Receiving end does not exist')) {
            console.warn('发送重定向消息失败:', error);
          }
        }
      }
    }
  } else if (message.type === 'UPDATE_CONFIG') {
    const runtimeKey = (message as UpdateConfigMessage).apiKey?.trim();
    if (runtimeKey) {
      apiKey = runtimeKey;
    }
    redirectUrl = (message as UpdateConfigMessage).redirectUrl;
  }
});

async function handleVideoTitle(title: string, url: string, tabId?: number): Promise<boolean> {
  try {
    const stored = await browser.storage.local.get(['redirectUrl']);
    if (stored.redirectUrl) redirectUrl = stored.redirectUrl;

    const decision = await analyzeWithAI(title);

    if (decision.should_redirect) {
      console.log(`[AI决策] "${title}" → 重定向到 ${decision.redirect_url || redirectUrl}`);
      console.log(`[AI理由] ${decision.reason}`);
      saveRecord(title, url, decision);
      return true;
    }
    return false;
  } catch (err) {
    console.error('处理失败:', err);
    return false;
  }
}

async function analyzeWithAI(title: string): Promise<AIResponse> {
  if (!apiKey) {
    return { should_redirect: false, reason: '未配置API Key' };
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: `你是一个学习内容过滤助手。
请判断这个B站视频标题是否与学习目标无关。

视频标题：${title}

判定规则：
1. 与编程、数学、英语、考研、课程、技术实践相关 -> should_redirect = false。
2. 与纯娱乐、八卦、游戏整活、无明确学习价值内容相关 -> should_redirect = true。
3. 标题语义不明确时，优先保守阻止 -> should_redirect = true

请只返回一个JSON对象，不要输出其他文字，格式如下：
{
  "should_redirect": boolean,
  "reason": string,
  "redirect_url": string
}

要求：
- reason 简短中文说明（不超过30字）。
- redirect_url 可为空字符串。`
        }
      ],
      temperature: 0.3
    })
  });

  const rawText = await response.text();
  let data: unknown;

  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`API返回非JSON: ${rawText.slice(0, 200)}`);
  }

  if (!response.ok) {
    const detail = extractApiErrorMessage(data) || `HTTP ${response.status}`;
    throw new Error(`API请求失败: ${detail}`);
  }

  if (!isRecord(data)) {
    throw new Error('API响应结构异常: 顶层不是对象');
  }

  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    const detail = extractApiErrorMessage(data) || 'choices 为空';
    throw new Error(`API响应结构异常: ${detail}`);
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    throw new Error('API响应结构异常: choices[0] 非对象');
  }

  const message = firstChoice.message;
  if (!isRecord(message) || typeof message.content !== 'string') {
    throw new Error('API响应结构异常: 缺少 message.content');
  }

  const content = message.content;

  try {
    const jsonText = extractFirstJsonObject(content);
    if (jsonText) {
      return JSON.parse(jsonText);
    }
    return JSON.parse(content);
  } catch {
    return { should_redirect: false, reason: '解析失败，默认保留' };
  }
}

async function saveRecord(title: string, url: string, decision: AIResponse): Promise<void> {
  const result = await browser.storage.local.get('records');
  const records: RecordData[] = result.records || [];

  records.unshift({
    title,
    url,
    decision: decision.reason,
    timestamp: Date.now()
  });

  if (records.length > 100) {
    records.pop();
  }

  await browser.storage.local.set({ records });
}