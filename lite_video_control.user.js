// ==UserScript==
// @name         Lite Video Control
// @namespace    http://tampermonkey.net/
// @version      3.15
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
        volLarge: 0.10,
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
            webFullscreen: 'Shift+Enter'
        }
    };

    let config = GM_getValue('lite_video_config', DEFAULT_CONFIG);

    // --- Config Migration / Merge Defaults ---
    // Ensure new keys exist in user's config if they upgraded from an older version
    let configChanged = false;
    for (const [key, val] of Object.entries(DEFAULT_CONFIG.keys)) {
        if (!config.keys[key]) {
            config.keys[key] = val;
            configChanged = true;
        }
    }
    // Also check root properties if added in future
    // for (const [key, val] of Object.entries(DEFAULT_CONFIG)) { ... }

    if (configChanged) {
        GM_setValue('lite_video_config', config);
    }

    let lastSpeed = 1.0;
    let osdTimer = null;
    let webFullscreenStyleCache = new Map(); // Store original styles for ancestors

    // --- OSD (On-Screen Display) ---
    function showOSD(text, video) {
        let osd = document.getElementById('lite-video-osd');

        // Ensure OSD exists
        if (!osd) {
            osd = document.createElement('div');
            osd.id = 'lite-video-osd';
            osd.style.cssText = `
                position: fixed;
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
            `;
        }

        // Determine mount point
        // If in native fullscreen, we MUST append to the fullscreen element for it to be visible
        // But if the fullscreen element is a VIDEO tag, it can't hold children.
        let mountPoint = document.body;
        if (document.fullscreenElement) {
            if (document.fullscreenElement.tagName !== 'VIDEO') {
                mountPoint = document.fullscreenElement;
            }
        }

        // Move OSD if mount point changed or just created
        if (osd.parentNode !== mountPoint) {
            mountPoint.appendChild(osd);
        }

        // Position
        if (video) {
            const rect = video.getBoundingClientRect();
            // In native fullscreen, usually top:20, left:20 relative to viewport is safest
            if (document.fullscreenElement) {
                osd.style.top = '20px';
                osd.style.left = '20px';
            } else {
                const top = Math.max(0, rect.top + 20);
                const left = Math.max(0, rect.left + 20);
                osd.style.top = top + 'px';
                osd.style.left = left + 'px';
            }
        } else {
            osd.style.top = '20px';
            osd.style.left = '20px';
        }

        osd.textContent = text;

        // Force reflow to ensure transition
        osd.style.display = 'block';
        requestAnimationFrame(() => {
            osd.style.opacity = '1';
        });

        if (osdTimer) clearTimeout(osdTimer);
        osdTimer = setTimeout(() => {
            osd.style.opacity = '0';
            // Optional: remove after fade out? keeping it is cheaper.
        }, 1500);
    }

    // --- Video Discovery ---
    function getAllVideos(root = document) {
        let videos = Array.from(root.querySelectorAll('video'));
        // Shadow DOM traversal
        const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                if (node.shadowRoot) return NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_SKIP;
            }
        });

        let node;
        while ((node = treeWalker.nextNode())) {
            if (node.shadowRoot) {
                videos = videos.concat(getAllVideos(node.shadowRoot));
            }
        }
        return videos;
    }

    function getActiveVideo() {
        // Quick check for last interacted
        // (Implementation omitted for lite version, falling back to heuristics)

        const videos = getAllVideos();
        if (videos.length === 0) return null;

        // 1. Priority: Playing video
        const playing = videos.find(v => !v.paused && v.style.display !== 'none');
        if (playing) return playing;

        // 2. Priority: Largest visible video
        let bestCandidate = null;
        let maxArea = 0;

        videos.forEach(v => {
            const rect = v.getBoundingClientRect();
            const area = rect.width * rect.height;
            // Check visibility rough
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const inViewport = (centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight);

            if (area > maxArea && inViewport) {
                maxArea = area;
                bestCandidate = v;
            }
        });

        return bestCandidate || videos[0];
    }

    // --- Actions ---
    function adjustSeek(video, delta) {
        video.currentTime += delta;
        showOSD(`${delta > 0 ? '前进' : '后退'} ${Math.abs(delta)}秒`, video);
    }

    function adjustVolume(video, delta) {
        let newVol = Math.min(1, Math.max(0, video.volume + delta));
        video.volume = newVol;
        showOSD(`音量 ${Math.round(newVol * 100)}%`, video);
    }

    function toggleMute(video) {
        video.muted = !video.muted;
        showOSD(video.muted ? '静音' : '取消静音', video);
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
        video.playbackRate = Math.round(video.playbackRate * 10) / 10;
        showOSD(`倍速 ${video.playbackRate}x`, video);
    }

    // --- Transform Logic (Rotate & Mirror) ---
    // --- Transform Logic (Rotate & Mirror) ---
    function applyTransform(video) {
        const rotate = video._rotateDeg || 0;
        const mirror = video._isMirrored ? -1 : 1;

        let scale = 1;

        // Auto-fit logic for 90/270 degree rotation
        if (rotate % 180 !== 0) {
            // Use LAYOUT dimensions (offset) if available, fallback to intrinsic
            // This ensures we calculate scale based on the visible player size
            const vW = video.offsetWidth || video.videoWidth || video.width;
            const vH = video.offsetHeight || video.videoHeight || video.height;

            if (vW && vH) {
                // Determine container size
                let cW, cH;
                if (video._isWebFullscreen || document.fullscreenElement) {
                    cW = window.innerWidth;
                    cH = window.innerHeight;
                } else {
                    // For inline, we want to fit strictly inside the original element box
                    cW = vW;
                    cH = vH;
                }

                // When rotated 90deg, width becomes height visually
                // We fit the rotated dimensions (vH, vW) into container (cW, cH)
                // Rotated Visual Width = vH. Rotated Visual Height = vW.
                // We need: vH * scale <= cW  => scale <= cW / vH
                // We need: vW * scale <= cH  => scale <= cH / vW

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
        showOSD(video._isMirrored ? '镜像开启' : '镜像关闭', video);
    }

    function rotateVideo(video) {
        video._rotateDeg = (video._rotateDeg || 0) + 90;
        if (video._rotateDeg >= 360) video._rotateDeg = 0;
        applyTransform(video);
        showOSD(`旋转 ${video._rotateDeg}°`, video);
    }

    function enableManualWebFullscreen(video) {
        // Enable Web Fullscreen (Manual Force)
        webFullscreenStyleCache.clear();

        // 1. Fix Video Element
        video._prevStyle = video.style.cssText;
        // Set video to fixed top
        video.style.cssText += 'position:fixed !important; top:0 !important; left:0 !important; width:100vw !important; height:100vh !important; z-index:2147483647 !important; background:black !important; object-fit:contain !important;';

        // Re-apply transform in case it was overwritten or needs to be maintained
        applyTransform(video);

        // 2. Walk up DOM to fix stacking contexts (transforms, z-indexes)
        let el = video.parentElement;
        while (el && el !== document.documentElement) {
            const style = window.getComputedStyle(el);
            // Cache important properties
            webFullscreenStyleCache.set(el, {
                transform: el.style.transform,
                zIndex: el.style.zIndex,
                position: el.style.position,
                contain: el.style.contain,
                filter: el.style.filter,
                willChange: el.style.willChange
            });

            // 1. Clear transforms/containment that create new coordinate systems
            if (style.transform !== 'none') el.style.setProperty('transform', 'none', 'important');
            if (style.filter !== 'none') el.style.setProperty('filter', 'none', 'important');
            if (style.perspective !== 'none') el.style.setProperty('perspective', 'none', 'important');
            if (style.backdropFilter !== 'none') el.style.setProperty('backdrop-filter', 'none', 'important');
            if (style.willChange !== 'auto') el.style.setProperty('will-change', 'auto', 'important');
            el.style.setProperty('contain', 'none', 'important');

            // 2. BOOST Z-Index to MAX for ALL ancestors
            // This lifts the entire branch above other branches (like headers)
            el.style.setProperty('z-index', '2147483647', 'important');

            // 3. Ensure Z-Index applies (requires non-static position)
            if (style.position === 'static') {
                el.style.setProperty('position', 'relative', 'important');
            }

            el = el.parentElement;
        }

        video._isWebFullscreen = true;
        showOSD('网页全屏 (强制)', video);
    }

    function disableManualWebFullscreen(video) {
        // Disable Web Fullscreen
        video.style.cssText = video._prevStyle || '';

        // Restore ancestors
        for (const [el, styles] of webFullscreenStyleCache) {
            el.style.transform = styles.transform;
            el.style.zIndex = styles.zIndex;
            el.style.position = styles.position;
            el.style.contain = styles.contain;
            el.style.filter = styles.filter;
            el.style.willChange = styles.willChange;
        }
        webFullscreenStyleCache.clear();

        // Re-apply transform logic
        applyTransform(video);

        video._isWebFullscreen = false;
        showOSD('退出网页全屏', video);
    }

    // --- Helper: Simulate Full Click Sequence (Critical for React/Vue) ---
    function simulateClick(element) {
        if (!element) return;
        const outputWindow = element.ownerDocument.defaultView || window;
        const opts = { bubbles: true, cancelable: true, view: outputWindow };
        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.click();
    }

    // --- Helper: Deep Fuzzy Button Finder ---
    function findNativeButton(root, keywords) {
        if (!root) return null;

        // 1. Setup candidate list
        const candidates = [];

        // 2. Scan all elements (generic fuzzy search)
        const elements = root.querySelectorAll('*');
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            // Filter out obvious non-interactables to speed up
            if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName)) continue;

            let score = 0;
            const attrStr = (el.getAttribute('class') || '') +
                (el.getAttribute('id') || '') +
                (el.getAttribute('title') || '') +
                (el.getAttribute('aria-label') || '') +
                (el.getAttribute('data-title') || '');

            const lowerAttr = attrStr.toLowerCase();

            for (const key of keywords) {
                if (lowerAttr.includes(key)) {
                    score += 10;
                    // Boost if it's actually a button or clickable div
                    if (el.tagName === 'BUTTON') score += 5;
                    if (el.onclick || el.getAttribute('role') === 'button') score += 5;
                }
            }

            // Text content check (only for short text)
            if (el.innerText && el.innerText.length < 10) {
                for (const key of keywords) {
                    if (el.innerText.includes(key)) score += 5;
                }
            }

            if (score > 0) {
                candidates.push({ el, score });
            }
        }

        // 3. Sort by score
        candidates.sort((a, b) => b.score - a.score);

        return candidates.length > 0 ? candidates[0].el : null;
    }

    function toggleFullscreen(video, mode) {
        // Helper to find wrapper
        const getWrapper = (v) => v.closest('.html5-video-player') || v.closest('.player-container') || v.closest('.video-wrapper') || v.closest('.art-video-player') || v.closest('.bilibili-player') || v.closest('xg-video-container') || v.parentElement;
        const wrapper = getWrapper(video) || video;

        console.log('LiteVideoControl: toggleFullscreen', mode, video, wrapper);

        if (mode === 'web') {
            // Logic:
            // 1. If we are already in OUR manual forced mode, exit it.
            // 2. If not, try to click a native "Web Fullscreen" or "Theater" button.
            // 3. If no native button found, enter OUR manual forced mode.

            if (video._isWebFullscreen) {
                disableManualWebFullscreen(video);
            } else {
                // Try Native Buttons
                const webBtns = [
                    // Bilibili
                    '.bilibili-player-video-btn-web-fullscreen',
                    '.squirtle-video-pagefullscreen', // New Bilibili
                    // YouTube
                    '.ytp-size-button',
                    // Twitch
                    '[data-a-target="player-theatre-mode-button"]',
                    // Huya
                    '.player-fullpage-btn',
                    // Douyin
                    'xg-icon.xgplayer-page-full-screen',
                    '[data-e2e="xgplayer-page-full-screen"]',

                    // Generic ARIA
                    '[aria-label="网页全屏"]', '[aria-label="Web Fullscreen"]',
                    '[aria-label="Theater mode"]', '[aria-label="剧场模式"]'
                ];

                let btnClicked = false;
                for (const selector of webBtns) {
                    const btn = wrapper.querySelector(selector) || document.querySelector(selector);
                    if (btn && (wrapper.contains(btn) || document.body.contains(btn))) {
                        if (btn.offsetParent !== null) {
                            simulateClick(btn);
                            btnClicked = true;
                            showOSD('网页全屏/剧场模式 (原生)', video);
                            break;
                        }
                    }
                }

                if (!btnClicked) {
                    enableManualWebFullscreen(video);
                }
            }
        } else {
            // Native Fullscreen
            // Logic:
            // 1. If real native fullscreen is active, exit it.
            // 2. If NOT active, try to find a native button (Enter OR Exit, just in case state is mismatched).
            // 3. Fallback to API.

            if (document.fullscreenElement) {
                if (document.exitFullscreen) document.exitFullscreen();
                showOSD('退出全屏', video);
            } else {
                let btnClicked = false;

                // 1. Try Specific Known Selectors
                const nativeBtns = [
                    '.ytp-fullscreen-button', // YouTube
                    '.bilibili-player-video-btn-fullscreen', '.squirtle-video-fullscreen', // Bilibili
                    '[data-a-target="player-fullscreen-button"]', // Twitch
                    '.player-fullscreen-btn', // Huya
                    '.xgplayer-fullscreen', '[data-e2e="xgplayer-fullscreen"]', // Douyin
                    '.vjs-fullscreen-control' // VideoJS
                ];

                for (const selector of nativeBtns) {
                    const btn = wrapper.querySelector(selector) || document.querySelector(selector);
                    if (btn && btn.offsetParent !== null) {
                        simulateClick(btn);
                        btnClicked = true;
                        break;
                    }
                }
                if (!btnClicked) {
                    const keywords = ['fullscreen', '全屏', 'full-screen', 'exit-fullscreen', '退出全屏']; // Include exit keywords just in case
                    const fuzzyBtn = findNativeButton(wrapper, keywords);
                    if (fuzzyBtn) {
                        console.log('LiteVideoControl: Fuzzy found button:', fuzzyBtn);
                        simulateClick(fuzzyBtn);
                        btnClicked = true;
                    }
                }

                // 3. NEW: Try Double-Clicking the Video (Universal Fallback)
                // Most players (Douyu, Bilibili, YouTube) toggle fullscreen on double-click.
                if (!btnClicked) {
                    // Start of the fallback chain
                    // Dispatch a double click event on the video content
                    const outputWindow = video.ownerDocument.defaultView || window;
                    const opts = { bubbles: true, cancelable: true, view: outputWindow };
                    video.dispatchEvent(new MouseEvent('dblclick', opts));

                    // We can't easily know if this succeeded without checking document.fullscreenElement async.
                    // But we can assume it might have worked.
                    // To be safe, we continue to API fallback IF document didn't change state immediately? 
                    // No, native fullscreen is async. 

                    // Let's assume double-click is better than API fallback for Douyu.
                    // Visual feedback will confirm.
                    showOSD('尝试双击全屏', video);

                    // Note: We don't set btnClicked=true here because we want the API fallback to happen 
                    // if the double-click handler DOESN'T exist (native video doesn't fullscreen on dblclick by default).
                    // Actually, let's delay the API fallback slightly? No, that makes it async.

                    // Strategy:
                    // If we are on Douyu (or similar), double click is likely handled.
                    // If it's a raw video tag, double click does nothing.
                    // So we should run API fallback immediately ONLY if the site is known to NOT handle dblclick?
                    // Or we just run API fallback as a "just in case".

                    // Better Strategy:
                    // The API fallback guarantees a fullscreen state, but maybe without UI.
                    // The Double Click guarantees UI, but might not work on raw videos.
                    // Let's rely on the Double Click for *interactive* players.
                }

                // 4. API Fallback (The "Force" Option)
                // Only run if we didn't click a button. 
                // We run this AFTER dblclick because if dblclick works, it requests fullscreen. 
                // If we also fire it, we might get a conflict or just redundant calls.
                // However, since we can't detect if dblclick was "handled", we have to run this as a safety net?
                // No, if we force API, we lose the UI (the user's complaint).
                // Let's NOT run API fallback immediately if we think we are on a sophisticated player.

                // Compromise: 
                // If we triggered dblclick, we skip API fallback for this turn.
                // If the user presses again (because dblclick failed), then we might need a way to force it.
                // But complex detection is hard.

                // Let's just keep the API fallback. If dblclick works, it requests fullscreen. 
                // If our API fallback also requests it, the browser might block the second one or just ignore it.
                // The issue is if the API fallback "wins" and puts us in "naked" fullscreen before the site logic kicks in.

                if (!btnClicked) {
                    if (wrapper.requestFullscreen) wrapper.requestFullscreen();
                    else if (wrapper.webkitRequestFullscreen) wrapper.webkitRequestFullscreen();
                    else if (video.requestFullscreen) video.requestFullscreen();
                }

                showOSD('切换全屏', video);
            }
        }
    }

    // --- Settings UI ---
    function createSettingsUI() {
        if (document.getElementById('lite-video-settings')) return;

        const container = document.createElement('div');
        container.id = 'lite-video-settings';
        container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #222;
            color: #eee;
            padding: 20px;
            border-radius: 8px;
            z-index: 2147483647;
            box-shadow: 0 0 15px rgba(0,0,0,0.5);
            font-family: sans-serif;
            min-width: 400px;
            max-height: 80vh;
            overflow-y: auto;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Lite Video Control Settings';
        title.style.marginTop = '0';
        container.appendChild(title);

        const hint = document.createElement('p');
        hint.textContent = 'Click input to record shortcut.';
        hint.style.fontSize = '12px';
        hint.style.color = '#aaa';
        container.appendChild(hint);

        const form = document.createElement('div');
        form.style.display = 'grid';
        form.style.gridTemplateColumns = '1fr 1fr';
        form.style.gap = '10px';

        // Check for conflicts
        function checkConflict(newKey, currentKeyName) {
            // 1. Check against other inputs in the form (live check)
            const inputs = form.querySelectorAll('input');
            for (let input of inputs) {
                if (input.dataset.key !== currentKeyName && input.value.toLowerCase() === newKey.toLowerCase()) {
                    return input.dataset.label; // Return name of conflicting action
                }
            }
            return null;
        }

        // Helper to create input fields
        function createInput(label, key, isNumber = false) {
            const labelEl = document.createElement('label');
            labelEl.textContent = label;

            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';

            const input = document.createElement('input');
            input.type = 'text';
            input.value = config.keys[key];
            input.dataset.key = key;
            input.dataset.label = label;
            input.style.width = '100%';
            input.style.padding = '5px';
            input.style.background = '#333';
            input.style.color = 'white';
            input.style.border = '1px solid #555';
            input.style.boxSizing = 'border-box';

            const warn = document.createElement('span');
            warn.style.position = 'absolute';
            warn.style.right = '5px';
            warn.style.top = '50%';
            warn.style.transform = 'translateY(-50%)';
            warn.style.color = '#ff6b6b';
            warn.style.fontSize = '12px';
            warn.style.display = 'none';
            wrapper.appendChild(input);
            wrapper.appendChild(warn);

            // Capture key for shortcuts
            if (!isNumber) {
                input.addEventListener('keydown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    let keyStr = '';
                    if (e.shiftKey) keyStr += 'Shift+';
                    if (e.ctrlKey) keyStr += 'Ctrl+';
                    if (e.altKey) keyStr += 'Alt+';
                    if (e.metaKey) keyStr += 'Meta+';

                    let keyName = e.key;
                    if (keyName === ' ') keyName = 'Space';
                    if (keyName.length === 1) keyName = keyName.toLowerCase();
                    if (['Shift', 'Control', 'Alt', 'Meta'].includes(keyName)) return;

                    keyStr += keyName;
                    input.value = keyStr;

                    // Conflict Check
                    const conflict = checkConflict(keyStr, key);
                    if (conflict) {
                        input.style.borderColor = '#ff6b6b';
                        warn.textContent = '!';
                        warn.title = `Conflict with: ${conflict}`;
                        warn.style.display = 'block';
                    } else {
                        input.style.borderColor = '#555';
                        warn.style.display = 'none';
                    }
                });
            }
            // Initial check
            const initialConflict = checkConflict(config.keys[key], key);
            if (initialConflict) {
                input.style.borderColor = '#ff6b6b';
                warn.textContent = '!';
                warn.title = `Conflict with: ${initialConflict}`;
                warn.style.display = 'block';
            }

            form.appendChild(labelEl);
            form.appendChild(wrapper);
        }

        const descriptions = {
            seekForward: 'Seek Forward (Small)',
            seekBackward: 'Seek Backward (Small)',
            seekForwardLarge: 'Seek Forward (Large)',
            seekBackwardLarge: 'Seek Backward (Large)',
            volUp: 'Volume Up (Small)',
            volDown: 'Volume Down (Small)',
            volUpLarge: 'Volume Up (Large)',
            volDownLarge: 'Volume Down (Large)',
            mute: 'Toggle Mute',
            mirror: 'Toggle Mirror',
            rotate: 'Rotate 90°',
            speedUp: 'Speed Up',
            speedDown: 'Speed Down',
            speedReset: 'Speed Reset/1.0x',
            fullscreen: 'Native Fullscreen',
            webFullscreen: 'Web Fullscreen'
        };

        for (const [key, desc] of Object.entries(descriptions)) {
            createInput(desc, key);
        }

        container.appendChild(form);

        // Buttons
        const btnContainer = document.createElement('div');
        btnContainer.style.marginTop = '20px';
        btnContainer.style.textAlign = 'right';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px;';
        saveBtn.onclick = () => {
            const inputs = form.querySelectorAll('input');
            const newKeys = { ...config.keys };
            let hasConflict = false;

            inputs.forEach(input => {
                newKeys[input.dataset.key] = input.value;
                if (input.style.borderColor === 'rgb(255, 107, 107)') hasConflict = true;
            });

            if (hasConflict) {
                if (!confirm("Conflicts detected. Save anyway?")) return;
            }

            config.keys = newKeys;
            GM_setValue('lite_video_config', config);
            document.body.removeChild(container);
            showOSD('Settings Saved');
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding: 8px 16px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;';
        cancelBtn.onclick = () => {
            document.body.removeChild(container);
        };

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset to Default';
        resetBtn.style.cssText = 'padding: 8px 16px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: auto; float: left;';
        resetBtn.onclick = () => {
            if (confirm('Reset all shortcuts?')) {
                config = DEFAULT_CONFIG;
                GM_setValue('lite_video_config', config);
                document.body.removeChild(container);
                showOSD('Restored Defaults');
            }
        };

        btnContainer.appendChild(resetBtn);
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(saveBtn);
        container.appendChild(btnContainer);

        document.body.appendChild(container);
    }

    GM_registerMenuCommand("Settings", createSettingsUI);

    // --- Input Handling ---
    function handleKey(e) {
        // Ignore if focus is in input
        const active = document.activeElement;
        const tag = active.tagName.toUpperCase();
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || active.isContentEditable) {
            return;
        }

        // Construct key string
        let keyStr = '';
        if (e.shiftKey) keyStr += 'Shift+';
        if (e.ctrlKey) keyStr += 'Ctrl+';
        if (e.altKey) keyStr += 'Alt+';
        if (e.metaKey) keyStr += 'Meta+';

        let keyName = e.key;
        if (keyName === ' ') keyName = 'Space';
        if (keyName.length === 1) keyName = keyName.toLowerCase();

        keyStr += keyName;

        // Map key to action
        const action = Object.entries(config.keys).find(([k, v]) => v.toLowerCase() === keyStr.toLowerCase());

        console.log('LiteVideoControl: Key:', keyStr, 'Action:', action ? action[0] : 'None');

        if (action) {
            const video = getActiveVideo();
            console.log('LiteVideoControl: Active Video:', video);
            if (!video) return;

            const actionName = action[0];
            e.preventDefault();
            e.stopImmediatePropagation();

            switch (actionName) {
                case 'seekForward': adjustSeek(video, config.seekSmall); break;
                case 'seekBackward': adjustSeek(video, -config.seekSmall); break;
                case 'seekForwardLarge': adjustSeek(video, config.seekLarge); break;
                case 'seekBackwardLarge': adjustSeek(video, -config.seekLarge); break;
                case 'volUp': adjustVolume(video, config.volSmall); break;
                case 'volDown': adjustVolume(video, -config.volSmall); break;
                case 'volUpLarge': adjustVolume(video, config.volLarge); break;
                case 'volDownLarge': adjustVolume(video, -config.volLarge); break;
                case 'mute': toggleMute(video); break;
                case 'mirror': toggleMirror(video); break;
                case 'rotate': rotateVideo(video); break;
                case 'speedUp': adjustSpeed(video, 'up'); break;
                case 'speedDown': adjustSpeed(video, 'down'); break;
                case 'speedReset': adjustSpeed(video, 'reset'); break;
                case 'speed1': adjustSpeed(video, 1); break;
                case 'speed2': adjustSpeed(video, 2); break;
                case 'speed3': adjustSpeed(video, 3); break;
                case 'speed4': adjustSpeed(video, 4); break;
                case 'fullscreen': toggleFullscreen(video, 'native'); break;
                case 'webFullscreen': toggleFullscreen(video, 'web'); break;
            }
        }
    }

    window.addEventListener('keydown', handleKey, true);

})();
