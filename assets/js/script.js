document.addEventListener('DOMContentLoaded', () => {
    const inputServer = document.getElementById('serverIpInput');
    const btnCheck = document.getElementById('btnCheck');
    const loadingState = document.getElementById('loading');
    const errorMsg = document.getElementById('errorMsg');

    // Server Dashboard Elements
    const sDashboard = document.getElementById('serverDashboard');
    const sName = document.getElementById('sName');
    const sIpInfo = document.getElementById('sIp');
    const sOnline = document.getElementById('sOnline');
    const sMax = document.getElementById('sMax');
    const sGameType = document.getElementById('sGameType');

    // Player Section Elements
    const playerSection = document.getElementById('playerSection');
    const playerTableBody = document.getElementById('playerTableBody');
    const playerSearch = document.getElementById('playerSearch');
    const emptyPlayers = document.getElementById('emptyPlayers');

    // History & Fav UI Elements
    const recentSearches = document.getElementById('recentSearches');
    const recentTags = document.getElementById('recentTags');
    const favSection = document.getElementById('favSection');
    const favCardsContainer = document.getElementById('favCardsContainer');

    // Advanced & New Elements
    const btnFavorite = document.getElementById('btnFavorite');
    const btnInfo = document.getElementById('btnInfo');
    const serverTags = document.getElementById('serverTags');
    const refreshTimer = document.getElementById('refreshTimer');
    const btnJoin = document.getElementById('btnJoin');

    // Modal Elements
    const infoModal = document.getElementById('infoModal');
    const closeModal = document.getElementById('closeModal');
    const modalBody = document.getElementById('modalBody');

    // Mini-Game Elements
    const btnGame = document.getElementById('btnGame');
    const gameModal = document.getElementById('gameModal');
    const closeGameModal = document.getElementById('closeGameModal');
    const gameScoreEl = document.getElementById('gameScore');
    const gameHighscoreEl = document.getElementById('gameHighscore');
    const gameTimeLeftEl = document.getElementById('gameTimeLeft');
    const whackCells = document.querySelectorAll('.whack-cell');
    const btnStartGame = document.getElementById('btnStartGame');

    // Theme Elements
    const btnTheme = document.getElementById('btnTheme');
    const themeModal = document.getElementById('themeModal');
    const closeThemeModal = document.getElementById('closeThemeModal');
    const themeBtns = document.querySelectorAll('.theme-btn');
    const btnLightMode = document.getElementById('btnLightMode');

    // Table Headers
    const sortableHeaders = document.querySelectorAll('.sortable');

    let playersData = [];
    let currentServerIp = null;
    let currentServerRawInfo = null;
    let refreshInterval = null;
    let timeLeft = 15;

    // Pagination State
    const PAGE_SIZE = 20;
    let currentPage = 1;
    let showAll = false;
    let lastFilteredPlayers = [];

    // Pagination Elements
    const paginationBar    = document.getElementById('paginationBar');
    const pageNumbers      = document.getElementById('pageNumbers');
    const btnFirstPage     = document.getElementById('btnFirstPage');
    const btnPrevPage      = document.getElementById('btnPrevPage');
    const btnNextPage      = document.getElementById('btnNextPage');
    const btnLastPage      = document.getElementById('btnLastPage');
    const currentPageLabel = document.getElementById('currentPageLabel');
    const totalPagesLabel  = document.getElementById('totalPagesLabel');
    const countShowing     = document.getElementById('countShowing');
    const countTotal       = document.getElementById('countTotal');
    const btnShowAll       = document.getElementById('btnShowAll');

    // Theme Loader
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('tracker_theme');
    if (savedTheme) {
        root.style.setProperty('--primary', savedTheme);
    }

    const savedMode = localStorage.getItem('tracker_mode');
    if (savedMode === 'light') {
        root.setAttribute('data-theme', 'light');
        btnLightMode.className = 'fa-solid fa-moon header-icon';
    } else {
        root.setAttribute('data-theme', 'dark');
        btnLightMode.className = 'fa-solid fa-sun header-icon';
    }

    btnLightMode.addEventListener('click', () => {
        const currentMode = root.getAttribute('data-theme');
        if (currentMode === 'light') {
            root.setAttribute('data-theme', 'dark');
            localStorage.setItem('tracker_mode', 'dark');
            btnLightMode.className = 'fa-solid fa-sun header-icon';
        } else {
            root.setAttribute('data-theme', 'light');
            localStorage.setItem('tracker_mode', 'light');
            btnLightMode.className = 'fa-solid fa-moon header-icon';
        }
    });

    // Sorting State
    let sortCol = '';
    let sortAsc = true;

    const miniFetchLive = async (ip, cardElement) => {
        try {
            let actualIp = ip.replace(/^https?:\/\//, '');
            let isCfx = actualIp.includes('cfx.re/');

            if (isCfx) {
                const cfxCode = actualIp.split('cfx.re/join/')[1].split('/')[0];
                const res = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${cfxCode}`);
                if (!res.ok) throw new Error();
                const data = await res.json();
                const info = data.Data;
                const clients = info.clients !== undefined ? info.clients : (info.players ? info.players.length : 0);
                const max = info.sv_maxclients || info.vars?.sv_maxClients || '32';
                cardElement.querySelector('.fav-card-players').innerHTML = `<i class="fa-solid fa-users"></i> ${clients}/${max}`;
                cardElement.querySelector('.fav-card-ping').innerHTML = `<i class="fa-solid fa-signal" style="color:var(--primary);"></i> Online`;
            } else {
                if (!actualIp.includes(':')) actualIp += ':30120';
                const proxyUrl = 'https://api.allorigins.win/raw?url=';
                const res = await fetch(`${proxyUrl}${encodeURIComponent(`http://${actualIp}/info.json`)}`);
                if (!res.ok) throw new Error();

                const info = await res.json();
                const playersRes = await fetch(`${proxyUrl}${encodeURIComponent(`http://${actualIp}/players.json`)}`);
                if (!playersRes.ok) throw new Error();

                const players = await playersRes.json();
                const max = info.vars?.sv_maxClients || '32';

                cardElement.querySelector('.fav-card-players').innerHTML = `<i class="fa-solid fa-users"></i> ${players.length}/${max}`;
                cardElement.querySelector('.fav-card-ping').innerHTML = `<i class="fa-solid fa-signal" style="color:var(--primary);"></i> Online`;
            }
        } catch (e) {
            if (cardElement) {
                cardElement.querySelector('.fav-card-ping').innerHTML = `<i class="fa-solid fa-signal" style="color:var(--danger)"></i> Offline`;
                cardElement.querySelector('.fav-card-players').innerHTML = `-`;
            }
        }
    };

    // Load History & Favorites
    const loadHistory = () => {
        const history = JSON.parse(localStorage.getItem('serverHistory') || '[]');
        const favorites = JSON.parse(localStorage.getItem('serverFavorites') || '[]');

        // Render Favorites
        if (favorites.length > 0) {
            favSection.classList.remove('hidden');
            favCardsContainer.innerHTML = '';

            favorites.forEach(item => {
                const card = document.createElement('div');
                card.className = 'fav-card';
                card.innerHTML = `
                    <i class="fa-solid fa-xmark fav-card-delete" title="Remove"></i>
                    <div class="fav-card-name" title="${item.name}">${item.name}</div>
                    <div class="fav-card-meta">
                        <span class="fav-card-ping"><i class="fa-solid fa-signal" style="color:var(--text-muted)"></i> Loading...</span>
                        <span class="fav-card-players">--</span>
                    </div>
                `;

                // Event listener to open dashboard
                card.addEventListener('click', (e) => {
                    if (e.target.classList.contains('fav-card-delete')) return;
                    inputServer.value = item.ip;
                    fetchServerData();
                });

                // Event listener to delete
                card.querySelector('.fav-card-delete').addEventListener('click', () => {
                    let favs = JSON.parse(localStorage.getItem('serverFavorites') || '[]');
                    favs = favs.filter(f => f.ip !== item.ip);
                    localStorage.setItem('serverFavorites', JSON.stringify(favs));
                    loadHistory();
                    if (currentServerIp === item.ip) {
                        btnFavorite.classList.add('fa-regular');
                        btnFavorite.classList.remove('fa-solid', 'active');
                    }
                });

                favCardsContainer.appendChild(card);
                miniFetchLive(item.ip, card); // Fetch data softly in background
            });
        } else {
            favSection.classList.add('hidden');
        }

        // Render history (exclude favorites)
        let filteredHistory = history.filter(item => !favorites.find(f => f.ip === item.ip));
        if (filteredHistory.length > 0) {
            recentSearches.classList.remove('hidden');
            recentTags.innerHTML = '';

            filteredHistory.forEach(item => {
                const tag = document.createElement('div');
                tag.className = 'history-tag';
                tag.innerText = item.name.length > 15 ? item.name.substring(0, 15) + '...' : item.name;
                tag.title = item.ip;
                tag.addEventListener('click', () => {
                    inputServer.value = item.ip;
                    fetchServerData();
                });
                recentTags.appendChild(tag);
            });
        } else {
            recentSearches.classList.add('hidden');
        }
    };
    loadHistory();

    const saveHistory = (ip, name) => {
        let history = JSON.parse(localStorage.getItem('serverHistory') || '[]');
        history = history.filter(item => item.ip !== ip);
        history.unshift({ ip, name });
        if (history.length > 5) history.pop();
        localStorage.setItem('serverHistory', JSON.stringify(history));
        loadHistory();
    };

    const toggleFavorite = () => {
        if (!currentServerIp) return;
        let favorites = JSON.parse(localStorage.getItem('serverFavorites') || '[]');
        let nameToSave = sName.innerText.replace(' Server Name', '').trim(); // Fallback name
        if (nameToSave === "") nameToSave = currentServerIp;

        const isFav = favorites.find(item => item.ip === currentServerIp);

        if (isFav) {
            favorites = favorites.filter(item => item.ip !== currentServerIp);
            btnFavorite.classList.remove('fa-solid', 'active');
            btnFavorite.classList.add('fa-regular');
        } else {
            favorites.push({ ip: currentServerIp, name: nameToSave });
            btnFavorite.classList.remove('fa-regular');
            btnFavorite.classList.add('fa-solid', 'active');
        }
        localStorage.setItem('serverFavorites', JSON.stringify(favorites));
        loadHistory();
    };

    const checkIsFavorite = (ip) => {
        const favorites = JSON.parse(localStorage.getItem('serverFavorites') || '[]');
        return favorites.some(item => item.ip === ip);
    };

    btnFavorite.addEventListener('click', toggleFavorite);

    // Auto Refresh Logic
    const startAutoRefresh = () => {
        if (refreshInterval) clearInterval(refreshInterval);
        timeLeft = 15;
        refreshTimer.innerText = `${timeLeft}s`;
        refreshInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                if (currentServerIp) {
                    inputServer.value = currentServerIp;
                    fetchServerData(true);
                }
                timeLeft = 15;
            }
            refreshTimer.innerText = `${timeLeft}s`;
        }, 1000);
    };

    const stopAutoRefresh = () => {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
        refreshTimer.innerText = '--';
    };

    // Helper: Strip FiveM Color Codes (e.g. ^1, ^2, ^3)
    const stripColors = (text) => {
        if (!text) return '';
        return text.replace(/\^[0-9]/g, '');
    };

    let audioCtx = null;
    const playBeep = () => {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'triangle';
            oscillator.frequency.value = 600; // Hz

            // Beep pelan
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.5);
        } catch (e) {
            console.log("Audio not supported or blocked");
        }
    };

    const showError = (msg) => {
        stopAutoRefresh();
        errorMsg.querySelector('span').innerText = msg;
        errorMsg.classList.remove('hidden');
        sDashboard.classList.add('hidden');
        playerSection.classList.add('hidden');
        loadingState.classList.add('hidden');
    };

    const clearStates = () => {
        errorMsg.classList.add('hidden');
        sDashboard.classList.add('hidden');
        playerSection.classList.add('hidden');
        loadingState.classList.remove('hidden');
    };

    const fetchServerData = async (isSilent = false) => {
        let ip = inputServer.value.trim();
        if (!ip) {
            if (!isSilent) showError("Silakan masukkan IP server atau link CFX yang valid.");
            return;
        }

        let cfxCode = null;
        if (ip.includes('cfx.re/join/')) {
            cfxCode = ip.split('cfx.re/join/')[1].split('/')[0];
        } else if (ip.match(/^[a-zA-Z0-9]{6}$/)) {
            cfxCode = ip;
        }

        if (!isSilent) clearStates();

        try {
            let actualIp = ip;
            let infoNode = null;

            if (cfxCode) {
                actualIp = `cfx.re/join/${cfxCode}`;
                const cfxRes = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${cfxCode}`);
                if (!cfxRes.ok) throw new Error("Gagal mengambil data dari CFX. Pastikan link server valid.");

                const cfxData = await cfxRes.json();
                if (!cfxData.Data) throw new Error("Server tidak ditemukan.");

                infoNode = cfxData.Data;
                playersData = infoNode.players || [];

                sName.innerText = stripColors(infoNode.hostname || infoNode.vars?.sv_projectName || 'Unknown Server');
                sIpInfo.innerText = actualIp;
                sOnline.innerText = infoNode.clients !== undefined ? infoNode.clients : playersData.length;
                sMax.innerText = infoNode.sv_maxclients || infoNode.vars?.sv_maxClients || '32';
                sGameType.innerText = infoNode.gametype || infoNode.vars?.gametype || 'Freeroam/Roleplay';

            } else {
                if (!ip.includes(':')) ip += ':30120';
                ip = ip.replace(/^https?:\/\//, '');
                actualIp = ip;

                const proxyUrl = 'https://api.allorigins.win/raw?url=';

                const infoRes = await fetch(`${proxyUrl}${encodeURIComponent(`http://${ip}/info.json`)}`);
                if (!infoRes.ok) throw new Error("Gagal mengambil data dari server. Pastikan IP valid atau server menyala.");
                infoNode = await infoRes.json();

                const playersRes = await fetch(`${proxyUrl}${encodeURIComponent(`http://${ip}/players.json`)}`);
                if (!playersRes.ok) throw new Error("Gagal mengambil daftar pemain.");
                playersData = await playersRes.json();

                sName.innerText = stripColors(infoNode.vars?.sv_projectName || infoNode.vars?.sv_hostname || 'Unknown Server');
                sIpInfo.innerText = actualIp;
                sOnline.innerText = playersData.length;
                sMax.innerText = infoNode.vars?.sv_maxClients || '32';
                sGameType.innerText = infoNode.vars?.gametype || 'Freeroam/Roleplay';
            }

            // Tags
            serverTags.innerHTML = '';
            let tagsArray = [];
            if (infoNode.vars && infoNode.vars.tags) {
                tagsArray = infoNode.vars.tags.split(',').map(t => t.trim());
            }
            if (tagsArray.length > 0) {
                tagsArray.slice(0, 8).forEach(tag => {
                    const t = document.createElement('span');
                    t.className = 'server-tag';
                    t.innerText = tag;
                    serverTags.appendChild(t);
                });
                serverTags.classList.remove('hidden');
            } else {
                serverTags.classList.add('hidden');
            }

            currentServerIp = actualIp;
            currentServerRawInfo = infoNode;
            btnInfo.classList.remove('hidden');

            // Fav check
            if (checkIsFavorite(currentServerIp)) {
                btnFavorite.classList.remove('fa-regular');
                btnFavorite.classList.add('fa-solid', 'active');
            } else {
                btnFavorite.classList.add('fa-regular');
                btnFavorite.classList.remove('fa-solid', 'active');
            }

            loadingState.classList.add('hidden');
            sDashboard.classList.remove('hidden');
            playerSection.classList.remove('hidden');

            saveHistory(actualIp, sName.innerText);

            // Trigger sorting & rendering
            sortPlayersData();
            playerSearch.dispatchEvent(new Event('input')); // re-apply filter

            if (!isSilent) {
                startAutoRefresh();
            }

        } catch (err) {
            console.error(err);
            if (!isSilent) {
                showError(err.message || 'Terjadi kesalahan saat memeriksa server.');
            } else {
                // If it's silent auto-refresh and fails, play alert beep
                playBeep();
            }
        }
    };

    // Join Server Action
    btnJoin.addEventListener('click', () => {
        if (currentServerIp) {
            window.location.href = `fivem://connect/${currentServerIp}`;
        }
    });

    const getPingColorClass = (ping) => {
        if (ping < 60) return 'ping-good';
        if (ping < 120) return 'ping-warn';
        return 'ping-bad';
    };

    const hexToDec = (hexStr) => {
        if (hexStr.startsWith('steam:')) hexStr = hexStr.replace('steam:', '');
        if (hexStr.substring(0, 2) === '0x') hexStr = hexStr.substring(2);
        hexStr = hexStr.toLowerCase();
        let res = 0n;
        for (let i = 0; i < hexStr.length; i++) {
            const charCode = hexStr.charCodeAt(i);
            let val = 0n;
            if (charCode >= 48 && charCode <= 57) val = BigInt(charCode - 48);
            else if (charCode >= 97 && charCode <= 102) val = BigInt(charCode - 97 + 10);
            res = res * 16n + val;
        }
        return res.toString();
    };

    const getPlatformIcon = (identifiers) => {
        if (!identifiers) return '';
        let idArray = [];
        if (Array.isArray(identifiers)) {
            idArray = identifiers;
        } else if (typeof identifiers === 'string') {
            idArray = [identifiers];
        }

        let icons = '';
        idArray.forEach(id => {
            if (id.startsWith('steam:')) {
                const dec = hexToDec(id);
                icons += `<a href="https://steamcommunity.com/profiles/${dec}" target="_blank" class="steam-link"><i class="fa-brands fa-steam" style="color:#64748b; margin-right:5px;" title="Steam Profile"></i></a>`;
            } else if (id.startsWith('discord:')) {
                icons += '<i class="fa-brands fa-discord" style="color:#5865F2; margin-right:5px;" title="Discord"></i>';
            } else if (id.startsWith('fivem:')) {
                icons += '<i class="fa-solid fa-gamepad" style="color:#f59e0b; margin-right:5px;" title="FiveM"></i>';
            }
        });

        return icons || '<i class="fa-solid fa-desktop" title="PC"></i>';
    };


    const renderPlayersPage = (players) => {
        playerTableBody.innerHTML = '';

        if (!players || players.length === 0) {
            emptyPlayers.classList.remove('hidden');
            document.querySelector('.custom-table').classList.add('hidden');
            paginationBar.classList.add('hidden');
            countShowing.innerText = 0;
            countTotal.innerText = 0;
            return;
        }

        emptyPlayers.classList.add('hidden');
        document.querySelector('.custom-table').classList.remove('hidden');

        // Save for pagination
        lastFilteredPlayers = players;
        countTotal.innerText = players.length;

        let toRender = players;
        if (!showAll) {
            const totalPages = Math.ceil(players.length / PAGE_SIZE);
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;
            const start = (currentPage - 1) * PAGE_SIZE;
            const end   = start + PAGE_SIZE;
            toRender = players.slice(start, end);
            renderPagination(players.length, totalPages);
        } else {
            paginationBar.classList.add('hidden');
        }

        countShowing.innerText = toRender.length;

        toRender.forEach(p => {
            const tr = document.createElement('tr');
            const safeName = stripColors(p.name).replace(/</g, "&lt;").replace(/>/g, "&gt;");
            tr.innerHTML = `
                <td><span class="id-badge">#${p.id}</span></td>
                <td style="font-weight: 500;">${safeName}</td>
                <td class="ping-badge ${getPingColorClass(p.ping)}">${p.ping} ms</td>
                <td>${getPlatformIcon(p.identifiers)}</td>
            `;
            playerTableBody.appendChild(tr);
        });
    };

    const renderPagination = (total, totalPages) => {
        if (totalPages <= 1) {
            paginationBar.classList.add('hidden');
            return;
        }
        paginationBar.classList.remove('hidden');

        currentPageLabel.innerText = currentPage;
        totalPagesLabel.innerText  = totalPages;

        btnFirstPage.disabled = currentPage === 1;
        btnPrevPage.disabled  = currentPage === 1;
        btnNextPage.disabled  = currentPage === totalPages;
        btnLastPage.disabled  = currentPage === totalPages;

        // Render page number buttons (show max 5 around current)
        pageNumbers.innerHTML = '';
        const range = 2;
        let start = Math.max(1, currentPage - range);
        let end   = Math.min(totalPages, currentPage + range);

        if (start > 1) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-ellipsis';
            ellipsis.innerText = '...';
            const firstBtn = document.createElement('button');
            firstBtn.className = 'page-btn page-num';
            firstBtn.innerText = 1;
            firstBtn.addEventListener('click', () => { currentPage = 1; renderPlayersPage(lastFilteredPlayers); });
            pageNumbers.appendChild(firstBtn);
            if (start > 2) pageNumbers.appendChild(ellipsis);
        }

        for (let i = start; i <= end; i++) {
            const btn = document.createElement('button');
            btn.className = 'page-btn page-num' + (i === currentPage ? ' active-page' : '');
            btn.innerText = i;
            const pageNum = i;
            btn.addEventListener('click', () => { currentPage = pageNum; renderPlayersPage(lastFilteredPlayers); });
            pageNumbers.appendChild(btn);
        }

        if (end < totalPages) {
            if (end < totalPages - 1) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'page-ellipsis';
                ellipsis.innerText = '...';
                pageNumbers.appendChild(ellipsis);
            }
            const lastBtn = document.createElement('button');
            lastBtn.className = 'page-btn page-num';
            lastBtn.innerText = totalPages;
            lastBtn.addEventListener('click', () => { currentPage = totalPages; renderPlayersPage(lastFilteredPlayers); });
            pageNumbers.appendChild(lastBtn);
        }
    };

    const renderPlayers = renderPlayersPage;

    // Table Sorting
    const sortPlayersData = () => {
        if (!sortCol) return;

        playersData.sort((a, b) => {
            let valA, valB;

            if (sortCol === 'id') {
                valA = parseInt(a.id) || 0;
                valB = parseInt(b.id) || 0;
            } else if (sortCol === 'ping') {
                valA = parseInt(a.ping) || 0;
                valB = parseInt(b.ping) || 0;
            } else if (sortCol === 'name') {
                valA = stripColors(a.name).toLowerCase();
                valB = stripColors(b.name).toLowerCase();
            }

            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
    };

    sortableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-sort');

            if (sortCol === column) {
                sortAsc = !sortAsc;
            } else {
                sortCol = column;
                sortAsc = true;
            }

            // Update UI headers
            sortableHeaders.forEach(header => header.removeAttribute('data-order'));
            th.setAttribute('data-order', sortAsc ? 'asc' : 'desc');

            // Re-render
            sortPlayersData();
            playerSearch.dispatchEvent(new Event('input'));
        });
    });

    let activeChipFilter = '';
    const filterChips = document.querySelectorAll('.chip');
    
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeChipFilter = chip.getAttribute('data-filter') || '';
            playerSearch.dispatchEvent(new Event('input'));
        });
    });

    const filterPlayers = () => {
        const query = playerSearch.value.toLowerCase().trim();

        const filtered = playersData.filter(p => {
            let matchText = false;
            if (query === '') {
                matchText = true;
            } else {
                if (p.id.toString() === query || p.id.toString().includes(query)) matchText = true;
                const plainName = stripColors(p.name).toLowerCase();
                if (plainName.includes(query)) matchText = true;
            }

            let matchChip = true;
            if (activeChipFilter !== '') {
                matchChip = false;
                const filterTags = activeChipFilter.split(',');
                const plainNameLower = stripColors(p.name).toLowerCase();
                for (let tag of filterTags) {
                    if (plainNameLower.includes('[' + tag) || plainNameLower.includes(tag + ']')) {
                        matchChip = true;
                        break;
                    }
                }
            }

            return matchText && matchChip;
        });

        currentPage = 1;
        renderPlayersPage(filtered);
    };

    // Modal Operations
    const populateModal = () => {
        modalBody.innerHTML = '';
        if (!currentServerRawInfo) return;

        // Grab useful variables
        const obj = currentServerRawInfo.vars || {};

        const renderItem = (label, val) => {
            if (!val) return;
            const item = document.createElement('div');
            item.className = 'raw-data-item';
            // Simple link detector
            const safeVal = (val.toString().startsWith('http') || val.toString().startsWith('discord.gg/'))
                ? `<a href="${val.toString().startsWith('http') ? val : 'https://' + val}" target="_blank" style="color:var(--primary);text-decoration:none;">${val}</a>`
                : val.toString().replace(/</g, "&lt;").replace(/>/g, "&gt;");

            item.innerHTML = `
                <span class="raw-label">${label}</span>
                <div class="raw-value">${safeVal}</div>
            `;
            modalBody.appendChild(item);
        };

        renderItem('Project Name', obj.sv_projectName);
        renderItem('Project Desc', obj.sv_projectDesc);
        renderItem('Build Version', obj.sv_enforceGameBuild);
        renderItem('Tags', obj.tags);
        renderItem('Discord', obj.Discord || obj.discord);
        renderItem('ScriptHook Allowed', obj.sv_scriptHookAllowed);
        renderItem('Locale', obj.locale);
        renderItem('Licence Mode', obj.sv_licenseKeyToken);
        renderItem('Endpoint', currentServerIp);
        renderItem('Clients', `${obj.sv_maxClients} Max`);
    };

    btnInfo.addEventListener('click', () => {
        populateModal();
        infoModal.classList.remove('hidden');
    });

    closeModal.addEventListener('click', () => {
        infoModal.classList.add('hidden');
    });

    btnTheme.addEventListener('click', () => themeModal.classList.remove('hidden'));
    closeThemeModal.addEventListener('click', () => themeModal.classList.add('hidden'));

    themeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.getAttribute('data-color');
            root.style.setProperty('--primary', color);
            localStorage.setItem('tracker_theme', color);
            themeModal.classList.add('hidden');
        });
    });

    // --- VIRUS SMASHER MINIGAME LOGIC --- //
    let gameScore = 0;
    let gameHighscore = parseInt(localStorage.getItem('whack_highscore')) || 0;
    gameHighscoreEl.innerText = gameHighscore;

    let isGameRunning = false;
    let timeLeftGame = 30;
    let mainGameInterval = null;
    let timerInterval = null;
    let currentBugPos = -1;
    let bugSpeed = 800; // ms

    const clearBugs = () => {
        whackCells.forEach(cell => cell.innerHTML = '');
        currentBugPos = -1;
    };

    const spawnBug = () => {
        if (!isGameRunning) return;
        clearBugs();

        let newPos = Math.floor(Math.random() * 9);
        while (newPos === currentBugPos) {
            newPos = Math.floor(Math.random() * 9);
        }

        currentBugPos = newPos;
        whackCells[newPos].innerHTML = '<i class="fa-solid fa-bug virus-item"></i>';

        // Speed curve logic
        bugSpeed = Math.max(300, 800 - (gameScore * 15));

        mainGameInterval = setTimeout(spawnBug, bugSpeed);
    };

    const runTimer = () => {
        timeLeftGame--;
        gameTimeLeftEl.innerText = `${timeLeftGame}s`;
        if (timeLeftGame <= 0) {
            stopGame();
        }
    };

    const startGame = () => {
        isGameRunning = true;
        gameScore = 0;
        timeLeftGame = 30;
        bugSpeed = 800;
        gameScoreEl.innerText = gameScore;
        gameTimeLeftEl.innerText = `${timeLeftGame}s`;
        btnStartGame.classList.add('hidden');

        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(runTimer, 1000);

        spawnBug();
    };

    const stopGame = () => {
        isGameRunning = false;
        clearBugs();
        clearTimeout(mainGameInterval);
        clearInterval(timerInterval);
        btnStartGame.classList.remove('hidden');
        btnStartGame.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Main Lagi';
    };

    whackCells.forEach((cell, index) => {
        cell.addEventListener('mousedown', () => {
            if (!isGameRunning) return;
            if (index === currentBugPos) {
                gameScore++;
                gameScoreEl.innerText = gameScore;
                clearBugs();
                playBeep();

                if (gameScore > gameHighscore) {
                    gameHighscore = gameScore;
                    localStorage.setItem('whack_highscore', gameHighscore);
                    gameHighscoreEl.innerText = gameHighscore;
                }
            }
        });
    });

    btnStartGame.addEventListener('click', startGame);

    btnGame.addEventListener('click', () => {
        gameModal.classList.remove('hidden');
    });

    closeGameModal.addEventListener('click', () => {
        gameModal.classList.add('hidden');
        stopGame();
    });

    window.addEventListener('click', (e) => {
        if (e.target === infoModal) infoModal.classList.add('hidden');
        if (e.target === themeModal) themeModal.classList.add('hidden');
        if (e.target === gameModal) {
            gameModal.classList.add('hidden');
            stopGame();
        }
    });

    btnCheck.addEventListener('click', () => fetchServerData(false));
    inputServer.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') fetchServerData(false);
    });

    playerSearch.addEventListener('input', filterPlayers);

    // Pagination button events
    btnFirstPage.addEventListener('click', () => { currentPage = 1; renderPlayersPage(lastFilteredPlayers); });
    btnPrevPage.addEventListener('click',  () => { if (currentPage > 1) { currentPage--; renderPlayersPage(lastFilteredPlayers); } });
    btnNextPage.addEventListener('click',  () => {
        const totalPages = Math.ceil(lastFilteredPlayers.length / PAGE_SIZE);
        if (currentPage < totalPages) { currentPage++; renderPlayersPage(lastFilteredPlayers); }
    });
    btnLastPage.addEventListener('click', () => {
        currentPage = Math.ceil(lastFilteredPlayers.length / PAGE_SIZE);
        renderPlayersPage(lastFilteredPlayers);
    });

    // Show All toggle
    btnShowAll.addEventListener('click', () => {
        showAll = !showAll;
        if (showAll) {
            btnShowAll.innerHTML = '<i class="fa-solid fa-table-list"></i> Per Halaman';
            btnShowAll.classList.add('active-show-all');
        } else {
            btnShowAll.innerHTML = '<i class="fa-solid fa-list"></i> Semua';
            btnShowAll.classList.remove('active-show-all');
            currentPage = 1;
        }
        renderPlayersPage(lastFilteredPlayers);
    });
});
