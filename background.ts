// background.ts - 处理AI分析和重定向逻辑

interface AIMessage {
  type: 'VIDEO_TITLE';
  title: string;
  url: string;
}

interface UpdateConfigMessage {
  type: 'UPDATE_CONFIG';
  apiKey: string;
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

const DEFAULT_REDIRECT_PAGE = 'https://www.bilibili.com/v/popular/history';
const API_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2';
const MODEL = 'MiniMax-Text-01';

let apiKey: string | null = null;
let redirectUrl: string = DEFAULT_REDIRECT_PAGE;

browser.runtime.onInstalled.addListener(() => {
  console.log('B站视频AI筛选器已安装');
});

browser.runtime.onMessage.addListener(async (msg: unknown, sender) => {
  const message = msg as AIMessage | UpdateConfigMessage;

  if (message.type === 'VIDEO_TITLE') {
    const shouldRedirect = await handleVideoTitle(message.title, message.url, sender.tab?.id);
    if (shouldRedirect) {
      browser.tabs.sendMessage(message.tabId as number, {
        type: 'REDIRECT',
        url: redirectUrl
      });
    }
  } else if (message.type === 'UPDATE_CONFIG') {
    apiKey = (message as UpdateConfigMessage).apiKey;
    redirectUrl = (message as UpdateConfigMessage).redirectUrl;
  }
});

async function handleVideoTitle(title: string, url: string, tabId?: number): Promise<boolean> {
  try {
    const stored = await browser.storage.local.get(['apiKey', 'redirectUrl']);
    if (stored.apiKey) apiKey = stored.apiKey;
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
          content: '' // 用户将填充
        }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
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