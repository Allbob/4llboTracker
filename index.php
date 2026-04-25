<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>4llboTracker | FiveM Insight</title>
    <!-- Fonts -->
    <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;600;800&display=swap"
        rel="stylesheet">
    <link rel="stylesheet" href="assets/css/style.css">
    <!-- Icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>

<body>
    <div class="app-container">
        <header class="app-header">
            <img src="assets/img/RBL.png" alt="Logo" class="app-logo">
            <h1 class="brand-title">4llbo<span>Tracker</span></h1>
            <p class="subtitle" style="flex-grow: 1;">INFO KEHANCURAN !!!</p>
            <div class="header-actions" style="display: flex; gap: 15px; align-items: center; margin-left: auto;">
                <i class="fa-solid fa-sun header-icon" id="btnLightMode" title="Mode Terang"></i>
                <i class="fa-solid fa-gamepad header-icon" id="btnGame" title="Mini-game Anti Bosan"></i>
                <i class="fa-solid fa-palette header-icon" id="btnTheme" title="Ganti Tema"></i>
            </div>
        </header>

        <section class="server-search-section glass-panel">
            <div class="input-field-group">
                <i class="fa-solid fa-globe input-icon"></i>
                <input type="text" id="serverIpInput"
                    placeholder="Masukkan IP & Port (contoh: cfx.re/join/xxx atau 127.0.0.1:30120)">
                <button id="btnCheck" class="btn primary-btn"><i class="fa-solid fa-magnifying-glass"></i> Cek
                    Server</button>
            </div>

            <!-- Favorite Cards (VIP) -->
            <div class="fav-section hidden" id="favSection">
                <h4 class="fav-title"><i class="fa-solid fa-star"></i> Favorit server</h4>
                <div class="fav-cards-grid" id="favCardsContainer">
                    <!-- Cards injected by JS -->
                </div>
            </div>

            <!-- Recent Searches -->
            <div class="recent-searches hidden" id="recentSearches">
                <span style="font-size: 0.85rem; color: var(--text-muted); margin-right: 0.5rem;"><i
                        class="fa-solid fa-clock-rotate-left"></i> Riwayat Terakhir:</span>
                <div class="recent-tags" id="recentTags"></div>
            </div>

            <div id="errorMsg" class="error-msg hidden"><i class="fa-solid fa-circle-exclamation"></i> <span></span>
            </div>
            <div id="loading" class="loading-state hidden">
                <div class="loader"></div>
                <p>Sabar lgi Mengambil Data Dari Server anjg...</p>
            </div>
        </section>

        <!-- Server Dashboard -->
        <section id="serverDashboard" class="server-dashboard glass-panel hidden">
            <div class="dashboard-header">
                <div>
                    <h2><span id="sName">Server Name</span> <i id="btnFavorite" class="fa-regular fa-star action-icon"
                            title="Tambah ke Favorit"></i> <i id="btnInfo"
                            class="fa-solid fa-circle-info action-icon hidden" title="Detail Server"></i></h2>
                    <p class="s-ip" id="sIp">127.0.0.1:30120</p>
                    <div class="server-tags hidden" id="serverTags"></div>
                </div>
                <div class="dashboard-actions">
                    <div class="auto-refresh-wrapper">
                        <span class="auto-refresh-label">Live: <span id="refreshTimer"
                                class="time-left">15s</span></span>
                        <i class="fa-solid fa-satellite-dish" style="color: var(--primary);"></i>
                    </div>
                    <div class="badge status-online"><i class="fa-solid fa-signal"></i> Online</div>
                    <button id="btnJoin" class="btn primary-btn join-btn"><i class="fa-solid fa-play"></i> Join</button>
                </div>
            </div>

            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-icon"><img src="assets/img/skull.png" alt="Pemain Online"
                            style="width: 100%; height: 100%; object-fit: cover; border-radius: 2px;"></div>
                    <div class="kpi-info">
                        <span class="kpi-label">Pemain Online</span>
                        <div class="kpi-value"><span id="sOnline">0</span> <span class="kpi-max">/ <span
                                    id="sMax">0</span></span></div>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-icon"><img src="assets/img/gamepad.png" alt="Game Type"
                            style="width: 100%; height: 100%; object-fit: cover; border-radius: 2px;"></div>
                    <div class="kpi-info">
                        <span class="kpi-label">Game Type</span>
                        <div class="kpi-value" id="sGameType">-</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Player Checker -->
        <section id="playerSection" class="player-section glass-panel hidden">
            <div class="section-header">
                <h3><i class="fa-solid fa-users-viewfinder"></i> Daftar yang ada dikota.</h3>
                <div class="search-actions">
                    <div class="search-box">
                        <i class="fa-solid fa-search"></i>
                        <input type="text" id="playerSearch" placeholder="Cari Nama atau Nomor ID (Server ID)...">
                    </div>
                    <button id="btnShowAll" class="btn show-all-btn" title="Tampilkan semua player">
                        <i class="fa-solid fa-list"></i> Semua
                    </button>
                </div>
            </div>

            <!-- Player Count Info -->
            <div class="player-count-bar" id="playerCountBar">
                <span id="playerCountInfo"><i class="fa-solid fa-circle-dot" style="color:var(--primary);"></i> Menampilkan <b id="countShowing">0</b> dari <b id="countTotal">0</b> pemain</span>
            </div>

            <div class="table-wrapper">
                <table class="custom-table">
                    <thead>
                        <tr>
                            <th width="15%" class="sortable" data-sort="id">No ID <i class="fa-solid fa-sort"></i></th>
                            <th width="40%" class="sortable" data-sort="name">Nama Pemain <i
                                    class="fa-solid fa-sort"></i></th>
                            <th width="20%" class="sortable" data-sort="ping">Ping <i class="fa-solid fa-sort"></i></th>
                            <th width="25%">Identifiers</th>
                        </tr>
                    </thead>
                    <tbody id="playerTableBody">
                        <!-- Rows rendered by JS -->
                    </tbody>
                </table>
            </div>

            <!-- Pagination Controls -->
            <div class="pagination-bar" id="paginationBar">
                <button class="page-btn" id="btnFirstPage" title="Halaman Pertama"><i class="fa-solid fa-angles-left"></i></button>
                <button class="page-btn" id="btnPrevPage" title="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="page-numbers" id="pageNumbers"></div>
                <button class="page-btn" id="btnNextPage" title="Selanjutnya"><i class="fa-solid fa-chevron-right"></i></button>
                <button class="page-btn" id="btnLastPage" title="Halaman Terakhir"><i class="fa-solid fa-angles-right"></i></button>
                <span class="page-info">Hal <span id="currentPageLabel">1</span> / <span id="totalPagesLabel">1</span></span>
            </div>

            <div id="emptyPlayers" class="empty-state hidden">
                <i class="fa-solid fa-user-slash"></i>
                <p>GADAA orangnya anjing.</p>
            </div>
        </section>
    </div>

    <!-- Modal Detail Server -->
    <div id="infoModal" class="modal-overlay hidden">
        <div class="modal-content glass-panel">
            <div class="modal-header">
                <h3><i class="fa-solid fa-server"></i> Raw Server Metadata</h3>
                <i class="fa-solid fa-xmark close-modal" id="closeModal"></i>
            </div>
            <div class="modal-body" id="modalBody">
                <!-- Metadata rendered by JS -->
            </div>
        </div>
    </div>

    <!-- Theme Customizer Modal -->
    <div id="themeModal" class="modal-overlay hidden">
        <div class="modal-content glass-panel" style="max-width: 300px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-palette"></i> Pilih Tema</h3>
                <i class="fa-solid fa-xmark close-modal" id="closeThemeModal"></i>
            </div>
            <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px;">
                <button class="theme-btn premium-theme" data-color="#16a34a"
                    style="background: linear-gradient(135deg, rgba(22, 163, 74, 0.2), rgba(22, 163, 74, 0.8)); border-color: #16a34a;">
                    <div class="theme-swatch" style="background: #16a34a;"></div>
                    <span>Toxic Matrix</span>
                </button>
                <button class="theme-btn premium-theme" data-color="#8b5cf6"
                    style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.8)); border-color: #8b5cf6;">
                    <div class="theme-swatch" style="background: #8b5cf6;"></div>
                    <span>Neon Synth</span>
                </button>
                <button class="theme-btn premium-theme" data-color="#f43f5e"
                    style="background: linear-gradient(135deg, rgba(244, 63, 94, 0.2), rgba(244, 63, 94, 0.8)); border-color: #f43f5e;">
                    <div class="theme-swatch" style="background: #f43f5e;"></div>
                    <span>Blood Moon</span>
                </button>
                <button class="theme-btn premium-theme" data-color="#0ea5e9"
                    style="background: linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(51, 0, 255, 0.8)); border-color: #0ea5e9;">
                    <div class="theme-swatch" style="background: #5100ff;"></div>
                    <span>Deep Azure</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Mini-Game Modal -->
    <div id="gameModal" class="modal-overlay hidden">
        <div class="modal-content glass-panel" style="user-select: none; max-width: 400px;">
            <div class="modal-header">
                <h3><i class="fa-solid fa-bug"></i> Virus Smasher</h3>
                <i class="fa-solid fa-xmark close-modal" id="closeGameModal"></i>
            </div>
            <div class="modal-body" style="text-align: center;">
                <p style="color: var(--text-muted); font-size:0.9rem; margin-bottom: 1.5rem;">Klik Virus (<i
                        class="fa-solid fa-bug" style="color:var(--danger)"></i>) secepat mungkin sebelum kabur!</p>

                <div class="whack-grid" id="whackGrid">
                    <!-- 9 cells generated by JS or here -->
                    <div class="whack-cell" data-index="0"></div>
                    <div class="whack-cell" data-index="1"></div>
                    <div class="whack-cell" data-index="2"></div>
                    <div class="whack-cell" data-index="3"></div>
                    <div class="whack-cell" data-index="4"></div>
                    <div class="whack-cell" data-index="5"></div>
                    <div class="whack-cell" data-index="6"></div>
                    <div class="whack-cell" data-index="7"></div>
                    <div class="whack-cell" data-index="8"></div>
                </div>

                <div
                    style="margin-top:1.5rem; font-size:1.5rem; color:var(--primary); font-family:var(--font-mono); font-weight:bold;">
                    Score: <span id="gameScore">0</span>
                </div>
                <div style="margin-top:0.5rem; font-size:0.8rem; color:var(--text-muted);">
                    Time Left: <span id="gameTimeLeft" style="color: #fff; font-weight: bold;">30s</span> | Highscore:
                    <span id="gameHighscore">0</span>
                </div>

                <button id="btnStartGame" class="btn primary-btn"
                    style="width: 100%; margin-top: 1rem; justify-content: center;">
                    <i class="fa-solid fa-play"></i> Mulai Game
                </button>
            </div>
        </div>
    </div>

    <!-- Aesthetic Background Elements -->
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>

    <script src="assets/js/script.js"></script>
</body>

</html>
