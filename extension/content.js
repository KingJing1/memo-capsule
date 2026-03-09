// ==UserScript==
// @name         Memo Capsule
// @namespace    https://openai.com/codex
// @version      0.1.0
// @description  One-click export for the current ChatGPT, Claude, or Gemini conversation.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'tm-chat-export-panel';
  const STYLE_ID = 'tm-chat-export-style';
  const TOAST_ID = 'tm-chat-export-toast';
  const ARCHIVE_KEY = 'tmChatExportArchive';
  const PANEL_STATE_KEY = 'tmChatExportPanelState';
  const MAX_ARCHIVE_ITEMS = 40;
  const ROOT_SELECTOR = 'main, [role="main"]';
  const NOISE_SELECTOR = [
    'button',
    'svg',
    'path',
    'style',
    'script',
    'noscript',
    'textarea',
    'input',
    'select',
    'nav',
    'aside',
    'footer',
    '[role="button"]',
    '[aria-hidden="true"]',
    '[data-testid*="copy"]',
    '[data-testid*="feedback"]',
    '[class*="toolbar"]',
    '[class*="actions"]',
    '[class*="popover"]',
    '[class*="menu"]',
    '[class*="sr-only"]',
    '[class*="visually-hidden"]',
  ].join(', ');

  const ROLE_LABELS = {
    user: 'User',
    assistant: 'Assistant',
    system: 'System',
    tool: 'Tool',
    conversation: 'Conversation',
  };

  const runtimeState = {
    selectedArchiveId: null,
    currentHref: window.location.href,
    suppressAnchorClickUntil: 0,
  };

  async function exportConversation(format, item) {
    const bundle = item && item.bundle ? item.bundle : collectConversation();
    const content = format === 'txt' ? buildText(bundle) : buildMarkdown(bundle);

    if (!content.trim()) {
      throw new Error('未提取到内容，请先滚动加载完整对话后重试。');
    }

    const extension = format === 'txt' ? 'txt' : 'md';
    const filename = buildFilename(bundle.title, extension);
    downloadFile(filename, content);
    showToast(`已导出 ${filename}`);
    return { ok: true, filename };
  }

  function ensurePanelStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 112px;
        right: 18px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif;
        color: #1d1d1f;
      }

      #${PANEL_ID}[data-collapsed="true"] .tm-card,
      #${PANEL_ID}[data-collapsed="true"] .tm-drawer {
        display: none;
      }

      #${PANEL_ID}[data-collapsed="false"] .tm-anchor {
        display: none;
      }

      #${PANEL_ID}[data-drawer-open="false"] .tm-drawer {
        display: none;
      }

      #${PANEL_ID}[data-drawer-open="true"] .tm-drawer {
        display: flex;
      }

      #${PANEL_ID} .tm-anchor {
        border: 1px solid rgba(29, 29, 31, 0.08);
        border-radius: 20px;
        padding: 12px 14px;
        min-width: 132px;
        max-width: 220px;
        background: rgba(255, 255, 255, 0.92);
        color: #1d1d1f;
        cursor: pointer;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.08);
        font-size: 12px;
        font-weight: 600;
        line-height: 1.45;
        text-align: left;
        letter-spacing: -0.01em;
        backdrop-filter: blur(18px);
        white-space: pre-wrap;
        word-break: break-word;
      }

      #${PANEL_ID} .tm-card {
        width: 320px;
        padding: 18px;
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 28px 72px rgba(0, 0, 0, 0.12);
        backdrop-filter: blur(18px);
        border: 1px solid rgba(29, 29, 31, 0.08);
      }

      #${PANEL_ID} .tm-card-head,
      #${PANEL_ID} .tm-drawer-head,
      #${PANEL_ID} .tm-detail-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      #${PANEL_ID} .tm-drag {
        border: 0;
        background: transparent;
        color: #86868b;
        cursor: grab;
        font-size: 15px;
        padding: 4px 4px 4px 0;
      }

      #${PANEL_ID} .tm-title {
        flex: 1;
        min-width: 0;
      }

      #${PANEL_ID} .tm-title strong,
      #${PANEL_ID} .tm-drawer-head strong {
        display: block;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: #1d1d1f;
      }

      #${PANEL_ID} .tm-title span,
      #${PANEL_ID} .tm-drawer-head span,
      #${PANEL_ID} .tm-detail-meta,
      #${PANEL_ID} .tm-empty,
      #${PANEL_ID} .tm-item-meta {
        font-size: 12px;
        line-height: 1.5;
        color: #6e6e73;
      }

      #${PANEL_ID} .tm-card-actions,
      #${PANEL_ID} .tm-detail-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
        flex-wrap: wrap;
      }

      #${PANEL_ID} button.tm-primary,
      #${PANEL_ID} button.tm-secondary,
      #${PANEL_ID} button.tm-ghost,
      #${PANEL_ID} .tm-item {
        border: 0;
        cursor: pointer;
      }

      #${PANEL_ID} button.tm-primary,
      #${PANEL_ID} button.tm-secondary,
      #${PANEL_ID} button.tm-ghost {
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
      }

      #${PANEL_ID} button.tm-primary {
        background: #0071e3;
        color: #ffffff;
      }

      #${PANEL_ID} button.tm-secondary {
        background: #f5f5f7;
        color: #1d1d1f;
        border: 1px solid rgba(29, 29, 31, 0.08);
      }

      #${PANEL_ID} button.tm-ghost {
        background: transparent;
        color: #6e6e73;
        padding-inline: 8px;
      }

      #${PANEL_ID} .tm-note {
        margin-top: 18px;
        padding-top: 16px;
        border-top: 1px solid rgba(29, 29, 31, 0.08);
      }

      #${PANEL_ID} .tm-note label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 600;
        color: #6e6e73;
      }

      #${PANEL_ID} .tm-note textarea {
        width: 100%;
        min-height: 72px;
        resize: vertical;
        border: 1px solid rgba(29, 29, 31, 0.1);
        border-radius: 16px;
        background: #fbfbfd;
        color: #1d1d1f;
        padding: 12px 14px;
        font: inherit;
        font-size: 13px;
        line-height: 1.55;
        box-sizing: border-box;
      }

      #${PANEL_ID} .tm-note-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 10px;
      }

      #${PANEL_ID} .tm-note-help {
        font-size: 12px;
        line-height: 1.5;
        color: #86868b;
      }

      #${PANEL_ID} .tm-credit {
        margin-top: 16px;
      }

      #${PANEL_ID} .tm-credit a {
        color: #1d1d1f;
        font-size: 12px;
        font-weight: 600;
        text-decoration: none;
        border-bottom: 1px solid rgba(29, 29, 31, 0.18);
        padding-bottom: 1px;
      }

      #${PANEL_ID} .tm-drawer {
        position: fixed;
        top: 24px;
        right: 24px;
        width: min(920px, calc(100vw - 40px));
        height: min(84vh, 900px);
        border-radius: 32px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(29, 29, 31, 0.08);
        box-shadow: 0 32px 90px rgba(0, 0, 0, 0.14);
        backdrop-filter: blur(18px);
      }

      #${PANEL_ID} .tm-drawer-shell {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        width: 100%;
        height: 100%;
      }

      #${PANEL_ID} .tm-list {
        padding: 20px;
        border-right: 1px solid rgba(29, 29, 31, 0.08);
        overflow: auto;
        background: #fbfbfd;
      }

      #${PANEL_ID} .tm-list-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 18px;
      }

      #${PANEL_ID} .tm-item {
        text-align: left;
        padding: 14px;
        border-radius: 20px;
        background: #ffffff;
        transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        border: 1px solid rgba(29, 29, 31, 0.06);
      }

      #${PANEL_ID} .tm-item:hover {
        transform: translateY(-1px);
        background: #ffffff;
        border-color: rgba(0, 113, 227, 0.18);
      }

      #${PANEL_ID} .tm-item.is-active {
        background: #ffffff;
        border-color: rgba(0, 113, 227, 0.38);
        box-shadow: 0 8px 24px rgba(0, 113, 227, 0.08);
      }

      #${PANEL_ID} .tm-item-title {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.45;
        color: #1d1d1f;
      }

      #${PANEL_ID} .tm-item-meta {
        margin-top: 6px;
      }

      #${PANEL_ID} .tm-item-excerpt {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.55;
        color: #424245;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      #${PANEL_ID} .tm-detail {
        padding: 20px;
        overflow: auto;
        background: #ffffff;
      }

      #${PANEL_ID} .tm-detail-card {
        min-height: 100%;
        border-radius: 24px;
        background: #ffffff;
        border: 1px solid rgba(29, 29, 31, 0.08);
        padding: 24px;
      }

      #${PANEL_ID} .tm-feed {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin-top: 22px;
      }

      #${PANEL_ID} .tm-message {
        padding: 16px 18px;
        border-radius: 20px;
        background: #fbfbfd;
        border: 1px solid rgba(29, 29, 31, 0.06);
      }

      #${PANEL_ID} .tm-message[data-role="user"] {
        background: #f5f9ff;
        border-color: rgba(0, 113, 227, 0.12);
      }

      #${PANEL_ID} .tm-message[data-role="assistant"] {
        background: #fbfbfd;
      }

      #${PANEL_ID} .tm-message-head {
        margin-bottom: 8px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6e6e73;
      }

      #${PANEL_ID} .tm-message-body {
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 14px;
        line-height: 1.72;
        color: #1d1d1f;
      }

      #${PANEL_ID} .tm-message-body code {
        font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        background: #f2f2f2;
        padding: 1px 4px;
        border-radius: 6px;
      }

      @media (max-width: 920px) {
        #${PANEL_ID} .tm-drawer-shell {
          grid-template-columns: 1fr;
        }

        #${PANEL_ID} .tm-list {
          max-height: 38vh;
          border-right: 0;
          border-bottom: 1px solid rgba(29, 29, 31, 0.08);
        }
      }
    `;

    document.documentElement.appendChild(style);
  }

  function createPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) {
      return panel;
    }

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.dataset.collapsed = 'true';
    panel.dataset.drawerOpen = 'false';
    panel.innerHTML = `
      <button type="button" class="tm-anchor" data-action="toggle-panel" data-drag-handle="true" title="打开会话归档">Memo</button>
      <section class="tm-card" aria-label="会话归档控制台">
        <div class="tm-card-head">
          <button type="button" class="tm-drag" data-drag-handle="true" title="拖动位置">⋮⋮</button>
          <div class="tm-title">
            <strong>Session Archive</strong>
            <span>像备忘录一样收纳每一段上下文</span>
          </div>
          <button type="button" class="tm-ghost" data-action="collapse" title="收起">收起</button>
        </div>
        <div class="tm-card-actions">
          <button type="button" class="tm-primary" data-action="save-current">保存当前</button>
          <button type="button" class="tm-secondary" data-action="toggle-drawer">打开归档</button>
        </div>
        <div class="tm-note">
          <label for="${PANEL_ID}-note">缩起时显示的便签</label>
          <textarea id="${PANEL_ID}-note" data-role="anchor-note-input" placeholder="写一句提醒，或一条鼓励自己的话。"></textarea>
          <div class="tm-note-actions">
            <div class="tm-note-help">这段文字会直接显示在缩起入口上，也可以当一句随手备忘。</div>
            <button type="button" class="tm-secondary" data-action="save-note">更新便签</button>
          </div>
        </div>
        <div class="tm-credit">
          <a href="https://twitter.com/KingJing001" target="_blank" rel="noopener noreferrer">@一龙小包子</a>
        </div>
      </section>
      <aside class="tm-drawer" aria-label="会话归档">
        <div class="tm-drawer-shell">
          <section class="tm-list">
            <div class="tm-drawer-head">
              <div>
                <strong>本地归档</strong>
                <span class="tm-count">0 条</span>
              </div>
              <button type="button" class="tm-ghost" data-action="close-drawer" title="关闭">关闭</button>
            </div>
            <div class="tm-list-body" data-archive-list="true"></div>
          </section>
          <section class="tm-detail">
            <div class="tm-detail-card" data-archive-detail="true">
              <div class="tm-empty">还没有保存的会话。先在聊天页点一次“保存当前”。</div>
            </div>
          </section>
        </div>
      </aside>
    `;

    panel.addEventListener('click', (event) => {
      handlePanelAction(event, panel);
    });

    panel.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || target.getAttribute('data-role') !== 'anchor-note-input') {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        const button = panel.querySelector('[data-action="save-note"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
        }
      }
    });

    attachDrag(panel);
    document.body.appendChild(panel);
    return panel;
  }

  async function hydratePanel(panel) {
    const state = await getPanelState();
    applyPanelState(panel, state);
    await refreshArchive(panel);
  }

  async function handlePanelAction(event, panel) {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.getAttribute('data-action');

    if (action === 'toggle-panel') {
      if (Date.now() < runtimeState.suppressAnchorClickUntil) {
        return;
      }

      const state = await setPanelState({ collapsed: false });
      applyPanelState(panel, state);
      return;
    }

    if (action === 'collapse') {
      const state = await setPanelState({ collapsed: true, drawerOpen: false });
      applyPanelState(panel, state);
      return;
    }

    if (action === 'toggle-drawer') {
      const nextOpen = panel.dataset.drawerOpen !== 'true';
      const state = await setPanelState({ collapsed: false, drawerOpen: nextOpen });
      applyPanelState(panel, state);
      if (nextOpen) {
        await refreshArchive(panel);
      }
      return;
    }

    if (action === 'close-drawer') {
      const state = await setPanelState({ drawerOpen: false });
      applyPanelState(panel, state);
      return;
    }

    if (action === 'save-current') {
      await runButtonAction(actionTarget, async () => {
        const item = await saveCurrentConversation();
        runtimeState.selectedArchiveId = item.id;
        await refreshArchive(panel, item.id);
        const state = await setPanelState({ collapsed: false, drawerOpen: true });
        applyPanelState(panel, state);
      });
      return;
    }

    if (action === 'save-note') {
      const input = panel.querySelector('[data-role="anchor-note-input"]');
      const nextText = normalizeText(input && 'value' in input ? input.value : '') || 'Memo';
      const state = await setPanelState({ anchorText: nextText });
      applyPanelState(panel, state);
      showToast('已更新缩起便签。');
      return;
    }

    if (action === 'archive-select') {
      runtimeState.selectedArchiveId = actionTarget.getAttribute('data-id') || null;
      await refreshArchive(panel, runtimeState.selectedArchiveId);
      return;
    }

    if (action === 'archive-export-md' || action === 'archive-export-txt') {
      const itemId = actionTarget.getAttribute('data-id');
      const items = await getArchiveItems();
      const item = items.find((entry) => entry.id === itemId);
      if (!item) {
        showToast('归档内容不存在，可能已经被删除。', true);
        await refreshArchive(panel);
        return;
      }

      await runButtonAction(actionTarget, async () => {
        await exportConversation(action === 'archive-export-txt' ? 'txt' : 'md', item);
      });
      return;
    }

    if (action === 'archive-delete') {
      const itemId = actionTarget.getAttribute('data-id');
      if (!itemId) {
        return;
      }

      if (!window.confirm('删除这条本地归档？此操作不会影响原聊天页面。')) {
        return;
      }

      const items = await getArchiveItems();
      const nextItems = items.filter((item) => item.id !== itemId);
      await setArchiveItems(nextItems);
      if (runtimeState.selectedArchiveId === itemId) {
        runtimeState.selectedArchiveId = nextItems[0] ? nextItems[0].id : null;
      }
      await refreshArchive(panel, runtimeState.selectedArchiveId);
      showToast('已删除本地归档。');
    }
  }

  async function runButtonAction(button, action) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '处理中...';

    try {
      await action();
    } catch (error) {
      showToast(error && error.message ? error.message : '操作失败，请稍后重试。', true);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function saveCurrentConversation() {
    const bundle = collectConversation();
    const items = await getArchiveItems();
    const item = buildArchiveItem(bundle);
    const nextItems = [item, ...items.filter((entry) => entry.id !== item.id)].slice(0, MAX_ARCHIVE_ITEMS);
    await setArchiveItems(nextItems);
    showToast(`已保存到归档：${item.title}`);
    return item;
  }

  async function refreshArchive(panel, preferredId) {
    const items = await getArchiveItems();
    const list = panel.querySelector('[data-archive-list="true"]');
    const detail = panel.querySelector('[data-archive-detail="true"]');
    const count = panel.querySelector('.tm-count');

    if (count) {
      count.textContent = `${items.length} 条`;
    }

    const selectedId =
      preferredId ||
      runtimeState.selectedArchiveId ||
      (items[0] ? items[0].id : null);

    runtimeState.selectedArchiveId = selectedId;

    if (list) {
      if (!items.length) {
        list.innerHTML = '<div class="tm-empty">还没有本地归档。</div>';
      } else {
        list.innerHTML = items
          .map((item) => {
            const activeClass = item.id === selectedId ? ' is-active' : '';
            return `
              <button type="button" class="tm-item${activeClass}" data-action="archive-select" data-id="${escapeHtml(item.id)}">
                <div class="tm-item-title">${escapeHtml(item.title)}</div>
                <div class="tm-item-meta">${escapeHtml(item.site)} · ${escapeHtml(formatTimestamp(item.savedAt))}</div>
                <div class="tm-item-excerpt">${escapeHtml(item.excerpt || '')}</div>
              </button>
            `;
          })
          .join('');
      }
    }

    const selectedItem = items.find((item) => item.id === selectedId) || null;
    if (detail) {
      detail.innerHTML = selectedItem ? buildArchiveDetail(selectedItem) : '<div class="tm-empty">选一条归档，在这里看完整上下文。</div>';
    }
  }

  function buildArchiveDetail(item) {
    const messages = Array.isArray(item.bundle && item.bundle.messages) ? item.bundle.messages : [];
    const feed = messages.length
      ? messages
          .map((message) => {
            const label = ROLE_LABELS[message.role] || 'Assistant';
            return `
              <article class="tm-message" data-role="${escapeHtml(message.role || 'assistant')}">
                <div class="tm-message-head">${escapeHtml(label)}</div>
                <div class="tm-message-body">${escapeHtml(message.text || message.markdown || '')}</div>
              </article>
            `;
          })
          .join('')
      : '<div class="tm-empty">这条归档没有提取到正文。</div>';

    return `
      <div class="tm-detail-head">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <div class="tm-detail-meta">${escapeHtml(item.site)} · 保存于 ${escapeHtml(formatTimestamp(item.savedAt))}</div>
          <div class="tm-detail-meta">${escapeHtml(item.bundle && item.bundle.source ? item.bundle.source : '')}</div>
        </div>
      </div>
      <div class="tm-detail-actions">
        <button type="button" class="tm-primary" data-action="archive-export-md" data-id="${escapeHtml(item.id)}">导出 MD</button>
        <button type="button" class="tm-secondary" data-action="archive-export-txt" data-id="${escapeHtml(item.id)}">导出 TXT</button>
        <button type="button" class="tm-ghost" data-action="archive-delete" data-id="${escapeHtml(item.id)}">删除</button>
      </div>
      <div class="tm-feed">${feed}</div>
    `;
  }

  function buildArchiveItem(bundle) {
    const id = buildArchiveId(bundle);
    const summarySource = bundle.messages
      .map((message) => message.text || message.markdown || '')
      .find((text) => normalizeText(text).length > 0) || '';

    return {
      id,
      title: bundle.title || 'chat-session',
      site: bundle.site || getSiteName(),
      source: bundle.source || window.location.href,
      savedAt: new Date().toISOString(),
      excerpt: buildArchiveExcerpt(summarySource),
      bundle,
    };
  }

  function buildArchiveId(bundle) {
    try {
      const url = new URL(bundle.source || window.location.href);
      return `${bundle.site || getSiteName()}::${url.origin}${url.pathname}`;
    } catch (error) {
      return `${bundle.site || getSiteName()}::${String(bundle.source || window.location.href)}`;
    }
  }

  function buildArchiveExcerpt(value) {
    const text = normalizeText(value).replace(/\s+/g, ' ');
    return text.slice(0, 160);
  }

  async function getArchiveItems() {
    const items = await readPersistedValue(ARCHIVE_KEY, []);
    return Array.isArray(items) ? items : [];
  }

  async function setArchiveItems(items) {
    await writePersistedValue(ARCHIVE_KEY, items);
  }

  async function getPanelState() {
    const value = await readPersistedValue(PANEL_STATE_KEY, {});
    return {
      collapsed: true,
      drawerOpen: false,
      top: 112,
      right: 18,
      anchorText: 'Memo',
      ...value,
    };
  }

  async function setPanelState(patch) {
    const nextState = {
      ...(await getPanelState()),
      ...patch,
    };
    await writePersistedValue(PANEL_STATE_KEY, nextState);
    return nextState;
  }

  function applyPanelState(panel, state) {
    panel.dataset.collapsed = state.collapsed ? 'true' : 'false';
    panel.dataset.drawerOpen = state.drawerOpen ? 'true' : 'false';
    panel.style.top = `${Math.max(12, Number(state.top) || 112)}px`;
    panel.style.right = `${Math.max(12, Number(state.right) || 18)}px`;

    const anchor = panel.querySelector('.tm-anchor');
    if (anchor) {
      anchor.textContent = state.anchorText || 'Memo';
      anchor.title = state.anchorText || 'Memo';
    }

    const input = panel.querySelector('[data-role="anchor-note-input"]');
    if (input && 'value' in input && input.value !== (state.anchorText || 'Memo')) {
      input.value = state.anchorText || 'Memo';
    }
  }

  function attachDrag(panel) {
    let dragState = null;

    panel.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-drag-handle="true"]');
      if (!handle) {
        return;
      }

      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        top: rect.top,
        right: window.innerWidth - rect.right,
        moved: false,
      };

      handle.setPointerCapture(event.pointerId);
    });

    panel.addEventListener('pointermove', (event) => {
      if (!dragState) {
        return;
      }

      const nextTop = Math.max(12, dragState.top + (event.clientY - dragState.startY));
      const nextRight = Math.max(12, dragState.right - (event.clientX - dragState.startX));
      if (Math.abs(event.clientX - dragState.startX) > 4 || Math.abs(event.clientY - dragState.startY) > 4) {
        dragState.moved = true;
      }
      panel.style.top = `${nextTop}px`;
      panel.style.right = `${nextRight}px`;
    });

    const finishDrag = async () => {
      if (!dragState) {
        return;
      }

      const moved = dragState.moved;
      await setPanelState({
        top: parseFloat(panel.style.top) || 112,
        right: parseFloat(panel.style.right) || 18,
      });
      dragState = null;
      if (moved) {
        runtimeState.suppressAnchorClickUntil = Date.now() + 220;
      }
    };

    panel.addEventListener('pointerup', finishDrag);
    panel.addEventListener('pointercancel', finishDrag);
  }

  async function readPersistedValue(key, fallbackValue) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const value = await new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(undefined);
            return;
          }

          resolve(result ? result[key] : undefined);
        });
      });

      return value == null ? fallbackValue : value;
    }

    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      return fallbackValue;
    }
  }

  async function writePersistedValue(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          resolve();
        });
      });
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTimestamp(value) {
    try {
      return new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (error) {
      return String(value || '');
    }
  }

  function showToast(message, isError) {
    let toast = document.getElementById(TOAST_ID);

    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      Object.assign(toast.style, {
        position: 'fixed',
        left: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '11px 13px',
        borderRadius: '14px',
        color: '#f8fafc',
        background: 'rgba(15, 23, 42, 0.94)',
        boxShadow: '0 16px 40px rgba(15, 23, 42, 0.28)',
        fontSize: '13px',
        lineHeight: '1.5',
        backdropFilter: 'blur(12px)',
      });
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background = isError ? 'rgba(127, 29, 29, 0.96)' : 'rgba(15, 23, 42, 0.94)';
    toast.style.display = 'block';
    clearTimeout(showToast.timerId);
    showToast.timerId = window.setTimeout(() => {
      toast.style.display = 'none';
    }, 2600);
  }

  function collectConversation() {
    const root = document.querySelector(ROOT_SELECTOR) || document.body;
    const messages = extractMessages(root);
    const title = getConversationTitle();

    if (messages.length === 0) {
      const fallbackNode = root.cloneNode(true);
      Array.from(fallbackNode.querySelectorAll(`#${PANEL_ID}, #${TOAST_ID}`)).forEach((node) => node.remove());
      const fallbackText = normalizeText(fallbackNode.innerText || fallbackNode.textContent || '');
      if (!fallbackText) {
        throw new Error('没有找到对话内容。');
      }

      return {
        title,
        source: window.location.href,
        site: getSiteName(),
        exportedAt: new Date().toISOString(),
        messages: [{ role: 'conversation', markdown: fallbackText, text: fallbackText }],
      };
    }

    return {
      title,
      source: window.location.href,
      site: getSiteName(),
      exportedAt: new Date().toISOString(),
      messages,
    };
  }

  function extractMessages(root) {
    const host = window.location.hostname;
    const strategies = [];

    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      strategies.push(
        () => extractBySelector(root, '[data-message-author-role]', (node) => node.getAttribute('data-message-author-role')),
      );
    }

    if (host.includes('claude.ai')) {
      strategies.push(() => extractClaudeMessages(root));
    }

    if (host.includes('gemini.google.com')) {
      strategies.push(
        () => extractBySelector(
          root,
          'user-query, model-response, message-content, conversation-turn, [class*="query"], [class*="response"]',
          detectRole,
        ),
      );
    }

    strategies.push(
      () => extractBySelector(
        root,
        '[data-testid], article, section, [class*="message"], [class*="Message"], [class*="turn"], [class*="conversation"]',
        detectRole,
      ),
    );

    let bestMessages = [];
    let bestScore = -1;

    for (const strategy of strategies) {
      const messages = dedupeMessages(strategy());
      const score = scoreMessages(messages);

      if (score > bestScore) {
        bestMessages = messages;
        bestScore = score;
      }

      if (messages.length > 0) {
        if (host.includes('claude.ai') && hasRole(messages, 'user') && !hasRole(messages, 'assistant')) {
          continue;
        }

        if (hasRole(messages, 'user') && hasRole(messages, 'assistant')) {
          return messages;
        }
      }
    }

    return bestMessages;
  }

  function extractClaudeMessages(root) {
    const userNodes = filterTopLevel(
      Array.from(
        root.querySelectorAll(
          '[data-testid="user-message"], [data-testid*="user"], [class*="user-message"], [class*="UserMessage"]',
        ),
      ),
    );

    const assistantNodes = filterClaudeAssistantNodes(root, userNodes);
    const primaryMessages = dedupeMessages(
      sortMessagesByDocumentOrder([
        ...extractFromNodes(userNodes, 'user'),
        ...extractFromNodes(assistantNodes, 'assistant'),
      ]),
    );

    if (hasRole(primaryMessages, 'assistant')) {
      return primaryMessages;
    }

    const fallbackMessages = dedupeMessages(
      sortMessagesByDocumentOrder([
        ...extractFromNodes(userNodes, 'user'),
        ...extractClaudeAssistantByCopyButtons(root, userNodes),
      ]),
    );

    return hasRole(fallbackMessages, 'assistant') ? fallbackMessages : [];
  }

  function extractBySelector(root, selector, getRole) {
    const nodes = filterTopLevel(Array.from(root.querySelectorAll(selector)));
    return extractFromNodes(nodes, getRole);
  }

  function extractFromNodes(nodes, getRole) {
    const results = [];

    nodes.forEach((node) => {
      const message = buildMessageFromNode(node, getRole);
      if (message) {
        results.push(message);
      }
    });

    return results;
  }

  function buildMessageFromNode(node, getRole) {
    const markdown = nodeToMarkdown(node);
    if (!markdown) {
      return null;
    }

    const role = normalizeRole(typeof getRole === 'function' ? getRole(node) : getRole);
    return {
      node,
      role,
      markdown,
      text: markdownToText(markdown),
    };
  }

  function filterTopLevel(nodes) {
    return nodes.filter((node) => {
      if (!(node instanceof Element)) {
        return false;
      }

      if (node.id === PANEL_ID || node.id === TOAST_ID) {
        return false;
      }

      if (node.closest(`#${PANEL_ID}, #${TOAST_ID}`)) {
        return false;
      }

      return !nodes.some((other) => other !== node && other.contains(node));
    });
  }

  function dedupeMessages(messages) {
    const seen = new Set();
    const clean = [];

    messages.forEach((message) => {
      const key = `${message.role}::${normalizeText(message.text).slice(0, 300)}`;
      if (!message.text || seen.has(key)) {
        return;
      }

      seen.add(key);
      clean.push(message);
    });

    return clean;
  }

  function sortMessagesByDocumentOrder(messages) {
    return messages.slice().sort((left, right) => {
      if (!left.node || !right.node || left.node === right.node) {
        return 0;
      }

      const position = left.node.compareDocumentPosition(right.node);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }

      return 0;
    });
  }

  function hasRole(messages, role) {
    return messages.some((message) => message.role === role);
  }

  function scoreMessages(messages) {
    if (!messages.length) {
      return -1;
    }

    let score = messages.length;

    if (hasRole(messages, 'user')) {
      score += 10;
    }
    if (hasRole(messages, 'assistant')) {
      score += 10;
    }
    if (hasRole(messages, 'user') && hasRole(messages, 'assistant')) {
      score += 30;
    }

    score += Math.min(
      messages.filter((message) => normalizeText(message.text).length >= 80).length,
      10,
    );

    return score;
  }

  function filterClaudeAssistantNodes(root, userNodes) {
    const selector = [
      '[data-testid="assistant-message"]',
      '[data-testid*="assistant"]',
      '[data-testid*="response"]',
      '[data-is-streaming]',
      '[class*="assistant"]',
      '[class*="Assistant"]',
      '[class*="claude-message"]',
      '[class*="ClaudeMessage"]',
      '[class*="font-claude"]',
      '[class*="prose"]',
      '[class*="Prose"]',
    ].join(', ');

    return filterTopLevel(
      Array.from(root.querySelectorAll(selector)).filter((node) => isLikelyClaudeAssistantNode(node, root, userNodes)),
    );
  }

  function extractClaudeAssistantByCopyButtons(root, userNodes) {
    const controls = Array.from(root.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid]')).filter(
      isClaudeCopyControl,
    );

    const containers = [];
    const seen = new Set();

    controls.forEach((control) => {
      const container = findClaudeAssistantContainerFromAction(control, root, userNodes);
      if (container && !seen.has(container)) {
        seen.add(container);
        containers.push(container);
      }
    });

    return extractFromNodes(filterTopLevel(containers), 'assistant');
  }

  function isClaudeCopyControl(node) {
    const bits = getNodeDetectionBits(node);
    return bits.includes('copy');
  }

  function findClaudeAssistantContainerFromAction(node, root, userNodes) {
    let current = node instanceof Element ? node : null;
    let depth = 0;

    while (current && current !== root && current !== document.body && depth < 12) {
      if (isLikelyClaudeAssistantNode(current, root, userNodes)) {
        return current;
      }

      current = current.parentElement;
      depth += 1;
    }

    return null;
  }

  function isLikelyClaudeAssistantNode(node, root, userNodes) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (node === root || node === document.body || node.id === PANEL_ID || node.id === TOAST_ID) {
      return false;
    }

    const tag = node.tagName.toLowerCase();
    if (['button', 'nav', 'aside', 'header', 'footer', 'main', 'form'].includes(tag)) {
      return false;
    }

    if (userNodes.some((userNode) => userNode === node || userNode.contains(node) || node.contains(userNode))) {
      return false;
    }

    const text = normalizeText(node.textContent || '');
    if (!text || text.length < 20 || isControlLabel(text)) {
      return false;
    }

    const bits = getNodeDetectionBits(node);
    if (bits.includes('user') || bits.includes('human') || bits.includes('prompt') || bits.includes('query')) {
      return false;
    }

    const hasRichContent = Boolean(node.querySelector('p, pre, code, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6, a[href], img[src]'));
    const looksAssistantish =
      bits.includes('assistant') ||
      bits.includes('claude') ||
      bits.includes('response') ||
      bits.includes('answer') ||
      bits.includes('model');

    return looksAssistantish || hasRichContent || text.length >= 80;
  }

  function nodeToMarkdown(node) {
    if (!(node instanceof Element)) {
      return '';
    }

    const clone = node.cloneNode(true);
    pruneNoise(clone);
    transformContent(clone);
    return normalizeMarkdown(clone.textContent || '');
  }

  function pruneNoise(root) {
    Array.from(root.querySelectorAll(NOISE_SELECTOR)).forEach((element) => {
      element.remove();
    });

    Array.from(root.querySelectorAll('*')).forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }

      const text = normalizeText(element.textContent || '');
      if (!text) {
        return;
      }

      if (text.length <= 40 && isControlLabel(text)) {
        element.remove();
      }
    });
  }

  function transformContent(root) {
    replaceNodes(root, 'pre', (element) => {
      const language = detectLanguage(element);
      const code = trimTrailingNewline(element.textContent || '');
      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    });

    replaceNodes(root, 'code', (element) => {
      if (element.closest('pre')) {
        return null;
      }

      const text = normalizeInline(element.textContent || '');
      return text ? `\`${text}\`` : null;
    });

    replaceNodes(root, 'h1, h2, h3, h4, h5, h6', (element) => {
      const level = Number(element.tagName.charAt(1)) || 2;
      const text = normalizeText(element.textContent || '');
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : null;
    });

    replaceNodes(root, 'ul, ol', (element) => {
      const items = Array.from(element.children)
        .filter((child) => child.tagName === 'LI')
        .map((child, index) => {
          const bullet = element.tagName === 'OL' ? `${index + 1}. ` : '- ';
          const text = normalizeText(child.textContent || '');
          return text ? `${bullet}${text}` : '';
        })
        .filter(Boolean);

      return items.length ? `\n${items.join('\n')}\n` : null;
    });

    replaceNodes(root, 'blockquote', (element) => {
      const text = normalizeText(element.textContent || '');
      if (!text) {
        return null;
      }

      return `\n${text.split('\n').map((line) => `> ${line}`).join('\n')}\n`;
    });

    replaceNodes(root, 'table', (element) => {
      const rows = Array.from(element.querySelectorAll('tr'))
        .map((row) => Array.from(row.querySelectorAll('th, td')).map((cell) => normalizeText(cell.textContent || '')))
        .filter((cells) => cells.some(Boolean));

      if (!rows.length) {
        return null;
      }

      const header = rows[0];
      const divider = header.map(() => '---');
      const body = rows.slice(1);
      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${divider.join(' | ')} |`,
        ...body.map((row) => `| ${row.join(' | ')} |`),
      ];
      return `\n${lines.join('\n')}\n`;
    });

    replaceNodes(root, 'a[href]', (element) => {
      const text = normalizeText(element.textContent || '');
      const href = element.getAttribute('href') || '';
      if (!href) {
        return text || null;
      }

      if (!text || text === href) {
        return href;
      }

      return `[${text}](${href})`;
    });

    replaceNodes(root, 'img[src]', (element) => {
      const src = element.getAttribute('src') || '';
      const alt = normalizeText(element.getAttribute('alt') || 'image');
      if (!src) {
        return alt ? `[Image: ${alt}]` : null;
      }
      return `![${alt}](${src})`;
    });
  }

  function replaceNodes(root, selector, buildText) {
    Array.from(root.querySelectorAll(selector)).forEach((element) => {
      const replacement = buildText(element);
      if (replacement == null) {
        return;
      }

      const textNode = document.createTextNode(replacement);
      element.replaceWith(textNode);
    });
  }

  function detectLanguage(element) {
    const hints = [
      element.getAttribute('data-language'),
      element.getAttribute('data-lang'),
      element.className,
      element.querySelector('code') ? element.querySelector('code').className : '',
    ]
      .filter(Boolean)
      .join(' ');

    const match = hints.match(/language[-_: ]([a-z0-9#+-]+)/i) || hints.match(/\b(lang|language)[-_ ]?([a-z0-9#+-]+)\b/i);
    if (match) {
      return (match[1] === 'lang' || match[1] === 'language' ? match[2] : match[1]).toLowerCase();
    }

    return '';
  }

  function markdownToText(markdown) {
    return normalizeText(
      markdown
        .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z0-9#+-]*\n?/gi, '').trim())
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, 'Image: $1 ($2)'),
    );
  }

  function getNodeDetectionBits(node) {
    const bits = [];
    let current = node instanceof Element ? node : null;
    let depth = 0;

    while (current && depth < 4) {
      bits.push(current.tagName ? current.tagName.toLowerCase() : '');
      bits.push(current.getAttribute ? current.getAttribute('data-testid') : '');
      bits.push(current.getAttribute ? current.getAttribute('aria-label') : '');
      bits.push(current.getAttribute ? current.getAttribute('role') : '');
      bits.push(current.getAttribute ? current.getAttribute('data-message-author-role') : '');
      bits.push(current.id || '');
      bits.push(current.className || '');

      if (current.dataset) {
        bits.push(Object.values(current.dataset).join(' '));
      }

      current = current.parentElement;
      depth += 1;
    }

    return bits.filter(Boolean).join(' ').toLowerCase();
  }

  function detectClaudeRole(node) {
    const bits = getNodeDetectionBits(node);

    if (bits.includes('user') || bits.includes('human') || bits.includes('prompt') || bits.includes('query')) {
      return 'user';
    }

    if (
      bits.includes('assistant') ||
      bits.includes('claude') ||
      bits.includes('model') ||
      bits.includes('response') ||
      bits.includes('answer')
    ) {
      return 'assistant';
    }

    if (node instanceof Element && node.querySelector('pre, code, table, ol, ul, blockquote')) {
      return 'assistant';
    }

    return detectRole(node);
  }

  function detectRole(node) {
    const bits = getNodeDetectionBits(node);

    if (bits.includes('user') || bits.includes('human') || bits.includes('prompt') || bits.includes('query')) {
      return 'user';
    }

    if (
      bits.includes('assistant') ||
      bits.includes('claude') ||
      bits.includes('model') ||
      bits.includes('gemini') ||
      bits.includes('response') ||
      bits.includes('answer')
    ) {
      return 'assistant';
    }

    if (bits.includes('system')) {
      return 'system';
    }

    return 'assistant';
  }

  function normalizeRole(value) {
    const role = String(value || '').toLowerCase();
    if (role.includes('user') || role.includes('human') || role.includes('prompt') || role.includes('query')) {
      return 'user';
    }
    if (role.includes('assistant') || role.includes('claude') || role.includes('model') || role.includes('response')) {
      return 'assistant';
    }
    if (role.includes('system')) {
      return 'system';
    }
    if (role.includes('tool')) {
      return 'tool';
    }
    return 'assistant';
  }

  function getConversationTitle() {
    const heading = document.querySelector('main h1, main h2');
    const rawTitle = normalizeText((heading && heading.innerText) || document.title || 'chat-session');
    return rawTitle
      .replace(/\s*[-–|·]\s*(ChatGPT|OpenAI|Claude|Anthropic|Gemini|Google)\s*$/i, '')
      .replace(/^(ChatGPT|Claude|Gemini)\s*[-–|:]\s*/i, '') || 'chat-session';
  }

  function getSiteName() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      return 'ChatGPT';
    }
    if (host.includes('claude.ai')) {
      return 'Claude';
    }
    if (host.includes('gemini.google.com')) {
      return 'Gemini';
    }
    return host;
  }

  function buildMarkdown(bundle) {
    const header = [
      `# ${bundle.title}`,
      '',
      `- Site: ${bundle.site}`,
      `- Source: ${bundle.source}`,
      `- Exported: ${bundle.exportedAt}`,
      '',
    ].join('\n');

    const body = bundle.messages
      .map((message) => {
        const label = ROLE_LABELS[message.role] || 'Assistant';
        return `## ${label}\n\n${message.markdown}`;
      })
      .join('\n\n');

    return `${header}${body}\n`;
  }

  function buildText(bundle) {
    const header = [
      bundle.title,
      `Site: ${bundle.site}`,
      `Source: ${bundle.source}`,
      `Exported: ${bundle.exportedAt}`,
      '',
    ].join('\n');

    const body = bundle.messages
      .map((message) => {
        const label = ROLE_LABELS[message.role] || 'Assistant';
        return `[${label}]\n${message.text}`;
      })
      .join('\n\n');

    return `${header}${body}\n`;
  }

  function buildFilename(title, extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = sanitizeFilename(title).slice(0, 80) || 'chat-session';
    return `${safeTitle}-${getSiteName().toLowerCase()}-${stamp}.${extension}`;
  }

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function sanitizeFilename(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }

  function normalizeMarkdown(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeInline(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function trimTrailingNewline(value) {
    return String(value || '').replace(/\n+$/g, '');
  }

  function isControlLabel(text) {
    const compact = text.toLowerCase();
    return [
      'copy',
      'copy code',
      'retry',
      'regenerate',
      'edit',
      'share',
      'thumbs up',
      'thumbs down',
      'good response',
      'bad response',
      'read aloud',
      'export',
      'download',
    ].includes(compact);
  }

  async function ensureMounted() {
    if (!document.body) {
      return;
    }

    ensurePanelStyles();
    const panel = createPanel();
    await hydratePanel(panel);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || (message.type !== 'EXPORT_CONVERSATION' && message.type !== 'SAVE_CURRENT_CONVERSATION')) {
        return undefined;
      }

      const panel = document.getElementById(PANEL_ID) || createPanel();
      const task =
        message.type === 'SAVE_CURRENT_CONVERSATION'
          ? saveCurrentConversation().then(async (item) => {
              runtimeState.selectedArchiveId = item.id;
              await refreshArchive(panel, item.id);
              return { ok: true, saved: true, id: item.id, title: item.title };
            })
          : exportConversation(message.format);

      task
        .then((result) => sendResponse(result))
        .catch((error) => {
          const messageText = error && error.message ? error.message : '操作失败，请稍后重试。';
          showToast(messageText, true);
          sendResponse({ ok: false, error: messageText });
        });

      return true;
    });
  }

  ensureMounted().catch((error) => {
    console.error('Failed to initialize chat memo panel:', error);
  });

  const observer = new MutationObserver(() => {
    if (window.location.href !== runtimeState.currentHref) {
      runtimeState.currentHref = window.location.href;
    }

    if (!document.getElementById(PANEL_ID)) {
      ensureMounted().catch((error) => {
        console.error('Failed to remount chat memo panel:', error);
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
