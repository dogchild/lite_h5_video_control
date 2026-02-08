# Lite H5 Video Control

A lightweight HTML5 video control userscript. Supports almost all HTML5 video websites (YouTube, Bilibili, Twitch, etc.).

Provides functionalities like playback speed control, seek, volume control, fullscreen, web fullscreen, mirroring, rotation, and a beautiful OSD (On-Screen Display).

## ✨ Features

*   **Lightweight**: Clean code, no dependencies, optimized performance.
*   **Universal Support**: Works on most HTML5 video sites.
*   **Custom Shortcuts**: Fully customizable keyboard shortcuts.
*   **OSD**: Elegant on-screen display feedback.
*   **Advanced Controls**:
    *   **Speed Control**: Precise adjustment, reset support.
    *   **Rotation**: Rotate video 90° (Fixed for native fullscreen).
    *   **Mirroring**: Horizontal flip (Great for dance tutorials).
    *   **Web Fullscreen**: Force any video into browser window fullscreen.
    *   **Next/Prev**: Support for playlists on YouTube, Bilibili, etc.
*   **Settings UI**: GUI for managing shortcuts with conflict detection.
*   **Bilingual**: Auto-detects English/Chinese based on browser language.

## ⌨️ Default Shortcuts

| Action | Shortcut | Description |
| :--- | :--- | :--- |
| **Seek Fwd** | `→` (Right) | Forward 5s |
| **Seek Bwd** | `←` (Left) | Rewind 5s |
| **Seek Fwd (L)** | `Shift + →` | Forward 30s |
| **Seek Bwd (L)** | `Shift + ←` | Rewind 30s |
| **Volume +** | `↑` (Up) | Volume +5% |
| **Volume -** | `↓` (Down) | Volume -5% |
| **Volume + (L)** | `Shift + ↑` | Volume +20% |
| **Volume - (L)** | `Shift + ↓` | Volume -20% |
| **Mute** | `M` | Toggle Mute |
| **Speed +** | `C` | Speed +0.1x |
| **Speed -** | `X` | Speed -0.1x |
| **Reset Speed** | `Z` | Reset to 1.0x |
| **Set Speed** | `1` / `2` / `3` / `4` | Set to 1x / 2x / 3x / 4x |
| **Fullscreen** | `Enter` | Toggle Native Fullscreen |
| **Web Fullscreen** | `Shift + Enter` | Toggle Web Fullscreen |
| **Next Video** | `Shift + N` | Play Next Video |
| **Prev Video** | `Shift + P` | Play Previous Video |
| **Mirror** | `Shift + M` | Toggle Mirror |
| **Rotate** | `Shift + R` | Rotate 90° |
| **Settings** | (Menu) | "Settings" in Tampermonkey Menu |

## 🛠️ Installation

1.  Install the [Tampermonkey](https://www.tampermonkey.net/) extension.
2.  Install this script (Replace with your link) or copy the code from `lite_h5_video_control.user.js`.
3.  Open any video website to use.

## ⚙️ Configuration

Click the Tampermonkey icon in your browser, find "Lite Video Control", and click "Settings" to open the configuration panel.

*   Customize all shortcuts.
*   Conflict detection prevents duplicate keys.

## 🐞 FAQ

**Q: Shortcuts not working?**
A: Ensure you are not typing in a text box. Some sites might block events; try clicking the video player once to focus it.

**Q: OSD not visible in Fullscreen?**
A: The script creates OSD elements inside the fullscreen container to ensure visibility. If issues persist, try "Web Fullscreen" (`Shift+Enter`).

## 📜 License

MIT License
