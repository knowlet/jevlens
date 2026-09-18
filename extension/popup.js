const enabled = document.getElementById("enabled");
const status = document.getElementById("status");

chrome.storage.sync.get({ enabled: true }, s => { enabled.checked = s.enabled; });
enabled.addEventListener("change", () => chrome.storage.sync.set({ enabled: enabled.checked }));

document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();

document.getElementById("clear").onclick = () => {
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, r => {
    status.textContent = r?.ok ? `已清除 ${r.removed} 筆快取` : "清除失敗";
  });
};

document.getElementById("analyze").onclick = async () => {
  status.textContent = "分析中…";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    status.textContent = "找不到目前分頁";
    return;
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["article_inject.js"] });
    status.textContent = "已在頁面右上角顯示結果";
  } catch (e) {
    status.textContent = `無法分析此頁：${e.message}`;
  }
};
