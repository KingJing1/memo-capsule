// ==UserScript==
// @name         Memo Capsule
// @namespace    https://openai.com/codex
// @version      0.4.2
// @description  Save AI chats, keep a quick note, and browse curated excerpts.
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
  const NOTE_HISTORY_KEY = 'tmChatExportNoteHistory';
  const PANEL_STATE_KEY = 'tmChatExportPanelState';
  const MAX_ARCHIVE_ITEMS = 100;
  const MAX_NOTE_ITEMS = 100;
  const STORAGE_WARNING_THRESHOLD = 80;
  const ROOT_SELECTOR = 'main, [role="main"]';
  const CAT_ASSET_PATH = 'assets/cat-save.png';
  const EXCERPT_DATA_KEY = '__MEMO_CAPSULE_EXCERPTS__';
  const EXCERPT_LABEL = '书摘 · @一龙小包子';
  const NOISE_SELECTOR = [
    'button',
    'svg',
    'path',
    'header',
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
    user: 'YOU',
    assistant: 'AI',
    system: 'SYSTEM',
    tool: 'TOOL',
    conversation: 'CONVERSATION',
  };

  const runtimeState = {
    selectedArchiveId: null,
    selectedNoteId: null,
    selectedNoteIds: new Set(),
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

  function getAssetUrl(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(path);
    }

    return path;
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
        color: #2f261f;
        --tm-paper: rgba(248, 239, 227, 0.96);
        --tm-paper-strong: rgba(253, 247, 239, 0.98);
        --tm-surface: #fffaf4;
        --tm-surface-soft: #f5ecdf;
        --tm-surface-muted: #efe3d4;
        --tm-ink: #2f261f;
        --tm-ink-soft: #6f6156;
        --tm-line: rgba(92, 72, 54, 0.14);
        --tm-line-strong: rgba(92, 72, 54, 0.2);
        --tm-shadow: rgba(81, 57, 38, 0.16);
        --tm-accent: #cc785c;
        --tm-accent-strong: #b86348;
        --tm-accent-soft: #f2ddcf;
        --tm-user: #f6e7db;
        --tm-assistant: #fffaf4;
      }

      #${PANEL_ID}[data-collapsed="true"] .tm-card,
      #${PANEL_ID}[data-collapsed="true"] .tm-drawer {
        display: none;
      }

      #${PANEL_ID}[data-collapsed="false"] .tm-anchor-shell {
        display: none;
      }

      #${PANEL_ID}[data-anchor-empty="true"] .tm-anchor {
        display: none;
      }

      #${PANEL_ID}[data-anchor-empty="true"] .tm-anchor-card {
        display: none;
      }

      #${PANEL_ID}[data-anchor-empty="false"] .tm-cat-card {
        display: none;
      }

      #${PANEL_ID}[data-anchor-type="excerpt"] .tm-anchor-refresh {
        display: inline-flex;
      }

      #${PANEL_ID}[data-drawer-open="false"] .tm-drawer {
        display: none;
      }

      #${PANEL_ID}[data-drawer-open="true"] .tm-drawer {
        display: flex;
      }

      #${PANEL_ID} .tm-anchor-shell {
        display: flex;
        align-items: flex-end;
        gap: 10px;
        max-width: 286px;
      }

      #${PANEL_ID} .tm-anchor-card {
        position: relative;
        width: min(268px, calc(100vw - 110px));
      }

      #${PANEL_ID} .tm-cat-card {
        position: relative;
        width: 78px;
        min-width: 78px;
      }

      #${PANEL_ID} .tm-anchor {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 4px;
        border: 1px solid var(--tm-line);
        border-radius: 20px;
        padding: 13px 14px 34px;
        min-width: 164px;
        width: 100%;
        background: linear-gradient(180deg, rgba(255, 250, 244, 0.98), rgba(246, 235, 220, 0.96));
        color: var(--tm-ink);
        cursor: pointer;
        box-shadow: 0 14px 40px var(--tm-shadow);
        font-size: 12px;
        line-height: 1.45;
        text-align: left;
        letter-spacing: -0.01em;
        backdrop-filter: blur(18px);
      }

      #${PANEL_ID} .tm-anchor-kind,
      #${PANEL_ID} .tm-anchor-meta {
        display: block;
        font-size: 11px;
        line-height: 1.45;
        color: var(--tm-ink-soft);
      }

      #${PANEL_ID} .tm-anchor-kind {
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      #${PANEL_ID} .tm-anchor-copy {
        display: block;
        font-family: "Iowan Old Style", "Georgia", "Songti SC", "STSong", serif;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.6;
        color: var(--tm-ink);
        margin-top: 4px;
        padding-right: 14px;
        white-space: pre-line;
        word-break: break-word;
        overflow: visible;
      }

      #${PANEL_ID} .tm-anchor-meta {
        margin-top: 10px;
        padding-right: 14px;
        overflow: visible;
      }

      #${PANEL_ID} .tm-anchor-badge {
        position: absolute;
        right: 12px;
        bottom: 6px;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(180deg, var(--tm-accent), var(--tm-accent-strong));
        color: #fffaf5;
        box-shadow: 0 10px 20px rgba(184, 99, 72, 0.22);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 700;
      }

      #${PANEL_ID} .tm-anchor-refresh {
        display: none;
        position: absolute;
        right: 46px;
        bottom: 6px;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(180deg, var(--tm-accent), var(--tm-accent-strong));
        color: #fffaf5;
        box-shadow: 0 10px 20px rgba(184, 99, 72, 0.22);
        cursor: pointer;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
      }

      #${PANEL_ID} .tm-cat-anchor {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 78px;
        min-width: 78px;
        min-height: 96px;
        padding: 0;
        border: 1px solid rgba(194, 162, 132, 0.2);
        border-radius: 24px;
        background: linear-gradient(180deg, rgba(255, 249, 242, 0.98), rgba(244, 231, 216, 0.98));
        color: inherit;
        box-shadow: 0 16px 34px rgba(114, 86, 58, 0.14);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        cursor: pointer;
        position: relative;
        overflow: visible;
        transition: background 140ms ease, border-color 140ms ease, box-shadow 180ms ease;
      }

      #${PANEL_ID} .tm-save-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 66px;
        height: 82px;
        transform: translate(-4px, -2px) scale(1);
        transform-origin: 50% 100%;
        filter: drop-shadow(0 10px 18px rgba(114, 86, 58, 0.12));
        transition: transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1), filter 220ms ease;
      }

      #${PANEL_ID} .tm-save-glyph img {
        display: block;
        width: 66px;
        height: 82px;
        object-fit: contain;
        user-select: none;
        pointer-events: none;
      }

      #${PANEL_ID} .tm-cat-badge {
        position: absolute;
        right: 8px;
        bottom: 4px;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(180deg, var(--tm-accent), var(--tm-accent-strong));
        color: #fffaf5;
        box-shadow: 0 10px 20px rgba(184, 99, 72, 0.22);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 700;
        transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
      }

      #${PANEL_ID} .tm-card {
        width: 320px;
        padding: 18px;
        border-radius: 28px;
        background: var(--tm-paper-strong);
        box-shadow: 0 28px 72px rgba(81, 57, 38, 0.16);
        backdrop-filter: blur(18px);
        border: 1px solid var(--tm-line);
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
        color: var(--tm-ink-soft);
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
        color: var(--tm-ink);
        font-family: "Iowan Old Style", "Georgia", "Songti SC", "STSong", serif;
      }

      #${PANEL_ID} .tm-title span,
      #${PANEL_ID} .tm-drawer-head span,
      #${PANEL_ID} .tm-detail-meta,
      #${PANEL_ID} .tm-empty,
      #${PANEL_ID} .tm-item-meta {
        font-size: 12px;
        line-height: 1.5;
        color: var(--tm-ink-soft);
      }

      #${PANEL_ID} .tm-title-editor {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      #${PANEL_ID} .tm-title-input {
        width: min(320px, 100%);
        border: 1px solid var(--tm-line);
        border-radius: 12px;
        padding: 9px 12px;
        background: rgba(255, 250, 244, 0.92);
        color: var(--tm-ink);
        font: inherit;
        font-family: "Iowan Old Style", "Georgia", "Songti SC", "STSong", serif;
        font-size: 15px;
      }

      #${PANEL_ID} .tm-title-input:focus {
        outline: none;
        border-color: rgba(204, 120, 92, 0.56);
        box-shadow: 0 0 0 3px rgba(204, 120, 92, 0.12);
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
        transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
      }

      #${PANEL_ID} button.tm-primary {
        background: linear-gradient(180deg, var(--tm-accent), var(--tm-accent-strong));
        color: #fffaf5;
        box-shadow: 0 10px 24px rgba(184, 99, 72, 0.18);
      }

      #${PANEL_ID} button.tm-secondary {
        background: rgba(255, 250, 244, 0.92);
        color: var(--tm-ink);
        border: 1px solid var(--tm-line);
      }

      #${PANEL_ID} button.tm-ghost {
        background: transparent;
        color: var(--tm-ink-soft);
        padding-inline: 8px;
      }

      #${PANEL_ID} button.tm-primary:hover,
      #${PANEL_ID} button.tm-secondary:hover,
      #${PANEL_ID} .tm-anchor:hover,
      #${PANEL_ID} .tm-item:hover {
        transform: translateY(-1px);
      }

      #${PANEL_ID} .tm-cat-anchor:hover .tm-save-glyph {
        transform: translate(-4px, -2px) scale(1.11);
        filter: drop-shadow(0 14px 22px rgba(114, 86, 58, 0.16));
      }

      #${PANEL_ID} .tm-anchor-refresh:hover,
      #${PANEL_ID} .tm-anchor-badge:hover,
      #${PANEL_ID} .tm-cat-badge:hover {
        transform: translateY(-1px) scale(1.04);
      }

      #${PANEL_ID} .tm-note {
        margin-top: 18px;
        padding-top: 16px;
        border-top: 1px solid var(--tm-line);
      }

      #${PANEL_ID} .tm-note label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 600;
        color: var(--tm-ink-soft);
      }

      #${PANEL_ID} .tm-note textarea {
        width: 100%;
        min-height: 72px;
        resize: vertical;
        border: 1px solid var(--tm-line);
        border-radius: 16px;
        background: var(--tm-surface);
        color: var(--tm-ink);
        padding: 12px 14px;
        font: inherit;
        font-size: 13px;
        line-height: 1.55;
        box-sizing: border-box;
      }

      #${PANEL_ID} .tm-note-links {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        flex-wrap: wrap;
      }

      #${PANEL_ID} .tm-note-links .tm-note-spacer {
        margin-left: auto;
      }

      #${PANEL_ID} .tm-note-links button {
        border: 0;
        background: transparent;
        color: var(--tm-ink-soft);
        cursor: pointer;
        padding: 0;
        font-size: 12px;
        font-weight: 600;
      }

      #${PANEL_ID} .tm-note-help {
        font-size: 12px;
        line-height: 1.5;
        color: var(--tm-ink-soft);
      }

      #${PANEL_ID} .tm-credit {
        margin-top: 12px;
      }

      #${PANEL_ID} .tm-credit-note {
        font-size: 11px;
        color: var(--tm-ink-soft);
        opacity: 0.82;
      }

      #${PANEL_ID} .tm-credit-by {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
        color: var(--tm-ink-soft);
        font-size: 11px;
        line-height: 1.45;
        font-weight: 500;
        font-family: "Iowan Old Style", "Georgia", "Songti SC", "STSong", serif;
        letter-spacing: -0.01em;
        opacity: 0.9;
      }

      #${PANEL_ID} .tm-credit a {
        color: var(--tm-ink-soft);
        font-size: 11px;
        line-height: 1.45;
        font-weight: 500;
        font-family: "Iowan Old Style", "Georgia", "Songti SC", "STSong", serif;
        text-decoration: none;
      }

      #${PANEL_ID} .tm-credit a:hover {
        color: var(--tm-ink-soft);
        opacity: 0.78;
      }

      #${PANEL_ID} .tm-drawer {
        position: fixed;
        top: 24px;
        right: 24px;
        width: min(920px, calc(100vw - 40px));
        height: min(84vh, 900px);
        border-radius: 32px;
        overflow: hidden;
        background: var(--tm-paper-strong);
        border: 1px solid var(--tm-line);
        box-shadow: 0 32px 90px rgba(81, 57, 38, 0.16);
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
        border-right: 1px solid var(--tm-line);
        overflow: auto;
        background: var(--tm-surface-soft);
      }

      #${PANEL_ID} .tm-list-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 18px;
      }

      #${PANEL_ID} .tm-drawer-head-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      #${PANEL_ID} .tm-tabs {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: rgba(255, 250, 244, 0.88);
        border: 1px solid var(--tm-line);
      }

      #${PANEL_ID} .tm-tab {
        border: 0;
        background: transparent;
        color: var(--tm-ink-soft);
        border-radius: 999px;
        padding: 7px 10px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }

      #${PANEL_ID} .tm-tab.is-active {
        background: rgba(204, 120, 92, 0.14);
        color: var(--tm-ink);
      }

      #${PANEL_ID} .tm-note-row {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr);
        gap: 8px;
        align-items: stretch;
      }

      #${PANEL_ID} .tm-select-toggle {
        border: 1px solid var(--tm-line);
        border-radius: 14px;
        background: rgba(255, 250, 244, 0.88);
        color: var(--tm-ink-soft);
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
      }

      #${PANEL_ID} .tm-select-toggle.is-selected {
        color: var(--tm-accent-strong);
        border-color: rgba(204, 120, 92, 0.28);
        background: rgba(204, 120, 92, 0.12);
      }

      #${PANEL_ID} .tm-note-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }

      #${PANEL_ID} .tm-note-edit {
        width: 100%;
        min-height: 160px;
        margin-top: 16px;
        resize: vertical;
        border: 1px solid var(--tm-line);
        border-radius: 18px;
        background: var(--tm-surface);
        color: var(--tm-ink);
        padding: 14px;
        box-sizing: border-box;
        font: inherit;
        font-size: 13px;
        line-height: 1.68;
      }

      #${PANEL_ID} .tm-item {
        text-align: left;
        padding: 14px;
        border-radius: 20px;
        background: rgba(255, 250, 244, 0.88);
        transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        border: 1px solid rgba(92, 72, 54, 0.08);
      }

      #${PANEL_ID} .tm-item:hover {
        background: rgba(255, 252, 248, 0.98);
        border-color: rgba(204, 120, 92, 0.24);
      }

      #${PANEL_ID} .tm-item.is-active {
        background: rgba(255, 252, 248, 0.98);
        border-color: rgba(204, 120, 92, 0.38);
        box-shadow: 0 10px 28px rgba(184, 99, 72, 0.12);
      }

      #${PANEL_ID} .tm-item-title {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.45;
        color: var(--tm-ink);
        font-family: "Iowan Old Style", "Georgia", "Songti SC", "STSong", serif;
      }

      #${PANEL_ID} .tm-item-meta {
        margin-top: 6px;
      }

      #${PANEL_ID} .tm-item-excerpt {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.55;
        color: rgba(47, 38, 31, 0.84);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      #${PANEL_ID} .tm-detail {
        padding: 20px;
        overflow: auto;
        background: var(--tm-surface);
      }

      #${PANEL_ID} .tm-detail-card {
        min-height: 100%;
        border-radius: 24px;
        background: rgba(255, 250, 244, 0.94);
        border: 1px solid var(--tm-line);
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
        background: var(--tm-assistant);
        border: 1px solid rgba(92, 72, 54, 0.08);
      }

      #${PANEL_ID} .tm-message[data-role="user"] {
        background: var(--tm-user);
        border-color: rgba(204, 120, 92, 0.16);
      }

      #${PANEL_ID} .tm-message[data-role="assistant"] {
        background: var(--tm-assistant);
      }

      #${PANEL_ID} .tm-message-head {
        margin-bottom: 8px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--tm-ink-soft);
      }

      #${PANEL_ID} .tm-message-body {
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 14px;
        line-height: 1.72;
        color: var(--tm-ink);
      }

      #${PANEL_ID} .tm-message-body code {
        font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        background: rgba(111, 97, 86, 0.08);
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
          border-bottom: 1px solid var(--tm-line);
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
      <div class="tm-anchor-shell" aria-label="会话归档入口">
        <div class="tm-anchor-card">
          <button type="button" class="tm-anchor" data-action="toggle-panel" data-drag-handle="true" title="打开 Memo Capsule">
            <span class="tm-anchor-kind" data-role="anchor-kind">便签</span>
            <span class="tm-anchor-copy" data-role="anchor-label"></span>
            <span class="tm-anchor-meta" data-role="anchor-meta"></span>
          </button>
          <button type="button" class="tm-anchor-refresh" data-action="randomize-anchor" title="换一条随机书摘" aria-label="换一条随机书摘">↻</button>
          <button type="button" class="tm-anchor-badge" data-action="hide-anchor" title="切回小猫" aria-label="切回小猫">→</button>
        </div>
        <div class="tm-cat-card">
          <button type="button" class="tm-cat-anchor" data-action="toggle-panel" data-drag-handle="true" title="打开 Memo Capsule">
            <span class="tm-save-glyph" aria-hidden="true">
              <img src="" alt="打开面板的小猫按钮" data-role="cat-image" />
            </span>
          </button>
          <button type="button" class="tm-cat-badge" data-action="save-current-inline" title="保存当前对话" aria-label="保存当前对话">↓</button>
        </div>
      </div>
      <section class="tm-card" aria-label="会话归档控制台">
        <div class="tm-card-head">
          <button type="button" class="tm-drag" data-drag-handle="true" title="拖动位置">⋮⋮</button>
          <div class="tm-title">
            <strong>Memo Capsule</strong>
            <span>存对话，记想法，翻书摘</span>
          </div>
          <button type="button" class="tm-ghost" data-action="collapse" title="收起">收起</button>
        </div>
        <div class="tm-card-actions">
          <button type="button" class="tm-primary" data-action="save-current">保存对话</button>
          <button type="button" class="tm-secondary" data-action="toggle-drawer">历史存档</button>
        </div>
        <div class="tm-note">
          <label for="${PANEL_ID}-note">折叠后显示</label>
          <textarea id="${PANEL_ID}-note" data-role="anchor-note-input" placeholder="随手记一笔，等下要问的、要做的"></textarea>
          <div class="tm-note-links">
            <button type="button" data-action="use-random-excerpt">换一条随机书摘</button>
            <span style="color:var(--tm-ink-soft);font-size:12px;user-select:none"> · </span>
            <button type="button" data-action="open-notes">便签记录</button>
            <span style="color:var(--tm-ink-soft);font-size:12px;user-select:none"> · </span>
            <button type="button" data-action="clear-anchor">清空</button>
            <span class="tm-note-spacer"></span>
            <button type="button" class="tm-secondary" data-action="save-note">保存</button>
          </div>
        </div>
        <div class="tm-credit" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <span class="tm-credit-note">所有数据仅存储在你的本地设备</span>
          <span class="tm-credit-by">by <a href="https://twitter.com/KingJing001" target="_blank" rel="noopener noreferrer">@一龙小包子</a></span>
        </div>
      </section>
      <aside class="tm-drawer" aria-label="会话归档">
        <div class="tm-drawer-shell">
          <section class="tm-list">
            <div class="tm-drawer-head">
              <div>
                <strong data-role="drawer-title">本地归档</strong>
                <span class="tm-count">0 条</span>
              </div>
              <div class="tm-drawer-head-actions">
                <div class="tm-tabs">
                  <button type="button" class="tm-tab is-active" data-action="switch-drawer-view" data-view="archive">会话</button>
                  <button type="button" class="tm-tab" data-action="switch-drawer-view" data-view="notes">便签</button>
                </div>
                <button type="button" class="tm-ghost" data-action="close-drawer" title="关闭">关闭</button>
              </div>
            </div>
            <div class="tm-list-body" data-archive-list="true"></div>
          </section>
          <section class="tm-detail">
            <div class="tm-detail-card" data-archive-detail="true">
              <div class="tm-empty">还没有保存的会话。点一次「保存对话」试试。</div>
            </div>
          </section>
        </div>
      </aside>
    `;

    const catImage = panel.querySelector('[data-role="cat-image"]');
    if (catImage instanceof HTMLImageElement) {
      catImage.src = getAssetUrl(CAT_ASSET_PATH);
    }

    panel.addEventListener('click', (event) => {
      handlePanelAction(event, panel);
    });

    panel.addEventListener('keydown', (event) => {
      const target = event.target;

      if (
        target instanceof HTMLTextAreaElement &&
        target.getAttribute('data-role') === 'anchor-note-input' &&
        (event.metaKey || event.ctrlKey) &&
        event.key === 'Enter'
      ) {
        event.preventDefault();
        const button = panel.querySelector('[data-action="save-note"]');
        if (button instanceof HTMLButtonElement) {
          button.click();
        }
        return;
      }

      if (target instanceof HTMLInputElement && target.getAttribute('data-role') === 'archive-title-input' && event.key === 'Enter') {
        event.preventDefault();
        const button = panel.querySelector('[data-action="archive-save-title"]');
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
    await refreshDrawer(panel);
  }

  async function handlePanelAction(event, panel) {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.getAttribute('data-action');

    if (action === 'toggle-panel') {
      if (Date.now() < runtimeState.suppressAnchorClickUntil) {
        event.preventDefault();
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
      const state = await setPanelState({ collapsed: false, drawerOpen: nextOpen, drawerView: 'archive' });
      applyPanelState(panel, state);
      if (nextOpen) {
        await refreshDrawer(panel, { view: 'archive' });
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
        await refreshDrawer(panel, { view: 'archive', preferredId: item.id });
        const state = await setPanelState({ collapsed: false, drawerOpen: true, drawerView: 'archive' });
        applyPanelState(panel, state);
      });
      return;
    }

    if (action === 'save-current-inline') {
      if (Date.now() < runtimeState.suppressAnchorClickUntil) {
        event.preventDefault();
        return;
      }

      await runButtonAction(
        actionTarget,
        async () => {
          const item = await saveCurrentConversation();
          runtimeState.selectedArchiveId = item.id;
          await refreshDrawer(panel, { preferredId: item.id });
        },
        { pendingText: '…', successText: '✓' },
      );
      return;
    }

    if (action === 'hide-anchor') {
      const state = await setPanelState({
        anchorVisible: false,
        collapsed: true,
        drawerOpen: false,
      });
      applyPanelState(panel, state);
      return;
    }

    if (action === 'randomize-anchor') {
      const panelState = await getPanelState();
      if (panelState.anchorType !== 'excerpt') {
        return;
      }

      const excerpt = pickRandomExcerpt();
      if (!excerpt) {
        showToast('书摘还没有准备好。', true);
        return;
      }

      const state = await setPanelState({
        anchorText: excerpt.text,
        anchorType: 'excerpt',
        anchorMeta: buildExcerptMeta(excerpt),
        anchorVisible: true,
        currentNoteId: null,
        collapsed: true,
        drawerOpen: false,
      });
      applyPanelState(panel, state);
      showToast('已切换书摘。');
      return;
    }

    if (action === 'save-note') {
      const input = panel.querySelector('[data-role="anchor-note-input"]');
      const nextText = normalizeText(input && 'value' in input ? input.value : '');
      if (!nextText) {
        const state = await setPanelState({
          anchorText: '',
          anchorType: '',
          anchorMeta: '',
          anchorVisible: false,
          currentNoteId: null,
          collapsed: true,
          drawerOpen: false,
        });
        applyPanelState(panel, state);
        showToast('已清空便签。');
        return;
      }

      const item = await createNoteItem({
        text: nextText,
        type: 'note',
        sourceLabel: '手动便签',
      });
      runtimeState.selectedNoteId = item.id;
      const state = await setPanelState({
        anchorText: item.text,
        anchorType: item.type,
        anchorMeta: buildAnchorMeta(item),
        anchorVisible: true,
        currentNoteId: item.id,
        collapsed: true,
        drawerOpen: false,
      });
      applyPanelState(panel, state);
      showToast(buildStorageNotice('便签', item.__count, item.__didReplace, '已更新便签。'));
      return;
    }

    if (action === 'use-random-excerpt') {
      const excerpt = pickRandomExcerpt();
      if (!excerpt) {
        showToast('书摘还没有准备好。', true);
        return;
      }

      const state = await setPanelState({
        anchorText: excerpt.text,
        anchorType: 'excerpt',
        anchorMeta: buildExcerptMeta(excerpt),
        anchorVisible: true,
        currentNoteId: null,
        collapsed: true,
        drawerOpen: false,
      });
      applyPanelState(panel, state);
      showToast('已切换书摘。');
      return;
    }

    if (action === 'clear-anchor') {
      const input = panel.querySelector('[data-role="anchor-note-input"]');
      if (input && 'value' in input) {
        input.value = '';
      }
      const state = await setPanelState({
        anchorText: '',
        anchorType: '',
        anchorMeta: '',
        anchorVisible: false,
        currentNoteId: null,
        collapsed: true,
        drawerOpen: false,
      });
      applyPanelState(panel, state);
      showToast('已清空折叠内容。');
      return;
    }

    if (action === 'open-notes') {
      const panelState = await getPanelState();
      runtimeState.selectedNoteId = runtimeState.selectedNoteId || panelState.currentNoteId || null;
      const state = await setPanelState({ collapsed: false, drawerOpen: true, drawerView: 'notes' });
      applyPanelState(panel, state);
      await refreshDrawer(panel, { view: 'notes', preferredId: runtimeState.selectedNoteId });
      return;
    }

    if (action === 'switch-drawer-view') {
      const view = actionTarget.getAttribute('data-view') === 'notes' ? 'notes' : 'archive';
      const state = await setPanelState({ drawerView: view, drawerOpen: true, collapsed: false });
      applyPanelState(panel, state);
      await refreshDrawer(panel, { view });
      return;
    }

    if (action === 'archive-select') {
      runtimeState.selectedArchiveId = actionTarget.getAttribute('data-id') || null;
      await refreshDrawer(panel, { view: 'archive', preferredId: runtimeState.selectedArchiveId });
      return;
    }

    if (action === 'archive-export-md' || action === 'archive-export-txt') {
      const itemId = actionTarget.getAttribute('data-id');
      const items = await getArchiveItems();
      const item = items.find((entry) => entry.id === itemId);
      if (!item) {
        showToast('归档内容不存在，可能已经被删除。', true);
        await refreshDrawer(panel, { view: 'archive' });
        return;
      }

      await runButtonAction(actionTarget, async () => {
        await exportConversation(action === 'archive-export-txt' ? 'txt' : 'md', item);
      });
      return;
    }

    if (action === 'archive-save-title') {
      const itemId = actionTarget.getAttribute('data-id');
      const input = panel.querySelector('[data-role="archive-title-input"]');
      const nextTitle = sanitizeArchiveTitle(input && 'value' in input ? input.value : '');
      if (!itemId || !nextTitle) {
        showToast('标题不能为空。', true);
        return;
      }

      await updateArchiveItem(itemId, (item) => ({
        ...item,
        title: nextTitle,
        customTitle: true,
        bundle: {
          ...(item.bundle || {}),
          title: nextTitle,
        },
      }));
      await refreshDrawer(panel, { view: 'archive', preferredId: itemId });
      showToast('已更新对话标题。');
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
      await refreshDrawer(panel, { view: 'archive', preferredId: runtimeState.selectedArchiveId });
      showToast('已删除本地归档。');
      return;
    }

    if (action === 'note-select') {
      runtimeState.selectedNoteId = actionTarget.getAttribute('data-id') || null;
      await refreshDrawer(panel, { view: 'notes', preferredId: runtimeState.selectedNoteId });
      return;
    }

    if (action === 'note-toggle-select') {
      const itemId = actionTarget.getAttribute('data-id');
      if (!itemId) {
        return;
      }

      if (runtimeState.selectedNoteIds.has(itemId)) {
        runtimeState.selectedNoteIds.delete(itemId);
      } else {
        runtimeState.selectedNoteIds.add(itemId);
      }
      await refreshDrawer(panel, { view: 'notes', preferredId: runtimeState.selectedNoteId });
      return;
    }

    if (action === 'note-select-all') {
      const items = await getNoteItems();
      runtimeState.selectedNoteIds = new Set(items.map((item) => item.id));
      await refreshDrawer(panel, { view: 'notes', preferredId: runtimeState.selectedNoteId });
      return;
    }

    if (action === 'note-clear-selection') {
      runtimeState.selectedNoteIds = new Set();
      await refreshDrawer(panel, { view: 'notes', preferredId: runtimeState.selectedNoteId });
      return;
    }

    if (action === 'note-export-selected-md' || action === 'note-export-selected-txt') {
      const items = await getNoteItems();
      let selectedItems = items.filter((item) => runtimeState.selectedNoteIds.has(item.id));
      if (!selectedItems.length && runtimeState.selectedNoteId) {
        selectedItems = items.filter((item) => item.id === runtimeState.selectedNoteId);
      }
      if (!selectedItems.length) {
        showToast('先勾选要导出的便签。', true);
        return;
      }

      await runButtonAction(actionTarget, async () => {
        exportNotes(action === 'note-export-selected-txt' ? 'txt' : 'md', selectedItems);
      });
      return;
    }

    if (action === 'note-save-edit') {
      const itemId = actionTarget.getAttribute('data-id');
      const input = panel.querySelector('[data-role="note-edit-input"]');
      const nextText = normalizeText(input && 'value' in input ? input.value : '');
      if (!itemId || !nextText) {
        showToast('便签内容不能为空。', true);
        return;
      }

      await updateNoteItem(itemId, { text: nextText });
      const notes = await getNoteItems();
      const current = notes.find((item) => item.id === itemId);
      if (current && (await getPanelState()).currentNoteId === itemId) {
        const state = await setPanelState({
          anchorText: current.text,
          anchorType: current.type,
          anchorMeta: buildAnchorMeta(current),
          anchorVisible: true,
          currentNoteId: current.id,
        });
        applyPanelState(panel, state);
      }
      await refreshDrawer(panel, { view: 'notes', preferredId: itemId });
      showToast('已更新便签。');
      return;
    }

    if (action === 'note-delete') {
      const itemId = actionTarget.getAttribute('data-id');
      if (!itemId) {
        return;
      }

      const notes = await getNoteItems();
      const nextNotes = notes.filter((item) => item.id !== itemId);
      runtimeState.selectedNoteIds.delete(itemId);
      if (runtimeState.selectedNoteId === itemId) {
        runtimeState.selectedNoteId = nextNotes[0] ? nextNotes[0].id : null;
      }
      await setNoteItems(nextNotes);

      const panelState = await getPanelState();
      if (panelState.currentNoteId === itemId) {
        const state = await setPanelState({
          anchorText: '',
          anchorType: '',
          anchorMeta: '',
          anchorVisible: false,
          currentNoteId: null,
        });
        applyPanelState(panel, state);
      }

      await refreshDrawer(panel, { view: 'notes', preferredId: runtimeState.selectedNoteId });
      showToast('已删除便签。');
    }
  }

  async function runButtonAction(button, action, options) {
    const originalText = button.textContent;
    const pendingText = options && options.pendingText ? options.pendingText : '处理中...';
    const successText = options && options.successText ? options.successText : '';
    let success = false;
    button.disabled = true;
    button.textContent = pendingText;

    try {
      await action();
      success = true;
    } catch (error) {
      showToast(error && error.message ? error.message : '操作失败，请稍后重试。', true);
    } finally {
      button.disabled = false;
      if (success && successText) {
        button.textContent = successText;
        window.clearTimeout(button.__tmTextResetTimer);
        button.__tmTextResetTimer = window.setTimeout(() => {
          button.textContent = originalText;
        }, 1400);
        return;
      }

      button.textContent = originalText;
    }
  }

  async function saveCurrentConversation() {
    const bundle = collectConversation();
    const items = await getArchiveItems();
    const existingItem = items.find((entry) => entry.id === buildArchiveId(bundle)) || null;
    const didReplaceOldest = items.length >= MAX_ARCHIVE_ITEMS && !existingItem;
    const item = buildArchiveItem(bundle, existingItem);
    const nextItems = [item, ...items.filter((entry) => entry.id !== item.id)].slice(0, MAX_ARCHIVE_ITEMS);
    await setArchiveItems(nextItems);
    showToast(buildStorageNotice('存档', nextItems.length, didReplaceOldest, `已保存到归档：${item.title}。`));
    return item;
  }

  async function refreshDrawer(panel, options) {
    const state = await getPanelState();
    const view = options && options.view ? options.view : state.drawerView || 'archive';
    panel.dataset.drawerView = view;
    updateDrawerHeader(panel, view);

    if (view === 'notes') {
      await refreshNotes(panel, options && options.preferredId);
      return;
    }

    await refreshArchive(panel, options && options.preferredId);
  }

  function updateDrawerHeader(panel, view) {
    const title = panel.querySelector('[data-role="drawer-title"]');
    const tabs = Array.from(panel.querySelectorAll('.tm-tab'));

    if (title) {
      title.textContent = view === 'notes' ? '便签记录' : '本地归档';
    }

    tabs.forEach((tab) => {
      const active = tab.getAttribute('data-view') === view;
      tab.classList.toggle('is-active', active);
    });
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
      detail.innerHTML = selectedItem ? buildArchiveDetail(selectedItem) : '<div class="tm-empty">选一条，查看完整对话。</div>';
    }
  }

  async function refreshNotes(panel, preferredId) {
    const items = await getNoteItems();
    const list = panel.querySelector('[data-archive-list="true"]');
    const detail = panel.querySelector('[data-archive-detail="true"]');
    const count = panel.querySelector('.tm-count');

    if (count) {
      count.textContent = `${items.length} 条`;
    }

    const selectedId =
      preferredId ||
      runtimeState.selectedNoteId ||
      (items[0] ? items[0].id : null);

    runtimeState.selectedNoteId = selectedId;

    if (list) {
      if (!items.length) {
        list.innerHTML = '<div class="tm-empty">还没有便签记录。</div>';
      } else {
        list.innerHTML = `
          <div class="tm-note-toolbar">
            <button type="button" class="tm-secondary" data-action="note-select-all">全选</button>
            <button type="button" class="tm-secondary" data-action="note-clear-selection">清空选择</button>
            <button type="button" class="tm-primary" data-action="note-export-selected-md">导出 MD</button>
            <button type="button" class="tm-secondary" data-action="note-export-selected-txt">导出 TXT</button>
          </div>
          <div class="tm-list-body">
            ${items
              .map((item) => {
                const activeClass = item.id === selectedId ? ' is-active' : '';
                const selectedClass = runtimeState.selectedNoteIds.has(item.id) ? ' is-selected' : '';
                return `
                  <div class="tm-note-row">
                    <button type="button" class="tm-select-toggle${selectedClass}" data-action="note-toggle-select" data-id="${escapeHtml(item.id)}">${runtimeState.selectedNoteIds.has(item.id) ? '✓' : '○'}</button>
                    <button type="button" class="tm-item${activeClass}" data-action="note-select" data-id="${escapeHtml(item.id)}">
                      <div class="tm-item-title">便签</div>
                      <div class="tm-item-meta">${escapeHtml(formatTimestamp(item.updatedAt || item.savedAt))}</div>
                      <div class="tm-item-excerpt">${escapeHtml(item.text || '')}</div>
                    </button>
                  </div>
                `;
              })
              .join('')}
          </div>
        `;
      }
    }

    const selectedItem = items.find((item) => item.id === selectedId) || null;
    if (detail) {
      detail.innerHTML = selectedItem ? buildNoteDetail(selectedItem) : '<div class="tm-empty">选一条便签查看详情。</div>';
    }
  }

  function buildArchiveDetail(item) {
    const messages = Array.isArray(item.bundle && item.bundle.messages) ? item.bundle.messages : [];
    const feed = messages.length
      ? messages
          .map((message) => {
            const label = getRoleLabel(message.role, item.bundle);
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
          <div class="tm-title-editor">
            <input type="text" class="tm-title-input" data-role="archive-title-input" value="${escapeHtml(item.title)}" placeholder="给这段对话起个名字" />
            <button type="button" class="tm-secondary" data-action="archive-save-title" data-id="${escapeHtml(item.id)}">改名</button>
          </div>
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

  function buildArchiveItem(bundle, existingItem) {
    const id = buildArchiveId(bundle);
    const summarySource = bundle.messages
      .map((message) => message.text || message.markdown || '')
      .find((text) => normalizeText(text).length > 0) || '';
    const fallbackTitle = sanitizeArchiveTitle(bundle.title) || '未命名对话';
    const nextTitle = existingItem && existingItem.customTitle ? existingItem.title : fallbackTitle;

    return {
      id,
      title: nextTitle,
      customTitle: Boolean(existingItem && existingItem.customTitle),
      site: bundle.site || getSiteName(),
      source: bundle.source || window.location.href,
      savedAt: new Date().toISOString(),
      excerpt: buildArchiveExcerpt(summarySource),
      bundle: {
        ...bundle,
        title: nextTitle,
      },
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

  function buildNoteDetail(item) {
    return `
      <div class="tm-detail-head">
        <div>
          <strong>便签</strong>
          <div class="tm-detail-meta">${escapeHtml(item.sourceLabel || '')}</div>
          <div class="tm-detail-meta">更新于 ${escapeHtml(formatTimestamp(item.updatedAt || item.savedAt))}</div>
        </div>
      </div>
      <textarea class="tm-note-edit" data-role="note-edit-input">${escapeHtml(item.text || '')}</textarea>
      <div class="tm-detail-actions">
        <button type="button" class="tm-primary" data-action="note-save-edit" data-id="${escapeHtml(item.id)}">保存修改</button>
        <button type="button" class="tm-secondary" data-action="note-export-selected-md">导出已选</button>
        <button type="button" class="tm-ghost" data-action="note-delete" data-id="${escapeHtml(item.id)}">删除</button>
      </div>
    `;
  }

  async function getArchiveItems() {
    const items = await readPersistedValue(ARCHIVE_KEY, []);
    return Array.isArray(items) ? items : [];
  }

  async function setArchiveItems(items) {
    await writePersistedValue(ARCHIVE_KEY, items);
  }

  async function updateArchiveItem(itemId, updateFn) {
    const items = await getArchiveItems();
    const nextItems = items.map((item) => (item.id === itemId ? updateFn(item) : item));
    await setArchiveItems(nextItems);
  }

  async function getNoteItems() {
    const items = await readPersistedValue(NOTE_HISTORY_KEY, []);
    return Array.isArray(items) ? items : [];
  }

  async function setNoteItems(items) {
    await writePersistedValue(NOTE_HISTORY_KEY, items);
  }

  async function createNoteItem(payload) {
    const items = await getNoteItems();
    const now = new Date().toISOString();
    const item = {
      id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: payload.text,
      type: payload.type || 'note',
      sourceLabel: payload.sourceLabel || '手动便签',
      savedAt: now,
      updatedAt: now,
    };
    const willReplaceOldest = items.length >= MAX_NOTE_ITEMS;
    const nextItems = [item, ...items].slice(0, MAX_NOTE_ITEMS);
    await setNoteItems(nextItems);
    return {
      ...item,
      __count: nextItems.length,
      __didReplace: willReplaceOldest,
    };
  }

  async function updateNoteItem(itemId, patch) {
    const items = await getNoteItems();
    const nextItems = items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...patch,
            updatedAt: new Date().toISOString(),
          }
        : item,
    );
    await setNoteItems(nextItems);
  }

  async function getPanelState() {
    const value = await readPersistedValue(PANEL_STATE_KEY, {});
    const nextState = {
      collapsed: true,
      drawerOpen: false,
      drawerView: 'archive',
      top: 112,
      right: 18,
      anchorVisible: true,
      anchorText: '',
      anchorType: '',
      anchorMeta: '',
      currentNoteId: null,
      ...value,
    };

    if (nextState.anchorText === 'Memo') {
      nextState.anchorText = '';
    }

    return nextState;
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
    panel.dataset.drawerView = state.drawerView || 'archive';
    panel.dataset.anchorType = state.anchorType || '';
    panel.dataset.anchorEmpty =
      normalizeText(state.anchorText || '').length > 0 && state.anchorVisible !== false ? 'false' : 'true';
    panel.style.top = `${Math.max(12, Number(state.top) || 112)}px`;
    panel.style.right = `${Math.max(12, Number(state.right) || 18)}px`;

    const anchor = panel.querySelector('.tm-anchor');
    const anchorLabel = panel.querySelector('[data-role="anchor-label"]');
    const anchorKind = panel.querySelector('[data-role="anchor-kind"]');
    const anchorMeta = panel.querySelector('[data-role="anchor-meta"]');
    const catButton = panel.querySelector('.tm-cat-anchor');
    const saveButton = panel.querySelector('.tm-anchor-badge');
    const catSaveButton = panel.querySelector('.tm-cat-badge');
    const nextAnchorText = normalizeText(state.anchorText || '');
    if (anchorLabel) {
      anchorLabel.textContent = nextAnchorText;
      anchorLabel.title = nextAnchorText;
    }
    if (anchorKind) {
      anchorKind.textContent = state.anchorType === 'excerpt' ? '' : '便签';
      anchorKind.style.display = state.anchorType === 'excerpt' ? 'none' : 'block';
    }
    if (anchorMeta) {
      anchorMeta.textContent = normalizeText(state.anchorMeta || '');
      anchorMeta.title = normalizeText(state.anchorMeta || '');
    }
    if (anchor) {
      anchor.title = nextAnchorText
        ? `${state.anchorType === 'excerpt' ? EXCERPT_LABEL : '便签'}\n\n${nextAnchorText}`
        : '打开 Memo Capsule';
    }
    if (catButton) {
      catButton.title = '打开 Memo Capsule';
      catButton.setAttribute('aria-label', '打开 Memo Capsule');
    }
    if (saveButton) {
      const hideTitle = '切回小猫';
      saveButton.title = hideTitle;
      saveButton.setAttribute('aria-label', hideTitle);
    }
    if (catSaveButton) {
      const saveTitle = '保存当前对话';
      catSaveButton.title = saveTitle;
      catSaveButton.setAttribute('aria-label', saveTitle);
    }

    const input = panel.querySelector('[data-role="anchor-note-input"]');
    if (input && 'value' in input && input.value !== nextAnchorText) {
      input.value = nextAnchorText;
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
      if (Math.abs(event.clientX - dragState.startX) > 6 || Math.abs(event.clientY - dragState.startY) > 6) {
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
      if (moved) {
        runtimeState.suppressAnchorClickUntil = Date.now() + 320;
      }
      await setPanelState({
        top: parseFloat(panel.style.top) || 112,
        right: parseFloat(panel.style.right) || 18,
      });
      dragState = null;
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
        color: '#fffaf5',
        background: 'rgba(54, 41, 31, 0.94)',
        boxShadow: '0 16px 40px rgba(54, 41, 31, 0.24)',
        fontSize: '13px',
        lineHeight: '1.5',
        backdropFilter: 'blur(12px)',
      });
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background = isError ? 'rgba(133, 73, 56, 0.96)' : 'rgba(54, 41, 31, 0.94)';
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
    const conversationTitle = getConversationTitle();
    const userNodes = filterTopLevel(
      Array.from(
        root.querySelectorAll(
          '[data-testid="user-message"], [data-testid*="user"], [class*="user-message"], [class*="UserMessage"]',
        ),
      ),
    ).filter(
      (node) =>
        !isLikelyTitleDecorationNode(node, conversationTitle) &&
        !isLikelyClaudeWorkspaceDecorationNode(node, conversationTitle),
    );

    const assistantNodes = filterClaudeAssistantNodes(root, userNodes, conversationTitle);
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
        ...extractClaudeAssistantByCopyButtons(root, userNodes, conversationTitle),
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

      if (node.closest('header, nav, [role="navigation"]')) {
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

  function filterClaudeAssistantNodes(root, userNodes, conversationTitle) {
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
      Array.from(root.querySelectorAll(selector)).filter((node) =>
        isLikelyClaudeAssistantNode(node, root, userNodes, conversationTitle),
      ),
    );
  }

  function extractClaudeAssistantByCopyButtons(root, userNodes, conversationTitle) {
    const controls = Array.from(root.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid]')).filter(
      isClaudeCopyControl,
    );

    const containers = [];
    const seen = new Set();

    controls.forEach((control) => {
      const container = findClaudeAssistantContainerFromAction(control, root, userNodes, conversationTitle);
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

  function findClaudeAssistantContainerFromAction(node, root, userNodes, conversationTitle) {
    let current = node instanceof Element ? node : null;
    let depth = 0;

    while (current && current !== root && current !== document.body && depth < 12) {
      if (isLikelyClaudeAssistantNode(current, root, userNodes, conversationTitle)) {
        return current;
      }

      current = current.parentElement;
      depth += 1;
    }

    return null;
  }

  function isLikelyClaudeAssistantNode(node, root, userNodes, conversationTitle) {
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

    if (isLikelyClaudeWorkspaceDecorationNode(node, conversationTitle)) {
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
    if (window.location.hostname.includes('claude.ai')) {
      pruneClaudeWorkspaceDecorations(clone, getConversationTitle());
    }
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

  function pruneClaudeWorkspaceDecorations(root, title) {
    Array.from(root.querySelectorAll('*')).forEach((element) => {
      if (isLikelyClaudeWorkspaceDecorationNode(element, title)) {
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

  function getRoleLabel(role, bundle) {
    const normalizedRole = normalizeRole(role);
    return ROLE_LABELS[normalizedRole] || ROLE_LABELS.assistant;
  }

  function isLikelyTitleDecorationNode(node, title) {
    if (!(node instanceof Element)) {
      return false;
    }

    const normalizedTitle = normalizeText(title || '');
    const text = normalizeText(node.textContent || '');

    if (!normalizedTitle || !text || text !== normalizedTitle || text.length > 120) {
      return false;
    }

    return !node.querySelector('p, pre, code, table, ul, ol, blockquote');
  }

  function isLikelyClaudeWorkspaceDecorationNode(node, title) {
    if (!(node instanceof Element)) {
      return false;
    }

    const bits = getNodeDetectionBits(node);
    const looksWorkspaceish =
      bits.includes('artifact') ||
      bits.includes('project') ||
      bits.includes('workbench') ||
      bits.includes('canvas') ||
      bits.includes('sidebar') ||
      bits.includes('drawer') ||
      bits.includes('sheet');

    if (!looksWorkspaceish) {
      return false;
    }

    const text = normalizeText(node.textContent || '');
    const normalizedTitle = normalizeText(title || '');
    if (!text) {
      return false;
    }

    if (normalizedTitle && text === normalizedTitle) {
      return true;
    }

    if (text.length > 64 || /[。！？!?：:；;]/.test(text) || text.includes('\n')) {
      return false;
    }

    if (node.querySelector('p, pre, code, table, ul, ol, blockquote')) {
      return false;
    }

    return text.split(/\s+/).filter(Boolean).length <= 8;
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

  function buildAnchorMeta(item) {
    if (!item) {
      return '';
    }

    return formatTimestamp(item.updatedAt || item.savedAt);
  }

  function getExcerptPool() {
    if (!getExcerptPool.cache) {
      const runtimeValue = globalThis[EXCERPT_DATA_KEY];
      getExcerptPool.cache = Array.isArray(runtimeValue)
        ? runtimeValue.map(normalizeExcerptItem).filter(Boolean)
        : [];
    }

    return getExcerptPool.cache;
  }

  function normalizeExcerptItem(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const text = normalizeText(item.text || '');
    if (!text) {
      return null;
    }

    return {
      text,
      book: normalizeExcerptBook(item.book || ''),
      author: normalizeExcerptAuthor(item.author || ''),
    };
  }

  function buildExcerptMeta(item) {
    if (!item) {
      return '';
    }

    return [normalizeText(item.book || ''), normalizeText(item.author || '')].filter(Boolean).join(' · ');
  }

  function normalizeExcerptBook(value) {
    return normalizeText(value).replace(/[《》]/g, '');
  }

  function normalizeExcerptAuthor(value) {
    return normalizeText(value)
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/^[（(][^）)]+[）)]\s*/g, '');
  }

  function pickRandomExcerpt() {
    const pool = getExcerptPool();
    if (!pool.length) {
      return null;
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

  function exportNotes(format, items) {
    const content = format === 'txt' ? buildNotesText(items) : buildNotesMarkdown(items);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadFile(`memo-notes-${stamp}.${format === 'txt' ? 'txt' : 'md'}`, content);
    showToast(`已导出 ${items.length} 条便签。`);
  }

  function buildNotesMarkdown(items) {
    const header = ['# 便签记录', '', `- Exported: ${new Date().toISOString()}`, ''].join('\n');
    const body = items
      .map((item) => {
        const meta = [item.sourceLabel || '', formatTimestamp(item.updatedAt || item.savedAt)].filter(Boolean).join(' · ');
        return `## 便签\n\n- ${meta}\n\n${item.text}`;
      })
      .join('\n\n');
    return `${header}${body}\n`;
  }

  function buildNotesText(items) {
    const header = ['便签记录', `Exported: ${new Date().toISOString()}`, ''].join('\n');
    const body = items
      .map((item) => {
        const meta = [item.sourceLabel || '', formatTimestamp(item.updatedAt || item.savedAt)].filter(Boolean).join(' · ');
        return `[便签] ${meta}\n${item.text}`;
      })
      .join('\n\n');
    return `${header}${body}\n`;
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
        const label = getRoleLabel(message.role, bundle);
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
        const label = getRoleLabel(message.role, bundle);
        return `[${label}]\n${message.text}`;
      })
      .join('\n\n');

    return `${header}${body}\n`;
  }

  function buildFilename(title, extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = sanitizeFilename(title).slice(0, 80) || 'memo-capsule';
    return `${safeTitle}-${getSiteName().toLowerCase()}-${stamp}.${extension}`;
  }

  function sanitizeArchiveTitle(value) {
    return normalizeText(value).slice(0, 80);
  }

  function buildStorageNotice(kind, count, didReplace, prefix) {
    if (didReplace) {
      return `${prefix}已达上限，最早一条${kind}已被替换。`;
    }

    if (count >= STORAGE_WARNING_THRESHOLD) {
      return `${prefix}本地${kind}${count}/${kind === '存档' ? MAX_ARCHIVE_ITEMS : MAX_NOTE_ITEMS} 条，建议导出后清理。`;
    }

    return prefix;
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
              await refreshDrawer(panel, { preferredId: item.id });
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
