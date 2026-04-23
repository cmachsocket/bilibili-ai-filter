"use strict";
// content.ts - 读取视频标题并发送给background处理
function getVideoTitle() {
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
            const title = el.content || el.textContent;
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
function sendTitleToBackground(title) {
    const msg = {
        type: 'VIDEO_TITLE',
        title,
        url: window.location.href
    };
    browser.runtime.sendMessage(msg);
}
browser.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    const message = msg;
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
}
else {
    window.addEventListener('load', () => {
        setTimeout(() => {
            const title = getVideoTitle();
            if (title) {
                sendTitleToBackground(title);
            }
        }, 1000);
    });
}
