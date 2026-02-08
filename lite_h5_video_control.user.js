// ==UserScript==
// @name         Lite Video Control
// @namespace    http://tampermonkey.net/
// @version      3.33
// @description  Lite version of video control script. Supports: Seek, Volume, Speed, Fullscreen, OSD, Rotate, Mirror, Mute.
// @author       Antigravity
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

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
    let webFullscreenStyleCache = new Map(); // Store original styles for ancestors

    /* 
     * Global CSS Injection
     * Purpose: 
     * 1. Fix Hupu/Generic sites where video doesn't fill the screen in Native Fullscreen.
     * 2. Force 'video:fullscreen' to block-level and 100% size to override inline/margin styles.
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
        /* Fallback for when video element itself is fullscreen (shouldn't happen after this fix) */
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
     * Mounts OSD inside fullscreenElement when in native fullscreen to ensure visibility.
     */
    function showOSD(text, video) {
        let osd = document.getElementById('lite-video-osd');

        // Lazy creation
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

        // Determine correct mount point
        let mountPoint = document.body;
        if (document.fullscreenElement) {
            // In native fullscreen, OSD must be INSIDE the fullscreen container to be visible.
            mountPoint = document.fullscreenElement;
            osd.style.position = 'absolute'; // Absolute within the fullscreen container
            osd.style.top = '20px';
            osd.style.left = '20px';
        } else {
            osd.style.position = 'fixed'; // Fixed relative to viewport
            // Position relative to video if available
            if (video) {
                const rect = video.getBoundingClientRect();
                osd.style.top = Math.max(0, rect.top + 20) + 'px';
                osd.style.left = Math.max(0, rect.left + 20) + 'px';
            } else {
                osd.style.top = '20px';
                osd.style.left = '20px';
            }
        }

        // Move OSD to correct mount point if needed
        if (osd.parentNode !== mountPoint) {
            mountPoint.appendChild(osd);
        }

        osd.textContent = text;
        osd.style.display = 'block';

        // Trigger reflow for transition
        void osd.offsetWidth;
        osd.style.opacity = '1';

        if (osdTimer) clearTimeout(osdTimer);
        osdTimer = setTimeout(() => {
            osd.style.opacity = '0';
        }, 1500);
    }

    /**
     * Retrieve all video elements from root and Shadow DOMs.
     * Uses TreeWalker for efficient traversal.
     * @param {Node} root 
     * @returns {HTMLVideoElement[]}
     */
    function getAllVideos(root = document) {
        let videos = Array.from(root.querySelectorAll('video'));

        const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
        });

        let node;
        while ((node = treeWalker.nextNode())) {
            videos = videos.concat(getAllVideos(node.shadowRoot));
        }
        return videos;
    }

    /**
     * Identify the "Active" video to control.
     * Priority: 
     * 1. Currently Playing (and visible)
     * 2. Largest Visible
     * 3. First Found
     * @returns {HTMLVideoElement|null}
     */
    function getActiveVideo() {
        const videos = getAllVideos();
        if (videos.length === 0) return null;

        // Optimization: Check playing status first (fastest heuristic)
        // readyState > 2 means HAVE_CURRENT_DATA or HAVE_ENOUGH_DATA
        const playing = videos.find(v => !v.paused && v.style.display !== 'none' && v.readyState > 2);
        if (playing) return playing;

        let bestCandidate = null;
        let maxArea = 0;

        // We only check viewport if no video is playing
        videos.forEach(v => {
            if (v.style.display === 'none') return;

            const rect = v.getBoundingClientRect();
            // Basic visibility check
            if (rect.width === 0 || rect.height === 0) return;

            const area = rect.width * rect.height;
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Check if center is in viewport
            const inViewport = (centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight);

            if (area > maxArea && inViewport) {
                maxArea = area;
                bestCandidate = v;
            }
        });

        return bestCandidate || videos[0];
    }

    // --- Action Handlers ---

    function playNextVideo(video) {
        // Try to find a player wrapper first to scope the search
        const wrapper = video.closest('.html5-video-player')
            || video.closest('.player-container')
            || video.closest('.video-wrapper')
            || video.closest('.bilibili-player')
            || video.closest('[data-testid="videoPlayer"]') // X
            || document.body;

        const selectors = [
            '.ytp-next-button', // YouTube
            '.bilibili-player-video-btn-next', '.squirtle-video-next', // Bilibili
            '[data-e2e="xgplayer-next"]', // Douyin/XG
            '[aria-label*="Next"]', '[aria-label*="下一集"]', '[aria-label*="下一个"]',
            '[title*="Next"]', '[title*="下一集"]'
        ];

        for (const sel of selectors) {
            const btn = wrapper.querySelector(sel);
            if (btn && btn.offsetParent) { // Check visibility
                simulateClick(btn);
                showOSD('Playing Next', video);
                return;
            }
        }
        showOSD('Next button not found', video);
    }

    function playPrevVideo(video) {
        const wrapper = video.closest('.html5-video-player')
            || video.closest('.player-container')
            || video.closest('.video-wrapper')
            || video.closest('.bilibili-player')
            || document.body;

        const selectors = [
            '.ytp-prev-button', // YouTube
            '[aria-label*="Previous"]', '[aria-label*="Prev"]', '[aria-label*="上一集"]', '[aria-label*="上一个"]',
            '[title*="Previous"]', '[title*="Prev"]', '[title*="上一集"]'
        ];

        for (const sel of selectors) {
            const btn = wrapper.querySelector(sel);
            if (btn && btn.offsetParent) {
                simulateClick(btn);
                showOSD('Playing Previous', video);
                return;
            }
        }
        showOSD('Previous button not found', video);
    }

    function adjustSeek(video, delta) {
        video.currentTime += delta;
        showOSD(`${delta > 0 ? 'Forward' : 'Rewind'} ${Math.abs(delta)}s`, video);
    }

    function adjustVolume(video, delta) {
        let newVol = Math.min(1, Math.max(0, video.volume + delta));
        video.volume = newVol;
        showOSD(`Volume ${Math.round(newVol * 100)}%`, video);
    }

    function toggleMute(video) {
        video.muted = !video.muted;
        const volPercent = Math.round(video.volume * 100);
        showOSD(video.muted ? 'Muted' : `Volume ${volPercent}%`, video);
    }

    function adjustSpeed(video, action) {
        if (action === 'reset') {
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
        // Round to 1 decimal place to avoid floating point ugliness
        video.playbackRate = Math.round(video.playbackRate * 10) / 10;
        showOSD(`Speed ${video.playbackRate}x`, video);
    }

    /**
     * Applies transform styles (Rotate & Mirror).
     * Calculates scale to fit rotated video within container.
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
                // Use viewport size if in fullscreen
                if (video._isWebFullscreen || document.fullscreenElement) {
                    cW = window.innerWidth;
                    cH = window.innerHeight;
                } else {
                    cW = vW; // Basic fallback to self-size if inline
                    cH = vH;
                }

                // Fit Logic: when rotated, H becomes W.
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
        showOSD(video._isMirrored ? 'Mirror On' : 'Mirror Off', video);
    }

    function rotateVideo(video) {
        video._rotateDeg = (video._rotateDeg || 0) + 90;
        if (video._rotateDeg >= 360) video._rotateDeg = 0;
        applyTransform(video);
        showOSD(`Rotate ${video._rotateDeg}°`, video);
    }

    /**
     * Force "Web Fullscreen" (CSS-based).
     * Useful when Native Fullscreen is blocked or undesired.
     */
    function enableManualWebFullscreen(video) {
        webFullscreenStyleCache.clear();

        // 1. Fix Video Element styling
        video._prevStyle = video.style.cssText;
        video.style.cssText += 'position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; z-index:2147483647 !important; background:black !important; object-fit:contain !important;';

        applyTransform(video); // Re-apply transforms

        // 2. Iterate ancestors to fix Stacking Contexts and Z-Index
        let el = video.parentElement;
        while (el && el !== document.documentElement) {
            const style = window.getComputedStyle(el);
            webFullscreenStyleCache.set(el, {
                transform: el.style.transform,
                zIndex: el.style.zIndex,
                position: el.style.position,
                contain: el.style.contain,
                filter: el.style.filter,
                willChange: el.style.willChange
            });

            // Flatten stacking context creators
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
        showOSD('Web Fullscreen (Forced)', video);
    }

    function disableManualWebFullscreen(video) {
        // Restore Video Styles
        video.style.cssText = video._prevStyle || '';

        // Restore Ancestor Styles
        for (const [el, styles] of webFullscreenStyleCache) {
            el.style.transform = styles.transform;
            el.style.zIndex = styles.zIndex;
            el.style.position = styles.position;
            el.style.contain = styles.contain;
            el.style.filter = styles.filter;
            el.style.willChange = styles.willChange;
        }
        webFullscreenStyleCache.clear(); // Clear cache to prevent memory leaks

        applyTransform(video);
        video._isWebFullscreen = false;
        showOSD('Exit Web Fullscreen', video);
    }

    /**
     * Helper to simulate a real user click.
     * Needed for frameworks (React/Vue) that track event history.
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
     * Fuzzy search for native buttons (Fallback).
     */
    function findNativeButton(root, keywords) {
        if (!root) return null;
        const candidates = [];
        const elements = root.querySelectorAll('*');

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName)) continue;

            let score = 0;
            const attrStr = (el.className || '') + (el.id || '') + (el.getAttribute('title') || '') + (el.getAttribute('aria-label') || '');
            const lowerAttr = attrStr.toLowerCase();

            for (const key of keywords) {
                if (lowerAttr.includes(key)) {
                    score += 10;
                    if (el.tagName === 'BUTTON' || el.onclick || el.getAttribute('role') === 'button') score += 5;
                }
            }
            if (score > 0) candidates.push({ el, score });
        }
        candidates.sort((a, b) => b.score - a.score);
        return candidates.length > 0 ? candidates[0].el : null;
    }

    /**
     * Main Fullscreen Toggle Logic.
     * Handles complex site-specific behaviors (Bilibili, YouTube, Hupu, X, etc.)
     */
    function toggleFullscreen(video, mode) {
        // Known Wrappers Map for Specific Sites
        // These containers handle the player UI and layout correctly.
        const KNOWN_WRAPPERS = [
            '.html5-video-player',       // YouTube / Generic
            '.player-container',         // Generic
            '.video-wrapper',            // Generic
            '.art-video-player',         // ArtPlayer
            '.bilibili-player',          // Bilibili (Old)
            'xg-video-container',        // Douyin / XGPlayer
            '[data-testid="videoPlayer"]'// X (Twitter)
        ];

        // wrapper finding strategy
        const getWrapper = (v) => {
            for (const selector of KNOWN_WRAPPERS) {
                const w = v.closest(selector);
                if (w) return w;
            }
            // Fallback: Use parent section or direct parent.
            // This allows OSD to be appended and transforms to work in native fullscreen.
            const section = v.closest('section');
            if (section) return section;

            // Last resort: Use direct parent element.
            // We never want to fullscreen the VIDEO directly because:
            // 1. OSD cannot be shown on top of it.
            // 2. CSS transforms are ignored by the browser's hardware-accelerated fullscreen path.
            return v.parentElement || v;
        };

        const wrapper = getWrapper(video);

        if (mode === 'web') {
            if (video._isWebFullscreen) {
                disableManualWebFullscreen(video);
            } else {
                // Try finding Native "Web Fullscreen" buttons first
                const webSelectors = [
                    '.bilibili-player-video-btn-web-fullscreen', '.squirtle-video-pagefullscreen', // Bilibili
                    '.ytp-size-button', // YouTube
                    '[data-a-target="player-theatre-mode-button"]', // Twitch
                    '.player-fullpage-btn', // Huya
                    'xg-icon.xgplayer-page-full-screen', '[data-e2e="xgplayer-page-full-screen"]', // Douyin
                    '[aria-label*="Web Fullscreen"]', '[aria-label*="网页全屏"]', '[aria-label*="Theater"]' // Generic
                ];

                let btnClicked = false;
                for (const sel of webSelectors) {
                    const btn = document.querySelector(sel); // Global search is safer for Web FS
                    if (btn && btn.offsetParent) {
                        simulateClick(btn);
                        btnClicked = true;
                        showOSD('Web Fullscreen (Native)', video);
                        break;
                    }
                }

                if (!btnClicked) enableManualWebFullscreen(video);
            }
        } else {
            // Native Fullscreen
            if (document.fullscreenElement) {
                if (document.exitFullscreen) document.exitFullscreen();
                showOSD('Exit Fullscreen', video);
            } else {
                let btnClicked = false;

                // 1. Try Known Native Buttons
                const nativeSelectors = [
                    '.ytp-fullscreen-button', // YouTube
                    '.bilibili-player-video-btn-fullscreen', '.squirtle-video-fullscreen', // Bilibili
                    '[data-a-target="player-fullscreen-button"]', // Twitch
                    '.player-fullscreen-btn', // Huya
                    '.xgplayer-fullscreen', '[data-e2e="xgplayer-fullscreen"]', // Douyin
                    '.vjs-fullscreen-control', // VideoJS
                    '[data-testid="videoPlayer"] [aria-label="全屏"]', '[data-testid="videoPlayer"] [aria-label="Fullscreen"]' // X
                ];

                const searchRoot = (wrapper === video) ? document : wrapper;

                for (const sel of nativeSelectors) {
                    const btn = searchRoot.querySelector(sel);
                    if (btn && btn.offsetParent) {
                        simulateClick(btn);
                        btnClicked = true;
                        break;
                    }
                }

                // 2. Fuzzy Search Fallback
                if (!btnClicked && wrapper !== video) {
                    const fuzzyBtn = findNativeButton(wrapper, ['fullscreen', '全屏', 'full-screen']);
                    if (fuzzyBtn) {
                        simulateClick(fuzzyBtn);
                        btnClicked = true;
                    }
                }

                // 3. Double Click Fallback (Whitelist)
                if (!btnClicked) {
                    const host = window.location.hostname;
                    const whitelist = ['bilibili.com', 'youtube.com', 'twitch.tv'];
                    if (whitelist.some(site => host.includes(site))) {
                        video.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                        showOSD('Try Double-Click', video);
                    }
                }

                // 4. API Force Fallback
                if (!btnClicked) {
                    // If wrapper is valid (known player), use it. Else use video.
                    const target = wrapper || video;
                    if (target.requestFullscreen) target.requestFullscreen();
                    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
                    else if (video.requestFullscreen) video.requestFullscreen();

                    showOSD('Fullscreen (API)', video);
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
        title.textContent = 'Lite Video Control Settings';
        title.style.marginTop = '0';
        container.appendChild(title);

        const form = document.createElement('div');
        form.style.display = 'grid'; form.style.gridTemplateColumns = '1fr 1fr'; form.style.gap = '10px';

        const descriptions = {
            seekForward: 'Seek Forward (Small)', seekBackward: 'Seek Backward (Small)',
            seekForwardLarge: 'Seek Forward (Large)', seekBackwardLarge: 'Seek Backward (Large)',
            volUp: 'Volume Up (Small)', volDown: 'Volume Down (Small)',
            volUpLarge: 'Volume Up (Large)', volDownLarge: 'Volume Down (Large)',
            mute: 'Toggle Mute', mirror: 'Toggle Mirror', rotate: 'Rotate 90°',
            speedUp: 'Speed Up', speedDown: 'Speed Down', speedReset: 'Reset Speed',
            fullscreen: 'Native Fullscreen', webFullscreen: 'Web Fullscreen',
            nextVideo: 'Next Video', prevVideo: 'Previous Video',
            speed1: 'Speed 1x', speed2: 'Speed 2x', speed3: 'Speed 3x', speed4: 'Speed 4x'
        };

        const inputs = [];

        // Conflict Checking Logic (Only active when Settings UI is open)
        const checkConflicts = () => {
            const keyMap = new Map();
            const conflicts = new Set();

            // 1. Map keys to inputs
            inputs.forEach(input => {
                const k = input.value.toLowerCase();
                if (!keyMap.has(k)) keyMap.set(k, []);
                keyMap.get(k).push(input);
            });

            // 2. Identify conflicts
            for (const [k, list] of keyMap) {
                if (list.length > 1) {
                    list.forEach(input => conflicts.add(input));
                }
            }

            // 3. Update UI
            inputs.forEach(input => {
                if (conflicts.has(input)) {
                    input.style.border = '1px solid #ff4444';
                    input.style.backgroundColor = '#3e1111';
                    input.title = 'Conflict detected!';
                } else {
                    input.style.border = '1px solid #555';
                    input.style.backgroundColor = '#333';
                    input.title = '';
                }
            });

            return conflicts.size > 0;
        };

        Object.entries(descriptions).forEach(([key, desc]) => {
            if (!config.keys[key] && key.startsWith('speed')) return; // Skip extra speed keys if not in config

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

        // Initial conflict check
        checkConflicts();

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
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'padding: 8px 16px; background: #4CAF50; color: white; border: none; cursor: pointer; border-radius: 4px;';
        saveBtn.onclick = () => {
            const hasConflict = checkConflicts();
            if (hasConflict) {
                msgSpan.textContent = 'Cannot save: Resolve conflicts first';
                // Shake animation?
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
            showOSD('Settings Saved');
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding: 8px 16px; background: #666; color: white; border: none; margin-right: 10px; cursor: pointer; border-radius: 4px;';
        cancelBtn.onclick = () => document.body.removeChild(container);

        btns.appendChild(cancelBtn);
        btns.appendChild(saveBtn);
        btnRow.appendChild(btns);

        container.appendChild(btnRow);

        document.body.appendChild(container);
    }

    // --- Keyboard Event Listener ---
    document.addEventListener('keydown', (e) => {
        // Ignore inputs (except Escape sometimes, but here generally ignore)
        const tag = document.activeElement.tagName;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement.isContentEditable) {
            return;
        }

        // Modifiers
        let keyStr = '';
        if (e.shiftKey) keyStr += 'Shift+';
        if (e.ctrlKey) keyStr += 'Ctrl+';
        if (e.metaKey) keyStr += 'Meta+';
        if (e.altKey) keyStr += 'Alt+';

        let k = e.key;
        if (k === ' ') k = 'Space';
        // Normalize single chars to lowercase
        if (k.length === 1) k = k.toLowerCase();

        keyStr += k;

        // Map key to action
        const action = Object.entries(config.keys).find(([k, v]) => v.toLowerCase() === keyStr.toLowerCase());

        if (action) {
            const video = getActiveVideo();
            if (!video) return;

            e.preventDefault();
            e.stopPropagation();

            const act = action[0];
            switch (act) {
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
                case 'speed4': adjustSpeed(video, 4.0); break; // Experimental
                case 'fullscreen': toggleFullscreen(video, 'native'); break;
                case 'webFullscreen': toggleFullscreen(video, 'web'); break;
                case 'rotate': rotateVideo(video); break;
                case 'mirror': toggleMirror(video); break;
                case 'nextVideo': playNextVideo(video); break;
                case 'prevVideo': playPrevVideo(video); break;
            }
        }
    }, { capture: true }); // Capture phase to override site defaults

    // --- Register Menu Command ---
    GM_registerMenuCommand('Settings', createSettingsUI);

})();
