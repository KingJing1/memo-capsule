// ==UserScript==
// @name         AI Chat Session Exporter
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
  const TOAST_ID = 'tm-chat-export-toast';
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

  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <button type="button" data-format="md" title="导出当前对话为 Markdown">导出 MD</button>
      <button type="button" data-format="txt" title="导出当前对话为纯文本">导出 TXT</button>
    `;

    Object.assign(panel.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      zIndex: '2147483647',
      display: 'flex',
      gap: '8px',
      padding: '10px',
      borderRadius: '14px',
      background: 'rgba(17, 24, 39, 0.92)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.26)',
      backdropFilter: 'blur(10px)',
    });

    Array.from(panel.querySelectorAll('button')).forEach((button) => {
      Object.assign(button.style, {
        border: '0',
        borderRadius: '10px',
        padding: '10px 12px',
        color: '#f9fafb',
        background: button.dataset.format === 'md' ? '#2563eb' : '#374151',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
        whiteSpace: 'nowrap',
      });

      button.addEventListener('click', async () => {
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = '导出中...';

        try {
          const bundle = collectConversation();
          const content = button.dataset.format === 'md'
            ? buildMarkdown(bundle)
            : buildText(bundle);

          if (!content.trim()) {
            throw new Error('未提取到内容，请先滚动加载完整对话后重试。');
          }

          const filename = buildFilename(bundle.title, button.dataset.format);
          downloadFile(filename, content);
          showToast(`已导出 ${filename}`);
        } catch (error) {
          showToast(error.message || '导出失败，请稍后重试。', true);
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }
      });
    });

    document.body.appendChild(panel);
  }

  function showToast(message, isError) {
    let toast = document.getElementById(TOAST_ID);

    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      Object.assign(toast.style, {
        position: 'fixed',
        right: '18px',
        bottom: '82px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '10px 12px',
        borderRadius: '12px',
        color: '#f9fafb',
        background: 'rgba(17, 24, 39, 0.92)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.22)',
        fontSize: '13px',
        lineHeight: '1.4',
      });
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background = isError ? 'rgba(153, 27, 27, 0.94)' : 'rgba(17, 24, 39, 0.92)';
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
      const fallbackText = normalizeText(root.innerText || '');
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

  function ensureMounted() {
    if (!document.body) {
      return;
    }

    createPanel();
  }

  ensureMounted();

  const observer = new MutationObserver(() => {
    if (!document.getElementById(PANEL_ID)) {
      createPanel();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
