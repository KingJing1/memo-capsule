# Memo Capsule

Save, browse, and export chats, notes, quotes, and small pieces of useful context.

## What This Does

`Memo Capsule` is a local-first browser tool for capturing a single AI chat session, browsing it as a memo, and exporting it when needed.

It currently supports:

- saving the current `ChatGPT / Claude / Gemini` conversation as a local archive
- browsing saved context directly inside the page before downloading anything
- exporting archived content as `Markdown` or `TXT`
- using either a `Chrome` extension or a `Tampermonkey` userscript

## Key Features

- `Save-first workflow` — save the current session first, then browse, then export
- `In-page archive` — review complete context without immediately creating local files
- `Memo entry` — collapsed entry can be customized as a personal note, reminder, or short quote
- `Multi-site extraction` — supports `ChatGPT`, `Claude`, and `Gemini`
- `Markdown-first export` — keeps structure, headings, lists, links, and code blocks whenever possible
- `Local-only storage` — archive data stays in browser local storage

## Installation

### Chrome Extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `extension/`

### Tampermonkey

1. Install `Tampermonkey`
2. Create a new script
3. Replace the default template with `chat-export.user.js`
4. Save and refresh the target chat page

## Usage

### Save a session

1. Open the chat page you want to keep
2. Scroll upward a few times so older messages are fully loaded
3. Click the browser action, or open the collapsed memo entry
4. Choose `保存当前`

### Browse and export

1. Open `归档`
2. Review the saved conversation in-page
3. Export as `MD` when you want to preserve structure
4. Export as `TXT` when you only need plain text

## Architecture

- `extension/content.js` — page extraction, local archive storage, UI rendering
- `extension/background.js` — browser action trigger
- `extension/manifest.json` — extension permissions and injection scope
- `chat-export.user.js` — userscript version

The extractor uses a layered approach:

- site-specific selectors first
- generic fallback selectors second
- plain-text fallback last

This keeps the tool usable even when page structure changes across products.

## Philosophy

- A single session is often more valuable than a full account export
- Export should happen after review, not before
- Good capture tools should preserve context, not just raw text
- Local-first storage is the default unless a network feature is explicitly needed
- The interface should feel closer to a reading tool than a utility panel

## Requirements

- `Chrome` for the extension version, or any browser with `Tampermonkey` for the userscript version
- a fully loaded chat page before saving
- manual refresh or selector updates if target sites significantly change their DOM structure

## Credits

- Interaction direction is informed by memo-like archive tools such as `Chat Memo`
- README structure is intentionally aligned with the presentation style commonly used in `zarazhangrui/frontend-slides`

## License

License is not defined yet.
