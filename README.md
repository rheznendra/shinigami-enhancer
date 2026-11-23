# Shinigami Enhancer

Userscript for [Shinigami](https://s1.shinigami.mx) to enhance experience while reading.

---

## Supported Sites

- [`s1.shinigami.mx`](https://s1.shinigami.mx/)

---

## Features

- ~~Bypass/skip annoying pop-up.~~ (Removed, no longer needed)
- Chapter Card as Link on Series. (On by default)
    - Always open new as new tab. (optional, On by default)
- Always show scrollbar while reading Series. (On by default)
- Pull to refresh on Mobile. (On by default)
- Press left/right arrow key on Keyboard to go prev/next chapter. (On by default)
- Back to top button on bottom right. (On by default)
- Home button on top bar (hide the current build-in on the bottom). (On by default)
- Hide top/bottom navigation bar when you reading `/chapter/*` (Click the screen to show the navigation bar again). (On by default)
- Scroll to bottom page (upvote section) when you reading. (On by default)
- Hide premium upselling: `Premium link on top navbar`, `Upgrade button on dropdown profile menu`, `Premium link on footer`, `Premium banner on profile page`. (On by default)
    - Also hide premium chat. (optional, On by default)
- Auto upvote when opening chapter. (Off by default)
- Chapter button at Home as Link (On by default)
    - Always open as new tab (optional, Off by default)
- Bottom comment section (On by default)


> To buy **Premium** when you enabled `Hide premium upselling`, open `Profile Menu (Top Right)` > `Pengaturan` > `Pembayaran`, or open [https://s1.shinigami.mx/premium](https://s1.shinigami.mx/premium)

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
