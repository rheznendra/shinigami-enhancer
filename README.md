# Shinigami Enhancer

Userscript for [Shinigami](https://s1.shinigami.mx) to enhance experience while reading.

---

## Supported Sites

- [`s1.shinigami.mx`](https://s1.shinigami.mx/)

---

## Features

- ~~Bypass/skip annoying pop-up.~~ (Removed, no longer needed)
- Always open new tab on each card on `https://s1.shinigami.mx/series/*` Page.
- Always show scrollbar while reading Series.
- Pull to refresh on Mobile.
- Press left/right arrow key to go prev/next chapter.
- Back to top button on bottom right.
- Home button on top bar (hide the current build-in on the bottom) 
- Hide top/bottom navigation bar when you reading `/chapter/*` (Click the screen to show the navigation bar again).
- Scroll to bottom page (upvote section) when you reading.

---

## Prerequisites

Install the **Violentmonkey** browser extension for your browser:

- **Chrome / Chromium (Brave, Edge, Vivaldi, Opera):** [Violentmonkey on Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
- **Firefox:** [Violentmonkey on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)

> **Chromium Note (Chrome / Edge / Brave):** Make sure **Allow User Scripts** (or **Developer Mode**) is enabled in `chrome://extensions` under Violentmonkey's **Details** page so userscripts can execute properly.

---

## Installation

1. Ensure **Violentmonkey** is installed and enabled in your browser.
2. Click the button below to install the script automatically:

    [![Install Script](https://img.shields.io/badge/Install-Click_Here-success?style=for-the-badge&logo=tampermonkey)](https://github.com/rheznendra/shinigami-enhancer/raw/main/script.user.js)

    _(If the button doesn't work, [click here](https://github.com/rheznendra/shinigami-enhancer/raw/main/script.user.js) to view the raw code, and your extension should prompt you to install it.)_

---

### Manual Installation

1. Copy full content of [script.user.js](https://github.com/rheznendra/shinigami-enhancer/blob/main/script.user.js) from this repository.
2. Click the Userscript Manager extension icon in your browser.
3. Press the + icon to add new userscript.
4. Paste the full script in the editor and hit **Save** (CTRL+S).

---

## License

MIT
