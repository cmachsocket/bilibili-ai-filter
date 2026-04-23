// content.ts - 读取视频标题并发送给background处理

interface VideoMessage {
  type: 'VIDEO_TITLE';
  title: string;
  url: string;
}

interface RedirectMessage {
  type: 'REDIRECT';
  url: string;
}

function getVideoTitle(): string | null {
  const selectors = [
    'h1.video-title',
    'h1.title',
    '.video-title',
    '.bilibili-player-video-title',
    '#viewbox_report > div > div > span',
    'meta[property="og:title"]',
    'title'
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const title = (el as HTMLMetaElement).content || el.textContent;
      if (title && title.trim()) {
        return title.trim();
      }
    }
  }

  const pageTitle = document.title;
  const match = pageTitle.match(/^(.+?)\s*_\s*Bilibili/);
  if (match) {
    return match[1].trim();
  }

  return null;
}

function sendTitleToBackground(title: string): void {
  const msg: VideoMessage = {
    type: 'VIDEO_TITLE',
    title,
    url: window.location.href
  };
  browser.runtime.sendMessage(msg);
}

browser.runtime.onMessage.addListener((msg: unknown, _sender, _sendResponse) => {
  const message = msg as RedirectMessage;
  if (message.type === 'REDIRECT') {
    window.location.href = message.url;
    return true;
  }
  return true;
});

if (document.readyState === 'complete') {
  const title = getVideoTitle();
  if (title) {
    sendTitleToBackground(title);
  }
} else {
  window.addEventListener('load', () => {
    setTimeout(() => {
      const title = getVideoTitle();
      if (title) {
        sendTitleToBackground(title);
      }
    }, 1000);
  });
}