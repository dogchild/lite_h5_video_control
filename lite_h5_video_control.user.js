// ==UserScript==
// @name         Lite H5 Video Control
// @name:zh-CN   轻量H5视频控制脚本
// @name:zh-TW   轻量H5视频控制脚本
// @namespace    http://tampermonkey.net/
// @version      3.35
// @description  Lite version of video control script. Supports: Seek, Volume, Speed, Fullscreen, OSD, Rotate, Mirror, Mute.
// @description:zh-CN 轻量级HTML5视频控制脚本，支持倍速播放、快进快退、音量控制、全屏、网页全屏、镜像翻转、旋转等功能，带有美观的OSD提示。
// @description:zh-TW 轻量级HTML5视频控制脚本，支持倍速播放、快进快退、音量控制、全屏、网页全屏、镜像翻转、旋转等功能，带有美观的OSD提示。
// @author       Antigravity
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // --- Internationalization (i18n) ---
    const LANG = navigator.language.startsWith('zh') ? 'zh' : 'en';

    const TEXT = {
        en: {
            vol: 'Volume',
            mute: 'Muted',
            unmute: 'Unmuted',
            seekFwd: 'Forward',
            seekBwd: 'Rewind',
            speed: 'Speed',
            mirrorOn: 'Mirror On',
            mirrorOff: 'Mirror Off',
            rotate: 'Rotate',
            webFS: 'Web Fullscreen',
            webFSForced: 'Web Fullscreen (Forced)',
            webFSNative: 'Web Fullscreen (Native)',
            exitWebFS: 'Exit Web Fullscreen',
            exitFS: 'Exit Fullscreen',
            fsAPI: 'Fullscreen (API)',
            tryDblClick: 'Try Double-Click',
            next: 'Playing Next',
            prev: 'Playing Previous',
            nextNotFound: 'Next button not found',
            prevNotFound: 'Previous button not found',
            settingsTitle: 'Lite Video Control Settings',
            menuSettings: 'Settings',
            save: 'Save',
            cancel: 'Cancel',
            saved: 'Settings Saved',
            conflict: 'Conflict detected!',
            conflictMsg: 'Cannot save: Resolve conflicts first',
            keys: {
                seekForward: 'Seek Forward (Small)', seekBackward: 'Seek Backward (Small)',
                seekForwardLarge: 'Seek Forward (Large)', seekBackwardLarge: 'Seek Backward (Large)',
                volUp: 'Volume Up (Small)', volDown: 'Volume Down (Small)',
                volUpLarge: 'Volume Up (Large)', volDownLarge: 'Volume Down (Large)',
                mute: 'Toggle Mute', mirror: 'Toggle Mirror', rotate: 'Rotate 90°',
                speedUp: 'Speed Up', speedDown: 'Speed Down', speedReset: 'Reset Speed',
                fullscreen: 'Native Fullscreen', webFullscreen: 'Web Fullscreen',
                nextVideo: 'Next Video', prevVideo: 'Previous Video',
                speed1: 'Speed 1x', speed2: 'Speed 2x', speed3: 'Speed 3x', speed4: 'Speed 4x'
            }
        },
        zh: {
            vol: '音量',
            mute: '已静音',
            unmute: '已取消静音',
            seekFwd: '快进',
            seekBwd: '快退',
            speed: '倍速',
            mirrorOn: '镜像开启',
            mirrorOff: '镜像关闭',
            rotate: '旋转',
            webFS: '网页全屏',
            webFSForced: '网页全屏 (强制)',
            webFSNative: '网页全屏 (原生)',
            exitWebFS: '退出网页全屏',
            exitFS: '退出全屏',
            fsAPI: '全屏 (API)',
            tryDblClick: '尝试双击',
            next: '播放下一集',
            prev: '播放上一集',
            nextNotFound: '未找到下一集按钮',
            prevNotFound: '未找到上一集按钮',
            settingsTitle: '视频控制脚本设置',
            menuSettings: '设置',
            save: '保存',
            cancel: '取消',
            saved: '设置已保存',
            conflict: '按键冲突!',
            conflictMsg: '无法保存: 请先解决按键冲突',
            keys: {
                seekForward: '快进 (小幅)', seekBackward: '快退 (小幅)',
                seekForwardLarge: '快进 (大幅)', seekBackwardLarge: '快退 (大幅)',
                volUp: '音量增大 (小幅)', volDown: '音量减小 (小幅)',
                volUpLarge: '音量增大 (大幅)', volDownLarge: '音量减小 (大幅)',
                mute: '静音/取消静音', mirror: '镜像翻转', rotate: '旋转 90°',
                speedUp: '加速', speedDown: '减速', speedReset: '重置速度',
                fullscreen: '全屏', webFullscreen: '网页全屏',
                nextVideo: '下一集', prevVideo: '上一集',
                speed1: '1倍速', speed2: '2倍速', speed3: '3倍速', speed4: '4倍速'
            }
        }
    };

    const T = TEXT[LANG];

    // --- Configuration & State ---
    const DEFAULT_CONFIG = {
        seekSmall: 5,
        seekLarge: 30,
        volSmall: 0.05,
        volLarge: 0.20,
        speedStep: 0.1,
        keys: {
            seekForward: 'ArrowRight',
            seekBackward: 'ArrowLeft',
            seekForwardLarge: 'Shift+ArrowRight',
            seekBackwardLarge: 'Shift+ArrowLeft',
            volUp: 'ArrowUp',
            volDown: 'ArrowDown',
            volUpLarge: 'Shift+ArrowUp',
            volDownLarge: 'Shift+ArrowDown',
            mute: 'm',
            mirror: 'Shift+m',
            rotate: 'Shift+r',
            speedUp: 'c',
            speedDown: 'x',
            speedReset: 'z',
            speed1: '1',
            speed2: '2',
            speed3: '3',
            speed4: '4',
            fullscreen: 'Enter',
            webFullscreen: 'Shift+Enter',
            nextVideo: 'Shift+n',
            prevVideo: 'Shift+p'
        }
    };

    /**
     * Settings object backed by Tampermonkey storage.
     */
    let config = GM_getValue('lite_video_config', DEFAULT_CONFIG);

    // --- Config Migration ---
    // Ensure new keys exist in user's config if they upgraded from an older version
    let configChanged = false;
    for (const [key, val] of Object.entries(DEFAULT_CONFIG.keys)) {
        if (!config.keys[key]) {
            config.keys[key] = val;
            configChanged = true;
        }
    }
    if (configChanged) GM_setValue('lite_video_config', config);

    // --- Runtime State ---
    let lastSpeed = 1.0;
    let osdTimer = null;
    const webFullscreenStyleCache = new Map(); // Store original styles for ancestors during Web Fullscreen

    /* 
     * Global CSS Injection
     * Purpose: 
     * 1. Fix Hupu/Generic sites where video containers don't fill the screen in Native Fullscreen.
     * 2. Ensure OSD visibility by handling wrapper layout.
     */
    const style = document.createElement('style');
    style.textContent = `
        /* When a container (section, div) is fullscreened, ensure it and its video fill the screen */
        :fullscreen {
            width: 100vw !important;
            height: 100vh !important;
            max-width: 100vw !important;
            max-height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
            background: black !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            position: relative !important;
        }
        :fullscreen > video {
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
            object-fit: contain !important;
            background: black !important;
        }
        /* Fallback for when video element itself is fullscreen */
        video:fullscreen, video:-webkit-full-screen {
            width: 100vw !important;
            height: 100vh !important;
            object-fit: contain !important;
            background: black !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    /**
     * Show On-Screen Display (OSD) notification.
     * Handles displaying text feedback to the user.
     * Dynamically adjusts mount point and position based on whether the browser is in Fullscreen mode.
     * 
     * @param {string} text - The message to display.
     * @param {HTMLVideoElement} [video] - The video element to anchor OSD to (optional, used for positioning).
     */
    function showOSD(text, video) {
        let osd = document.getElementById('lite-video-osd');

        // Lazy creation of OSD element
        if (!osd) {
            osd = document.createElement('div');
            osd.id = 'lite-video-osd';
            osd.style.cssText = `
                position: absolute;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                font-size: 24px;
                z-index: 2147483647;
                pointer-events: none;
                font-family: sans-serif;
                transition: opacity 0.3s;
                opacity: 0;
                text-shadow: 1px 1px 2px black;
                white-space: nowrap;
                top: 20px;
                left: 20px;
            `;
        }

        // Determine correct mount point to ensure visibility
        let mountPoint = document.body;

        if (document.fullscreenElement) {
            // In native fullscreen, OSD must be INSIDE the fullscreen container to be visible.
            // If the fullscreen element is an iframe or generic container, we append to it.
            // Note: If the fullscreen element is a VIDEO tag (rare with our fix, but possible),
            // appending execution will fail silently or do nothing, which is an accepted limitation.
            mountPoint = document.fullscreenElement;

            // Force Absolute positioning relative to the fullscreen container
            osd.style.position = 'absolute';
            osd.style.top = '20px';
            osd.style.left = '20px';
        } else {
            // In Windowed mode, use Fixed positioning relative to the Viewport
            osd.style.position = 'fixed';

            // Allow positioning OSD relative to the specific video if provided
            if (video) {
                const rect = video.getBoundingClientRect();
                // Ensure it doesn't go off-screen (negative values)
                osd.style.top = Math.max(0, rect.top + 20) + 'px';
                osd.style.left = Math.max(0, rect.left + 20) + 'px';
            } else {
                // Default top-left fallback
                osd.style.top = '20px';
                osd.style.left = '20px';
            }
        }

        // Move OSD to correct mount point if it has changed
        if (osd.parentNode !== mountPoint) {
            mountPoint.appendChild(osd);
        }

        osd.textContent = text;
        osd.style.display = 'block';

        // Trigger reflow to restart CSS transition
        void osd.offsetWidth;
        osd.style.opacity = '1';

        // Clear previous timer to prevent premature hiding
        if (osdTimer) clearTimeout(osdTimer);
        osdTimer = setTimeout(() => {
            osd.style.opacity = '0';
        }, 1500);
    }

    /**
     * Retrieve all video elements from the document, traversing Shadow DOMs.
     * Optimized: Uses iterative TreeWalker to avoid recursion limits and improve performance.
     * 
     * @param {Node} root - The root node to start searching from (default: document).
     * @returns {HTMLVideoElement[]} - Array of found video elements.
     */
    function getAllVideos(root = document) {
        let videos = [];

        // Add videos from current root
        const nodes = root.querySelectorAll('video');
        for (let i = 0; i < nodes.length; i++) {
            videos.push(nodes[i]);
        }

        // Traverse Shadow Roots
        const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
        });

        let node;
        while ((node = treeWalker.nextNode())) {
            // Recursively check Shadow Roots (breadth-first implicit via walker)
            videos = videos.concat(getAllVideos(node.shadowRoot));
        }
        return videos;
    }

    /**
     * Identify the "Active" video to control.
     * Heuristic Priority: 
     * 1. Currently Playing (and visible) - Fastest check.
     * 2. Largest Visible Video in Viewport.
     * 3. First Found Video (Fallback).
     * 
     * @returns {HTMLVideoElement|null}
     */
    function getActiveVideo() {
        const videos = getAllVideos();
        if (videos.length === 0) return null;

        // Optimization: Plays state check is much cheaper than layout geometry.
        // readyState > 2 means HAVE_CURRENT_DATA or HAVE_ENOUGH_DATA (actually playable).
        const playing = videos.find(v => !v.paused && v.style.display !== 'none' && v.readyState > 2);
        if (playing) return playing;

        let bestCandidate = null;
        let maxArea = 0;
        const viewportArea = window.innerWidth * window.innerHeight;

        // Geometry check: Find largest video currently in viewport
        for (let i = 0; i < videos.length; i++) {
            const v = videos[i];
            if (v.style.display === 'none') continue;

            const rect = v.getBoundingClientRect();
            // Skip zero-size elements
            if (rect.width === 0 || rect.height === 0) continue;

            const area = rect.width * rect.height;

            // Check visibility overlap with viewport
            // Simple center-point check is usually sufficient and fast
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const inViewport = (centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight);

            // Favor in-viewport videos; if multiple, pick largest
            if (inViewport && area > maxArea) {
                maxArea = area;
                bestCandidate = v;
            }
        }

        return bestCandidate || videos[0];
    }

    // --- Helper Functions ---

    /**
     * Simulate a mouse click on an element.
     * Dispatches mousedown/mouseup events to satisfy frameworks (React, Vue) that listen to them.
     */
    function simulateClick(element) {
        if (!element) return;
        const outputWindow = element.ownerDocument.defaultView || window;
        const opts = { bubbles: true, cancelable: true, view: outputWindow };
        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.click();
    }

    /**
     * Search for native player buttons using selectors or accessibility labels.
     * Used for Next/Prev/Fullscreen actions.
     * 
     * @param {HTMLElement} wrapper - The container to search within.
     * @param {string[]} selectors - CSS selectors for precise targeting.
     * @param {string[]} keywords - Keywords to match against aria-label/title/text.
     * @returns {HTMLElement|null}
     */
    function findControlBtn(wrapper, selectors, keywords) {
        if (!wrapper) return null;

        // 1. Precise Selector Match
        for (const sel of selectors) {
            const btn = wrapper.querySelector(sel);
            if (btn && btn.offsetParent) return btn; // Must be visible
        }

        // 2. Fuzzy Keyword Match (Fallback)
        if (keywords && keywords.length > 0) {
            const elements = wrapper.querySelectorAll('button, [role="button"], div, span, i');
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                // Skip invisible elements early
                if (!el.offsetParent) continue;

                const attrStr = (el.title || '') + (el.getAttribute('aria-label') || '') + (el.innerText || '');
                const lowerAttr = attrStr.toLowerCase();

                for (const key of keywords) {
                    if (lowerAttr.includes(key)) return el;
                }
            }
        }
        return null;
    }

    // --- Action Handlers ---

    function clickControlBtn(video, actionType) {
        const wrapper = getWrapper(video) || document.body;
        let selectors = [];
        let keywords = [];
        let osdText = '';

        if (actionType === 'next') {
            selectors = ['.ytp-next-button', '.bilibili-player-video-btn-next', '.squirtle-video-next', '[data-e2e="xgplayer-next"]'];
            keywords = ['next', '下一集', '下一个'];
            osdText = T.next;
        } else if (actionType === 'prev') {
            selectors = ['.ytp-prev-button'];
            keywords = ['previous', 'prev', '上一集', '上一个'];
            osdText = T.prev;
        }

        const btn = findControlBtn(wrapper, selectors, keywords);
        if (btn) {
            simulateClick(btn);
            showOSD(osdText, video);
        } else {
            showOSD(actionType === 'next' ? T.nextNotFound : T.prevNotFound, video);
        }
    }

    function adjustSeek(video, delta) {
        if (Number.isFinite(video.duration)) {
            video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + delta));
        } else {
            // For live streams or infinite buffers, just try setting it
            video.currentTime += delta;
        }
        showOSD(`${delta > 0 ? T.seekFwd : T.seekBwd} ${Math.abs(delta)}s`, video);
    }

    function adjustVolume(video, delta) {
        let newVol = Math.min(1, Math.max(0, video.volume + delta));
        video.volume = newVol;
        const volPercent = Math.round(newVol * 100);
        showOSD(`${T.vol} ${volPercent}%`, video);
    }

    function toggleMute(video) {
        video.muted = !video.muted;
        const volPercent = Math.round(video.volume * 100);
        showOSD(video.muted ? T.mute : `${T.vol} ${volPercent}%`, video);
    }

    function adjustSpeed(video, action) {
        if (action === 'reset') {
            // Toggle between 1.0 and last used speed
            if (video.playbackRate === 1) {
                video.playbackRate = lastSpeed === 1 ? config.speedStep + 1 : lastSpeed;
            } else {
                lastSpeed = video.playbackRate;
                video.playbackRate = 1;
            }
        } else if (action === 'up') {
            video.playbackRate += config.speedStep;
        } else if (action === 'down') {
            video.playbackRate = Math.max(0.1, video.playbackRate - config.speedStep);
        } else if (typeof action === 'number') {
            video.playbackRate = action;
        }
        // Round to 1 decimal place to prevent floating point errors (e.g. 1.10000002)
        video.playbackRate = Math.round(video.playbackRate * 10) / 10;
        showOSD(`${T.speed} ${video.playbackRate}x`, video);
    }

    /**
     * Apply CSS Transforms (Rotate & Mirror).
     * Calculates the necessary scale factor to fit the rotated video within its container/viewport.
     */
    function applyTransform(video) {
        const rotate = video._rotateDeg || 0;
        const mirror = video._isMirrored ? -1 : 1;
        let scale = 1;

        // Auto-fit logic for 90/270 degree rotation
        if (rotate % 180 !== 0) {
            const vW = video.offsetWidth || video.videoWidth;
            const vH = video.offsetHeight || video.videoHeight;

            if (vW && vH) {
                let cW, cH;
                // Use viewport size if in fullscreen (Web or Native)
                if (video._isWebFullscreen || document.fullscreenElement) {
                    cW = window.innerWidth;
                    cH = window.innerHeight;
                } else {
                    cW = vW; // Fallback to self-size
                    cH = vH;
                }

                // Fit Logic: when rotated, Video Height becomes visible Width, etc.
                const scaleW = cW / vH;
                const scaleH = cH / vW;
                scale = Math.min(scaleW, scaleH);
            }
        }

        const transformValue = `rotate(${rotate}deg) scaleX(${mirror}) scale(${scale})`;
        video.style.setProperty('transform', transformValue, 'important');
        video.style.setProperty('transform-origin', 'center center', 'important');
    }

    function toggleMirror(video) {
        video._isMirrored = !video._isMirrored;
        applyTransform(video);
        showOSD(video._isMirrored ? T.mirrorOn : T.mirrorOff, video);
    }

    function rotateVideo(video) {
        video._rotateDeg = (video._rotateDeg || 0) + 90;
        if (video._rotateDeg >= 360) video._rotateDeg = 0;
        applyTransform(video);
        showOSD(`${T.rotate} ${video._rotateDeg}°`, video);
    }

    /**
     * Force "Web Fullscreen" Mode.
     * This simulates fullscreen by setting fixed positioning and high z-index on the video.
     * It also iterates up the DOM tree to nuke z-indexes/transforms of ancestors (Stacking Contexts).
     */
    function enableManualWebFullscreen(video) {
        webFullscreenStyleCache.clear();

        // 1. Style Video Element
        video._prevStyle = video.style.cssText;
        video.style.cssText += 'position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; z-index:2147483647 !important; background:black !important; object-fit:contain !important;';

        applyTransform(video);

        // 2. Fix Ancestor Stacking Contexts
        // We must flatten layout contexts so the fixed video isn't clipped or obscured.
        let el = video.parentElement;
        while (el && el !== document.documentElement) {
            const style = window.getComputedStyle(el);
            // Cache original styles
            webFullscreenStyleCache.set(el, {
                transform: el.style.transform,
                zIndex: el.style.zIndex,
                position: el.style.position,
                contain: el.style.contain,
                filter: el.style.filter,
                willChange: el.style.willChange
            });

            // Flatten properties that create stacking contexts
            if (style.transform !== 'none') el.style.setProperty('transform', 'none', 'important');
            if (style.filter !== 'none') el.style.setProperty('filter', 'none', 'important');
            if (style.perspective !== 'none') el.style.setProperty('perspective', 'none', 'important');
            if (style.backdropFilter !== 'none') el.style.setProperty('backdrop-filter', 'none', 'important');
            if (style.willChange !== 'auto') el.style.setProperty('will-change', 'auto', 'important');
            el.style.setProperty('contain', 'none', 'important');
            el.style.setProperty('z-index', '2147483647', 'important');

            if (style.position === 'static') {
                el.style.setProperty('position', 'relative', 'important');
            }

            el = el.parentElement;
        }

        video._isWebFullscreen = true;
        showOSD(T.webFSForced, video);
    }

    function disableManualWebFullscreen(video) {
        // Restore Video Styles
        video.style.cssText = video._prevStyle || '';

        // Restore Ancestor Styles
        for (const [el, styles] of webFullscreenStyleCache) {
            if (styles.transform) el.style.transform = styles.transform; else el.style.removeProperty('transform');
            if (styles.zIndex) el.style.zIndex = styles.zIndex; else el.style.removeProperty('z-index');
            if (styles.position) el.style.position = styles.position; else el.style.removeProperty('position');
            if (styles.contain) el.style.contain = styles.contain; else el.style.removeProperty('contain');
            if (styles.filter) el.style.filter = styles.filter; else el.style.removeProperty('filter');
            if (styles.willChange) el.style.willChange = styles.willChange; else el.style.removeProperty('will-change');
        }
        webFullscreenStyleCache.clear(); // Free memory

        applyTransform(video);
        video._isWebFullscreen = false;
        showOSD(T.exitWebFS, video);
    }

    /**
     * Get the appropriate wrapper element for Fullscreen.
     * Priority: 
     * 1. Known Player Containers (YouTube, Bilibili, etc.)
     * 2. Closest <section> (Robust fallback for generic sites like Hupu)
     * 3. Direct Parent (Last resort)
     */
    function getWrapper(v) {
        const KNOWN_WRAPPERS = [
            '.html5-video-player',       // YouTube / Generic
            '.player-container',         // Generic
            '.video-wrapper',            // Generic
            '.art-video-player',         // ArtPlayer
            '.bilibili-player',          // Bilibili (Old)
            'xg-video-container',        // Douyin / XGPlayer
            '[data-testid="videoPlayer"]'// X (Twitter)
        ];

        for (const selector of KNOWN_WRAPPERS) {
            const w = v.closest(selector);
            if (w) return w;
        }

        // Fallback: Use parent section to ensure OSD visibility and Transform support
        const section = v.closest('section');
        if (section) return section;

        return v.parentElement || v;
    }

    /**
     * Main Fullscreen Toggle Logic.
     */
    function toggleFullscreen(video, mode) {
        const wrapper = getWrapper(video);

        if (mode === 'web') {
            if (video._isWebFullscreen) {
                disableManualWebFullscreen(video);
            } else {
                // Try finding Native "Web Fullscreen" / "Theatre Mode" buttons first
                const webSelectors = [
                    '.bilibili-player-video-btn-web-fullscreen', '.squirtle-video-pagefullscreen',
                    '.ytp-size-button',
                    '[data-a-target="player-theatre-mode-button"]',
                    '.player-fullpage-btn',
                    'xg-icon.xgplayer-page-full-screen', '[data-e2e="xgplayer-page-full-screen"]'
                ];
                // Keywords for fuzzy matching
                const webKeywords = ['web fullscreen', '网页全屏', 'theater', '宽屏'];

                const btn = findControlBtn(document, webSelectors, webKeywords); // Search global because web fs buttons might be outside wrapper
                if (btn) {
                    simulateClick(btn);
                    showOSD(T.webFSNative, video);
                } else {
                    enableManualWebFullscreen(video);
                }
            }
        } else {
            // Native Fullscreen
            if (document.fullscreenElement) {
                if (document.exitFullscreen) document.exitFullscreen();
                showOSD(T.exitFS, video);
            } else {
                // 1. Try Known Native Buttons
                const nativeSelectors = [
                    '.ytp-fullscreen-button',
                    '.bilibili-player-video-btn-fullscreen', '.squirtle-video-fullscreen',
                    '[data-a-target="player-fullscreen-button"]',
                    '.player-fullscreen-btn',
                    '.xgplayer-fullscreen', '[data-e2e="xgplayer-fullscreen"]',
                    '.vjs-fullscreen-control',
                    '[data-testid="videoPlayer"] [aria-label="全屏"]', '[data-testid="videoPlayer"] [aria-label="Fullscreen"]'
                ];
                const nativeKeywords = ['fullscreen', '全屏', 'full-screen'];

                const searchRoot = (wrapper === video) ? document : wrapper;
                const btn = findControlBtn(searchRoot, nativeSelectors, nativeKeywords);

                if (btn) {
                    simulateClick(btn);
                } else {
                    // 2. Double Click Fallback (Whitelist)
                    const host = window.location.hostname;
                    const whitelist = ['bilibili.com', 'youtube.com', 'twitch.tv'];
                    if (whitelist.some(site => host.includes(site))) {
                        video.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                        showOSD(T.tryDblClick, video);
                    } else {
                        // 3. API Force Fallback
                        const target = wrapper || video;
                        if (target.requestFullscreen) target.requestFullscreen();
                        else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
                        else if (video.requestFullscreen) video.requestFullscreen();

                        showOSD(T.fsAPI, video);
                    }
                }
            }
        }
    }

    // --- Settings UI ---
    function createSettingsUI() {
        if (document.getElementById('lite-video-settings')) return;

        const container = document.createElement('div');
        container.id = 'lite-video-settings';
        container.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: #222; color: #eee; padding: 20px; border-radius: 8px;
            z-index: 2147483647; box-shadow: 0 0 15px rgba(0,0,0,0.5);
            font-family: sans-serif; min-width: 500px; max-height: 80vh; overflow-y: auto;
        `;

        const title = document.createElement('h3');
        title.textContent = T.settingsTitle;
        title.style.marginTop = '0';
        container.appendChild(title);

        const form = document.createElement('div');
        form.style.display = 'grid'; form.style.gridTemplateColumns = '1fr 1fr'; form.style.gap = '10px';

        const descriptions = T.keys;

        const inputs = [];

        // Conflict Checking Logic (Allocated only when UI is open)
        const checkConflicts = () => {
            const keyMap = new Map();
            const conflicts = new Set();

            inputs.forEach(input => {
                const k = input.value.toLowerCase();
                if (!keyMap.has(k)) keyMap.set(k, []);
                keyMap.get(k).push(input);
            });

            for (const [k, list] of keyMap) {
                if (list.length > 1) {
                    list.forEach(input => conflicts.add(input));
                }
            }

            inputs.forEach(input => {
                if (conflicts.has(input)) {
                    input.style.border = '1px solid #ff4444';
                    input.style.backgroundColor = '#3e1111';
                    input.title = T.conflict;
                } else {
                    input.style.border = '1px solid #555';
                    input.style.backgroundColor = '#333';
                    input.title = '';
                }
            });

            return conflicts.size > 0;
        };

        Object.entries(descriptions).forEach(([key, desc]) => {
            // Skip config keys irrelevant to UI if any

            const label = document.createElement('label');
            label.textContent = desc;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = config.keys[key] || '';
            input.style.cssText = 'width: 100%; background: #333; color: white; border: 1px solid #555; padding: 5px; box-sizing: border-box;';
            input.dataset.key = key;

            input.addEventListener('keydown', (e) => {
                e.preventDefault();
                let keyStr = '';
                if (e.shiftKey) keyStr += 'Shift+';
                if (e.ctrlKey) keyStr += 'Ctrl+';
                if (e.altKey) keyStr += 'Alt+';
                let k = e.key;
                if (k === ' ') k = 'Space';
                if (['Shift', 'Control', 'Alt'].includes(k)) return;

                keyStr += k.length === 1 ? k.toLowerCase() : k;
                input.value = keyStr;

                checkConflicts();
            });

            const div = document.createElement('div');
            div.appendChild(label);
            div.appendChild(input);
            form.appendChild(div);
            inputs.push(input);
        });

        container.appendChild(form);

        // Initial check
        checkConflicts();

        // Footer Buttons
        const btnRow = document.createElement('div');
        btnRow.style.marginTop = '20px';
        btnRow.style.textAlign = 'right';
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'space-between';
        btnRow.style.alignItems = 'center';

        const msgSpan = document.createElement('span');
        msgSpan.style.color = '#ff4444';
        msgSpan.style.fontSize = '12px';
        btnRow.appendChild(msgSpan);

        const btns = document.createElement('div');

        const saveBtn = document.createElement('button');
        saveBtn.textContent = T.save;
        saveBtn.style.cssText = 'padding: 8px 16px; background: #4CAF50; color: white; border: none; cursor: pointer; border-radius: 4px;';
        saveBtn.onclick = () => {
            const hasConflict = checkConflicts();
            if (hasConflict) {
                msgSpan.textContent = 'Cannot save: Resolve conflicts first';
                container.animate([
                    { transform: 'translate(-50%, -50%) translateX(0)' },
                    { transform: 'translate(-50%, -50%) translateX(-5px)' },
                    { transform: 'translate(-50%, -50%) translateX(5px)' },
                    { transform: 'translate(-50%, -50%) translateX(0)' }
                ], { duration: 200 });
                return;
            }

            const newKeys = { ...config.keys };
            inputs.forEach(i => newKeys[i.dataset.key] = i.value);
            config.keys = newKeys;
            GM_setValue('lite_video_config', config);
            document.body.removeChild(container);
            showOSD(T.saved);
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = T.cancel;
        cancelBtn.style.cssText = 'padding: 8px 16px; background: #666; color: white; border: none; margin-right: 10px; cursor: pointer; border-radius: 4px;';
        cancelBtn.onclick = () => document.body.removeChild(container);

        btns.appendChild(cancelBtn);
        btns.appendChild(saveBtn);
        btnRow.appendChild(btns);

        container.appendChild(btnRow);
        document.body.appendChild(container);
    }

    // --- Global Keyboard Event Listener ---
    document.addEventListener('keydown', (e) => {
        // Prevent triggering controls when typing in input fields
        const tag = document.activeElement.tagName;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement.isContentEditable) {
            return;
        }

        // Build Key String
        let keyStr = '';
        if (e.shiftKey) keyStr += 'Shift+';
        if (e.ctrlKey) keyStr += 'Ctrl+';
        if (e.metaKey) keyStr += 'Meta+';
        if (e.altKey) keyStr += 'Alt+';

        let k = e.key;
        if (k === ' ') k = 'Space';
        if (k.length === 1) k = k.toLowerCase(); // Case insensitive for single letters

        keyStr += k;

        // Match Key to Action
        // Use loop to find action since config.keys is an object
        const actionEntry = Object.entries(config.keys).find(([_, val]) => val.toLowerCase() === keyStr.toLowerCase());

        if (actionEntry) {
            const video = getActiveVideo();
            if (!video) return;

            // Stop browser default handling for these shortcuts
            e.preventDefault();
            e.stopPropagation();

            const action = actionEntry[0];
            switch (action) {
                case 'seekForward': adjustSeek(video, config.seekSmall); break;
                case 'seekBackward': adjustSeek(video, -config.seekSmall); break;
                case 'seekForwardLarge': adjustSeek(video, config.seekLarge); break;
                case 'seekBackwardLarge': adjustSeek(video, -config.seekLarge); break;
                case 'volUp': adjustVolume(video, config.volSmall); break;
                case 'volDown': adjustVolume(video, -config.volSmall); break;
                case 'volUpLarge': adjustVolume(video, config.volLarge); break;
                case 'volDownLarge': adjustVolume(video, -config.volLarge); break;
                case 'mute': toggleMute(video); break;
                case 'speedUp': adjustSpeed(video, 'up'); break;
                case 'speedDown': adjustSpeed(video, 'down'); break;
                case 'speedReset': adjustSpeed(video, 'reset'); break;
                case 'speed1': adjustSpeed(video, 1.0); break;
                case 'speed2': adjustSpeed(video, 2.0); break;
                case 'speed3': adjustSpeed(video, 3.0); break;
                case 'speed4': adjustSpeed(video, 4.0); break;
                case 'fullscreen': toggleFullscreen(video, 'native'); break;
                case 'webFullscreen': toggleFullscreen(video, 'web'); break;
                case 'rotate': rotateVideo(video); break;
                case 'mirror': toggleMirror(video); break;
                case 'nextVideo': clickControlBtn(video, 'next'); break;
                case 'prevVideo': clickControlBtn(video, 'prev'); break;
            }
        }
    }, { capture: true }); // Capture phase to override site events

    // Register Menu
    GM_registerMenuCommand(T.menuSettings, createSettingsUI);

})();
