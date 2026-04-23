// popup.ts - 处理popup界面的交互

interface StorageData {
  redirectUrl?: string;
  records?: RecordData[];
}

interface RecordData {
  title: string;
  url: string;
  decision: string;
  timestamp: number;
}

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const redirectUrlInput = document.getElementById('redirectUrl') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const showRecordsBtn = document.getElementById('showRecords') as HTMLButtonElement;
const clearRecordsBtn = document.getElementById('clearRecords') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const recordsContainer = document.getElementById('recordsContainer') as HTMLDivElement;
const recordsList = document.getElementById('recordsList') as HTMLDivElement;

async function loadConfig(): Promise<void> {
  const result = await browser.storage.local.get(['redirectUrl'] as (keyof StorageData)[]);
  if (result.redirectUrl) {
    redirectUrlInput.value = result.redirectUrl;
  }
}

function showStatus(message: string, isError = false): void {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + (isError ? 'error' : 'success');
  statusDiv.style.display = 'block';
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}

saveBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const redirectUrl = redirectUrlInput.value.trim();

  // 仅持久化非敏感配置，API Key 只保存在 background 内存中。
  await browser.storage.local.set({ redirectUrl });
  await browser.storage.local.remove('apiKey');

  browser.runtime.sendMessage({
    type: 'UPDATE_CONFIG',
    ...(apiKey ? { apiKey } : {}),
    redirectUrl
  });

  showStatus('配置已保存 ✓');
});

showRecordsBtn.addEventListener('click', async () => {
  if (recordsContainer.style.display === 'none') {
    const result = await browser.storage.local.get('records' as keyof StorageData);
    const records: RecordData[] = (result.records as RecordData[] | undefined) || [];

    if (records.length === 0) {
      recordsList.innerHTML = '<div style="color:#666;text-align:center;padding:12px;">暂无记录</div>';
    } else {
      recordsList.innerHTML = records.map(r => `
        <div class="record">
          <div class="record-title">${escapeHtml(r.title)}</div>
          <div class="record-reason">${escapeHtml(r.decision)} · ${formatTime(r.timestamp)}</div>
        </div>
      `).join('');
    }

    recordsContainer.style.display = 'block';
    showRecordsBtn.textContent = '收起记录';
    clearRecordsBtn.style.display = 'block';
  } else {
    recordsContainer.style.display = 'none';
    showRecordsBtn.textContent = '查看最近记录';
    clearRecordsBtn.style.display = 'none';
  }
});

clearRecordsBtn.addEventListener('click', async () => {
  await browser.storage.local.set({ records: [] });
  recordsList.innerHTML = '<div style="color:#666;text-align:center;padding:12px;">暂无记录</div>';
  showStatus('记录已清空');
});

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return d.toLocaleDateString();
}

loadConfig();