require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    SlashCommandBuilder,
    REST,
    Routes,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActivityType,
    PermissionsBitField,
    AttachmentBuilder,
    Partials
} = require('discord.js');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'db_4llbotracker',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Path ke banner image
const BANNER_PATH = path.join(__dirname, 'RBL.png');

// Helper: buat attachment banner
const createBannerAttachment = () => {
    try {
        return new AttachmentBuilder(BANNER_PATH, { name: 'banner.png' });
    } catch {
        return null;
    }
};

// ==========================================
//  KONFIGURASI BOT
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN;
const OWNER_IDS = process.env.OWNER_IDS
    ? process.env.OWNER_IDS.split(',').map(id => id.trim())
    : ['606524787782713367'];
const OWNER_ID = OWNER_IDS[0]; // Primary owner untuk fallback log DM
const isOwner = (id) => OWNER_IDS.includes(id);
const SPY_LOG_CHANNEL = process.env.LOG_CHANNEL_ID || null; // Ambil dari .env nanti

// Inisialisasi config.json untuk Panel Admin
const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ allowedGuilds: [], dashboardMsgId: null, dashboardChannelId: null, licenses: {}, pendingKeys: [], statusText: null }, null, 4));
}
let botConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
if (botConfig.dashboardMsgId === undefined) botConfig.dashboardMsgId = null;
if (botConfig.dashboardChannelId === undefined) botConfig.dashboardChannelId = null;
if (botConfig.licenses === undefined) botConfig.licenses = {};
if (botConfig.pendingKeys === undefined) botConfig.pendingKeys = [];
if (botConfig.statusText === undefined) botConfig.statusText = null;

// Helper untuk update Dashboard lisensi secara real-time
const updateDashboard = async () => {
    if (!botConfig.dashboardChannelId || !botConfig.dashboardMsgId) return;
    try {
        const channel = await client.channels.fetch(botConfig.dashboardChannelId).catch(() => null);
        if (!channel) return;
        const msg = await channel.messages.fetch(botConfig.dashboardMsgId).catch(() => null);
        if (!msg) return;
        const guilds = Object.keys(botConfig.licenses || {});
        const list = guilds.map((id, i) => {
            const lic = botConfig.licenses[id];
            const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const priceStr = lic.price ? `Rp ${parseInt(lic.price).toLocaleString('id-ID')}` : 'Rp 20.000';
            return `**${i + 1}.** ID Server: \`${id}\` (Exp: \`${dateStr}\` • \`${priceStr}/bln\`)`;
        }).join('\n') || 'Belum ada klien aktif.';
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📌 Panel Dashboard Lisensi')
            .setDescription('Daftar server klien yang memiliki lisensi aktif:\n\n' + list)
            .setFooter({ text: 'Terakhir Diupdate • 4llboTracker' })
            .setTimestamp();

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_add_server').setLabel('Tambah Klien').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('btn_remove_server').setLabel('Hapus Klien').setStyle(ButtonStyle.Danger).setEmoji('➖'),
            new ButtonBuilder().setCustomId('btn_list_server').setLabel('Lihat Daftar').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
            new ButtonBuilder().setCustomId('btn_msg_owner').setLabel('Kirim Pesan').setStyle(ButtonStyle.Primary).setEmoji('💬')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_list_tx').setLabel('Daftar Transaksi').setStyle(ButtonStyle.Secondary).setEmoji('💸'),
            new ButtonBuilder().setCustomId('btn_genkey').setLabel('Buat Key').setStyle(ButtonStyle.Success).setEmoji('🔑'),
            new ButtonBuilder().setCustomId('btn_list_keys').setLabel('Daftar Key').setStyle(ButtonStyle.Secondary).setEmoji('🗂️')
        );

        await msg.edit({ embeds: [embed], components: [row1, row2] });
    } catch (e) {
        console.error('Gagal update dashboard:', e.message);
    }
};

const initConfigDatabase = async () => {
    if (!pool) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_settings (
                key_name VARCHAR(50) PRIMARY KEY,
                key_value TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS licenses (
                serverId VARCHAR(50) PRIMARY KEY,
                expiresAt VARCHAR(100),
                ownerId VARCHAR(50) NULL,
                price INT,
                duration INT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_keys (
                license_key VARCHAR(50) PRIMARY KEY,
                duration INT,
                price INT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_payments (
                txId VARCHAR(50) PRIMARY KEY,
                serverId VARCHAR(50),
                userId VARCHAR(50),
                amount INT,
                duration INT,
                status VARCHAR(20) DEFAULT 'PENDING',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS monitored_servers (
                ip VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255),
                channelId VARCHAR(50),
                lastOnline INT,
                lastMax INT,
                wasOnline BOOLEAN,
                messageId VARCHAR(50) NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ Tabel Lisensi & Config Database siap.');
    } catch (err) {
        console.error('❌ Gagal menyiapkan tabel database:', err.message);
    }
};

const loadConfigFromDb = async () => {
    if (!pool) return;
    try {
        const [settingsRows] = await pool.query('SELECT * FROM bot_settings');
        for (const row of settingsRows) {
            if (row.key_name === 'dashboardChannelId') botConfig.dashboardChannelId = row.key_value || null;
            if (row.key_name === 'dashboardMsgId') botConfig.dashboardMsgId = row.key_value || null;
            if (row.key_name === 'maintenanceMode') botConfig.maintenanceMode = (row.key_value === 'true');
            if (row.key_name === 'statusText') botConfig.statusText = row.key_value || null;
        }

        const [licenseRows] = await pool.query('SELECT * FROM licenses');
        botConfig.licenses = {};
        botConfig.allowedGuilds = [];
        for (const row of licenseRows) {
            botConfig.licenses[row.serverId] = {
                expiresAt: row.expiresAt,
                ownerId: row.ownerId,
                price: row.price,
                duration: row.duration
            };
            botConfig.allowedGuilds.push(row.serverId);
        }

        const [keyRows] = await pool.query('SELECT * FROM pending_keys');
        botConfig.pendingKeys = [];
        for (const row of keyRows) {
            botConfig.pendingKeys.push({
                key: row.license_key,
                duration: row.duration,
                price: row.price
            });
        }
        console.log('✅ Konfigurasi & Lisensi berhasil sinkron dari Database!');
    } catch (err) {
        console.error('❌ Gagal memuat konfigurasi dari database:', err.message);
    }
};

const saveConfig = async () => {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(botConfig, null, 4));
    } catch (e) {
        console.error('Gagal menulis backup config.json:', e.message);
    }

    if (pool) {
        try {
            await pool.query('INSERT INTO bot_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', 
                ['dashboardChannelId', botConfig.dashboardChannelId]);
            await pool.query('INSERT INTO bot_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', 
                ['dashboardMsgId', botConfig.dashboardMsgId]);
            await pool.query('INSERT INTO bot_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', 
                ['maintenanceMode', botConfig.maintenanceMode ? 'true' : 'false']);
            await pool.query('INSERT INTO bot_settings (key_name, key_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)', 
                ['statusText', botConfig.statusText]);

            await pool.query('DELETE FROM licenses');
            for (const [serverId, lic] of Object.entries(botConfig.licenses)) {
                await pool.query('INSERT INTO licenses (serverId, expiresAt, ownerId, price, duration) VALUES (?, ?, ?, ?, ?)',
                    [serverId, lic.expiresAt, lic.ownerId, lic.price, lic.duration]);
            }

            await pool.query('DELETE FROM pending_keys');
            for (const k of botConfig.pendingKeys) {
                await pool.query('INSERT INTO pending_keys (license_key, duration, price) VALUES (?, ?, ?)',
                    [k.key, k.duration, k.price]);
            }
        } catch (err) {
            console.error('❌ Gagal sinkronisasi config ke database:', err.message);
        }
    }

    await updateDashboard();
};

// Mengambil variabel GUILD_ID dari .env dan gabungkan dengan config.json
const getAllowedGuilds = () => {
    const envGuilds = process.env.GUILD_ID ? process.env.GUILD_ID.split(',').map(id => id.trim()).filter(id => id.length > 0) : [];
    const configGuilds = botConfig.allowedGuilds || [];
    return [...new Set([...envGuilds, ...configGuilds])];
};

// Helper untuk mengirim log pengintai ke DM owner pribadi DAN channel log server secara bersamaan
const sendSpyLog = async (payload) => {
    try {
        // 1. Selalu kirim ke DM Owner (pribadi)
        if (OWNER_ID) {
            const owner = await client.users.fetch(OWNER_ID).catch(() => null);
            if (owner) {
                if (typeof payload === 'string') {
                    await owner.send({ content: payload }).catch(() => null);
                } else {
                    await owner.send(payload).catch(() => null);
                }
            }
        }

        // 2. Kirim juga ke Channel Log Server (misal #log-bot) jika LOG_CHANNEL_ID diset dan bukan ID owner
        if (SPY_LOG_CHANNEL && SPY_LOG_CHANNEL !== OWNER_ID) {
            const channel = await client.channels.fetch(SPY_LOG_CHANNEL).catch(() => null);
            if (channel) {
                if (typeof payload === 'string') {
                    await channel.send({ content: payload }).catch(() => null);
                } else {
                    await channel.send(payload).catch(() => null);
                }
            }
        }
    } catch (e) {
        console.error('Gagal mengirim log pengintai:', e.message);
    }
};

// ==========================================
//  AUTOMATED BILLING & PAYMENT GATEWAY
// ==========================================
/**
 * Memproses callback pembayaran secara terpusat (real & simulasi)
 * @param {string} txId - ID Transaksi unik
 * @param {number} amount - Nominal unik yang dibayarkan
 * @param {string} provider - Provider gateway ('simulation', 'duitku', 'saweria', dll)
 * @returns {Promise<{success: boolean, error?: string, serverId?: string}>} Status pemrosesan
 */
const processPaymentNotification = async (txId, amount, provider = 'simulation') => {
    if (!pool) return { success: false, error: 'Koneksi database tidak tersedia.' };
    
    try {
        // 1. Cari data transaksi di database
        const [txs] = await pool.query('SELECT * FROM pending_payments WHERE txId = ?', [txId]);
        if (txs.length === 0) {
            return { success: false, error: 'Transaksi tidak ditemukan atau sudah kedaluwarsa/diproses.' };
        }

        const transaction = txs[0];

        // 2. Verifikasi nominal (opsional, jika provider real)
        if (amount && Math.abs(transaction.amount - amount) > 0) {
            return { success: false, error: `Nominal tidak sesuai. Diharapkan: Rp ${transaction.amount}, Diterima: Rp ${amount}` };
        }

        // 3. Update status transaksi
        await pool.query('UPDATE pending_payments SET status = "PAID" WHERE txId = ?', [txId]);

        // 4. Hitung masa aktif lisensi baru (Stacking)
        const duration = transaction.duration;
        let currentExpiry = Date.now();

        if (botConfig.licenses[transaction.serverId]) {
            const activeExpiry = new Date(botConfig.licenses[transaction.serverId].expiresAt).getTime();
            if (activeExpiry > Date.now()) {
                currentExpiry = activeExpiry;
            }
        }

        const newExpiry = new Date(currentExpiry + duration * 24 * 60 * 60 * 1000).toISOString();

        // 5. Update data lisensi di memori & allowedGuilds
        botConfig.licenses[transaction.serverId] = {
            expiresAt: newExpiry,
            ownerId: transaction.userId,
            price: transaction.amount,
            duration: duration
        };

        if (!botConfig.allowedGuilds.includes(transaction.serverId)) {
            botConfig.allowedGuilds.push(transaction.serverId);
        }

        // 6. Simpan konfigurasi (JSON, DB, dan update Dashboard)
        await saveConfig();

        // 7. Hapus transaksi pending agar tidak bisa double-claim
        await pool.query('DELETE FROM pending_payments WHERE txId = ?', [txId]);

        // 8. Kirim notifikasi sukses via DM Discord ke pembeli
        try {
            const user = await client.users.fetch(transaction.userId).catch(() => null);
            if (user) {
                const dateStr = new Date(newExpiry).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const successEmbed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('✅ Pembayaran Sukses & Lisensi Aktif!')
                    .setDescription(`Halo! Pembayaran Anda via **${provider.toUpperCase()}** telah berhasil diverifikasi secara otomatis oleh sistem.`)
                    .addFields(
                        { name: '📌 Server Tujuan', value: `ID Server: \`${transaction.serverId}\``, inline: true },
                        { name: '⏳ Masa Sewa Tambahan', value: `+${duration} Hari`, inline: true },
                        { name: '📆 Jatuh Tempo Baru', value: `\`${dateStr}\``, inline: false },
                        { name: '💰 Total Pembayaran', value: `Rp ${transaction.amount.toLocaleString('id-ID')}`, inline: true }
                    )
                    .setFooter({ text: '4llboTracker Automated Billing System' })
                    .setTimestamp();
                await user.send({ embeds: [successEmbed] });
            }
        } catch (e) {
            console.error('Gagal mengirim DM sukses ke user:', e.message);
        }

        // 9. Kirim Log Pengintai Ke Owner/Admin
        const spyEmbed = new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle('💰 Pemasukan Baru Masuk (Otomatis)')
            .setDescription(`Pembayaran otomatis via **${provider.toUpperCase()}** telah terverifikasi secara instan.`)
            .addFields(
                { name: 'Server Klien', value: `ID: \`${transaction.serverId}\``, inline: true },
                { name: 'Pembeli', value: `<@${transaction.userId}> (\`${transaction.userId}\`)`, inline: true },
                { name: 'Nominal Unik', value: `**Rp ${transaction.amount.toLocaleString('id-ID')}**`, inline: true },
                { name: 'Durasi Sewa', value: `${duration} Hari`, inline: true },
                { name: 'ID Transaksi', value: `\`${txId}\``, inline: true }
            )
            .setTimestamp();
        await sendSpyLog({ embeds: [spyEmbed] });

        return { success: true, serverId: transaction.serverId, userId: transaction.userId };

    } catch (err) {
        console.error('Gagal memproses pembayaran otomatis:', err.message);
        return { success: false, error: err.message };
    }
};

// HTTP Server untuk Uptime Monitor & Webhook Pembayaran
const http = require('http');
const url = require('url');
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (req.method === 'GET' && (parsedUrl.pathname === '/ping' || parsedUrl.pathname === '/')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('PONG');
    } else if (req.method === 'POST' && parsedUrl.pathname === '/webhook/payment') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                console.log('[WEBHOOK] Callback pembayaran diterima:', payload);

                // Mendukung payload Duitku (merchantOrderId, amount) & Saweria (transaction_id, amount_raw)
                const txId = payload.txId || payload.merchantOrderId || payload.transaction_id;
                const amount = parseInt(payload.amount || payload.amount_raw) || 0;
                
                if (!txId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: 'txId tidak ditemukan dalam payload.' }));
                }

                const result = await processPaymentNotification(txId, amount, payload.provider || 'gateway');
                
                if (result.success) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Lisensi berhasil diaktifkan secara otomatis!' }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: result.error }));
                }
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Gagal parsing payload webhook.' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});
server.listen(process.env.PORT || 8080, () => {
    console.log(`🌐 HTTP Server running on port ${process.env.PORT || 8080} for Uptime Monitor & Payment Webhook`);
});

// Helper untuk menjadwalkan Laporan Harian (Daily Heartbeat) ke DM Owner
const scheduleDailyHeartbeat = () => {
    const now = new Date();
    // Jadwalkan untuk jam 00:00:00
    const nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const timeUntilNextRun = nextRun - now;

    setTimeout(async () => {
        try {
            const uptime = process.uptime();
            const days = Math.floor(uptime / (24 * 3600));
            const hours = Math.floor((uptime % (24 * 3600)) / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            const stats = `📈 **Laporan Harian Bot 4llboTracker**\n\n` +
                `• **Uptime:** \`${days} Hari ${hours} Jam ${minutes} Menit\`\n` +
                `• **Server Klien Aktif:** \`${getAllowedGuilds().length} Server\`\n` +
                `• **Total Server Bot:** \`${client.guilds.cache.size} Server\`\n` +
                `• **Total Pengguna:** \`${client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)} Members\`\n` +
                `• **Status Database:** ${pool ? '🟢 Terhubung' : '🔴 Terputus'}\n\n` +
                `Semua sistem berjalan normal!`;

            const owner = await client.users.fetch(OWNER_ID).catch(() => null);
            if (owner) await owner.send(stats);
        } catch (e) {
            console.error('Gagal mengirim heartbeat harian:', e.message);
        }
        scheduleDailyHeartbeat(); // Jadwalkan lagi untuk besoknya
    }, timeUntilNextRun);
};

// Helper untuk memeriksa masa aktif lisensi (Sistem Tagihan & Berlangganan)
const checkLicenses = async () => {
    const now = Date.now();
    const guilds = [...botConfig.allowedGuilds];
    let changed = false;

    for (const guildId of guilds) {
        const lic = botConfig.licenses[guildId];
        if (!lic) continue;

        const expiresAt = new Date(lic.expiresAt).getTime();
        const timeLeft = expiresAt - now;

        if (timeLeft <= 0) {
            console.log(`[LICENSING] Lisensi untuk server ${guildId} telah habis. Menonaktifkan akses...`);
            botConfig.allowedGuilds = botConfig.allowedGuilds.filter(id => id !== guildId);
            delete botConfig.licenses[guildId];
            changed = true;

            // Kirim info penonaktifan ke owner server klien jika terdaftar
            if (lic.ownerId) {
                try {
                    const ownerUser = await client.users.fetch(lic.ownerId).catch(() => null);
                    if (ownerUser) {
                        const embed = new EmbedBuilder()
                            .setColor(0xf04747)
                            .setTitle('❌ Layanan 4llboTracker Berakhir')
                            .setDescription(`Masa sewa bot **4llboTracker** untuk server Anda (ID: \`${guildId}\`) telah berakhir.\nLayanan dan fitur monitoring di server Anda telah dinonaktifkan secara otomatis.\n\nUntuk memperpanjang sewa dan mengaktifkan kembali fiturnya, silakan hubungi Developer bot.`)
                            .setTimestamp();
                        await ownerUser.send({ embeds: [embed] });
                    }
                } catch (e) {
                    console.error('Gagal mengirim info expired ke owner server:', e.message);
                }
            }

            // Kirim pesan penonaktifan ke server (bot tidak keluar)
            try {
                const guild = await client.guilds.fetch(guildId).catch(() => null);
                if (guild) {
                    const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                    if (channel) {
                        await channel.send('⚠️ **Masa Sewa Berakhir!** Masa sewa bot ini telah berakhir. Seluruh fitur monitoring telah dinonaktifkan. Silakan hubungi pemilik bot untuk memperpanjang sewa.');
                    }
                }
            } catch (err) {
                console.error(`Gagal mengirim pesan expired ke guild ${guildId}:`, err.message);
            }

            // Kirim laporan spy log ke admin
            await sendSpyLog(`❌ **Lisensi Habis:** Lisensi server \`${guildId}\` telah berakhir. Akses dinonaktifkan (Bot tidak keluar dari server).`);
        }

        // 2. Pengingat H-1 (Sisa waktu <= 24 jam)
        else if (timeLeft > 0 && timeLeft <= 24 * 60 * 60 * 1000) {
            if (lic.ownerId && !lic.remindedH1) {
                try {
                    const ownerUser = await client.users.fetch(lic.ownerId).catch(() => null);
                    if (ownerUser) {
                        const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const embed = new EmbedBuilder()
                            .setColor(0xfaa61a)
                            .setTitle('⚠️ Peringatan Jatuh Tempo Besok (H-1)')
                            .setDescription(`Masa sewa bot **4llboTracker** untuk server Anda (ID: \`${guildId}\`) akan habis besok pada tanggal **${dateStr}**.\n\nSegera hubungi pemilik bot untuk melakukan perpanjangan sewa agar layanan tidak terputus.`)
                            .setTimestamp();
                        await ownerUser.send({ embeds: [embed] });
                        lic.remindedH1 = true;
                        changed = true;
                    }
                } catch (e) { }
            }
        }
        // 3. Pengingat H-3 (Sisa waktu <= 3 hari)
        else if (timeLeft > 0 && timeLeft <= 3 * 24 * 60 * 60 * 1000) {
            if (lic.ownerId && !lic.remindedH3) {
                try {
                    const ownerUser = await client.users.fetch(lic.ownerId).catch(() => null);
                    if (ownerUser) {
                        const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const embed = new EmbedBuilder()
                            .setColor(0x5865F2)
                            .setTitle('⚠️ Peringatan Jatuh Tempo (H-3)')
                            .setDescription(`Masa sewa bot **4llboTracker** untuk server Anda (ID: \`${guildId}\`) tersisa **3 hari lagi** (Jatuh tempo: **${dateStr}**).\n\nSilakan hubungi pemilik bot untuk memperpanjang sewa.`)
                            .setTimestamp();
                        await ownerUser.send({ embeds: [embed] });
                        lic.remindedH3 = true;
                        changed = true;
                    }
                } catch (e) { }
            }
        }
    }

    if (changed) {
        saveConfig();
    }
};

// Deteksi Error Fatal / Crash agar langsung kirim DM ke Owner
process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled Rejection:', reason);
    try {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (owner) {
            await owner.send(`🚨 **CRASH ALERT / FATAL ERROR DETECTED!**\n\`\`\`js\n${String(reason).substring(0, 1800)}\n\`\`\``);
        }
    } catch (e) { }
});
const MONITOR_CHANNEL_ID = process.env.MONITOR_CHANNEL_ID;
const MONITOR_INTERVAL = (parseInt(process.env.MONITOR_INTERVAL_MINUTES) || 5) * 60 * 1000;

if (!TOKEN) {
    console.error('❌ DISCORD_TOKEN tidak ditemukan di file .env!');
    process.exit(1);
}

// ==========================================
//  WARNA & EMOJI
// ==========================================
const COLORS = {
    primary: 0x2b2d31,   // Dark embed — warna utama semua embed
    online: 0x43b581,    // Hijau elegan
    offline: 0xf04747,   // Merah
    warn: 0xfaa61a,      // Kuning/Orange
    info: 0x5865F2,      // Blurple Discord
    dark: 0x1a1a2e,      // Sangat gelap
    accent: 0x00d4aa,    // Accent hijau neon
    search: 0x5865F2,    // Warna pencarian
};

const EMOJI = {
    online: '🟢',
    offline: '🔴',
    players: '👤',
    build: '🛠️',
    location: '🌐',
    ping: '📶',
    loading: '⏳',
    star: '⭐',
    warning: '⚠️',
    join: '🎮',
    info: 'ℹ️',
    page: '📋',
    discord: '💬',
    server: '🖥️',
    search: '🔍',
};

// Signal bars berdasarkan ping (seperti di screenshot)
const getPingBars = (ping) => {
    if (ping < 50) return '▐▐▐▐▐';
    if (ping < 100) return '▐▐▐▐';
    if (ping < 150) return '▐▐▐';
    if (ping < 250) return '▐▐';
    return '▐';
};

const getPingColor = (ping) => {
    if (ping < 50) return '🟢';
    if (ping < 100) return '🟡';
    if (ping < 150) return '🟠';
    return '🔴';
};

// ==========================================
//  ANIMASI LOADING SYSTEM
// ==========================================
const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
const LOADING_BARS = [
    '▱▱▱▱▱▱▱▱▱▱',
    '▰▱▱▱▱▱▱▱▱▱',
    '▰▰▱▱▱▱▱▱▱▱',
    '▰▰▰▱▱▱▱▱▱▱',
    '▰▰▰▰▱▱▱▱▱▱',
    '▰▰▰▰▰▱▱▱▱▱',
    '▰▰▰▰▰▰▱▱▱▱',
    '▰▰▰▰▰▰▰▱▱▱',
    '▰▰▰▰▰▰▰▰▱▱',
    '▰▰▰▰▰▰▰▰▰▱',
    '▰▰▰▰▰▰▰▰▰▰',
];

/**
 * Jalankan animasi spinner di sebuah message/reply Discord.
 * @param {Object} target - Objek dengan method .edit()
 * @param {Function} buildEmbed - (frame, bar, step) => EmbedBuilder
 * @param {number} steps - Jumlah frame animasi (default 8)
 * @param {number} delay - Delay antar frame dalam ms (default 400)
 * @returns {Promise<void>}
 */
const runLoadingAnimation = async (target, buildEmbed, steps = 10, delay = 350) => {
    for (let i = 0; i < steps; i++) {
        const spinChar = SPINNER_FRAMES[i % SPINNER_FRAMES.length];
        const bar = LOADING_BARS[Math.min(i, LOADING_BARS.length - 1)];
        try {
            await target.edit({ embeds: [buildEmbed(spinChar, bar, i)], components: [] });
        } catch (_) { break; }
        await new Promise(r => setTimeout(r, delay));
    }
};

/**
 * Animasi dots sederhana untuk prefix command (!command) — edit pesan beberapa kali.
 * @param {Object} msg - Discord message object dengan .edit()
 * @param {string} baseText - Teks dasar sebelum dots
 * @param {number} cycles - Berapa kali ulang animasi
 */
const runDotAnimation = async (msg, baseText, cycles = 4) => {
    const dotStates = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    for (let i = 0; i < cycles * dotStates.length; i++) {
        try {
            await msg.edit(`${dotStates[i % dotStates.length]} ${baseText}`);
        } catch (_) { break; }
        await new Promise(r => setTimeout(r, 120));
    }
};

// Daftar server yang di-monitor (disimpan di memori, bisa kamu ganti ke database)
const monitoredServers = new Map(); // key: ip, value: { lastStatus, name, lastPlayerCount }

// ==========================================
//  DAFTAR SERVER SHORTCUT (Alias)
// ==========================================
const SERVER_ALIASES = {
    // Halaman 1
    'idp': { name: 'IDP', cfx: 'bak4pl' },
    'exe': { name: 'EXECUTIVE 2.0', cfx: 'roek67' },
    'kb': { name: 'KOTABARU', cfx: 'mez5p7' },
    'nv': { name: 'NUSA V INDONESIA', cfx: 'ele3bm' },
    'jing': { name: 'JING ARENA INDONESIA', cfx: '53k9ra' },
    'v3': { name: 'V3 PVP', cfx: 'y84779' },
    'boz': { name: 'BOZ', cfx: '8z49xm' },
    'soi': { name: 'STATE OF INDONESIA', cfx: 'jygd5m' },
    'kotkit': { name: 'KOTAKITA', cfx: 'r35px8' },
    'ime': { name: 'IME RP', cfx: 'zrvmg4' },
    'bersamav2': { name: 'BERSAMA V2', cfx: 'lqzmjv' },
    'ceritakita': { name: 'CERITA KITA', cfx: 'zxmea5' },
    'nuestro': { name: 'NUESTRO', cfx: 'kb86br' },
    'indozone': { name: 'INDOZONE', cfx: 'jadyla' },
    'hope': { name: 'HOPE', cfx: 'ymzj4j' },
    'glorix': { name: 'Town Glorix', cfx: 'bjyd8b' },
    'abrp': { name: 'ABRP', cfx: 'pm88d7' },
    'victoria': { name: 'VICTORIA RP', cfx: '3qjvrz' },
    'mercy': { name: 'MERCY', cfx: 'xj9l5r' },
    'satumimpi': { name: 'SATU MIMPI', cfx: '3e3gdb' },
    'kotabaru': { name: 'KOTABARU', cfx: 'mez5p7' },
    'lp': { name: 'LAST PARADISE RP', cfx: 'eql83a' },
    'amora': { name: 'AMORA STATE INDONESIA', cfx: 'lk6x85' },
    'senpai': { name: 'SENPAI FAMS PVP', cfx: 'amydz5' },
    'origami': { name: 'ORIGAMI RP', cfx: 'plj9dy' },
    'noctis': { name: 'NOCTIS', cfx: '8r5lp3' },
    'sentra': { name: 'SENTRA NUSANTARA', cfx: '3m5opb' },
    '69': { name: 'SixNine V2', cfx: 'qldge6' },
    'senjakala': { name: 'SEMJAKALA', cfx: 'z5oaqp' },
    'ourglory': { name: 'OUR GLORY', cfx: '55k88a' },
    'daydream': { name: 'DayDream', cfx: '4zqglv' },
    'kampoeng': { name: 'KAMPOENG', cfx: '55kd96' },
    'cakra': { name: 'CAKRA UNION', cfx: 'yo7g9y' },
    'retorika': { name: 'RETORIKA', cfx: '6j4z5j' },
    'cakrawala': { name: 'CAKRAWALA - RedM', cfx: '85mo8v' },
    'blackcard': { name: 'BLACKCARD', cfx: 'okyqjr' },
    'dirgantara': { name: 'DIRGANTARA', cfx: 'b7334d' },
    'indohope': { name: 'INDOHOPE ROLEPLAY', cfx: 'r4ragg' },
    'nexoracity': { name: 'NEXORA CITY', cfx: 'ok3937' },
    'storyofmilagro': { name: 'STORY OF MILAGRO', cfx: '893d83' },
    'semart': { name: 'SEMART', cfx: '7qrv5r' },
    'tanahadat': { name: 'TANAH ADAT', cfx: 'xmb53r' },
    'kerta969arena': { name: 'KERTA 969 ARENA', cfx: 'mxk58q' },
    'union': { name: 'UNION STATE', cfx: '8rpblv' },
    'morpid': { name: 'MORP INDONESIA', cfx: '6j4z5j' },
    'astra': { name: 'ASTRA', cfx: 'okd34r' },
    'solaris': { name: 'SOLARIS', cfx: 'da5dzj' },
    'cerita': { name: 'CERITA ROLEPLAY', cfx: 'mxy859' },
    'cr': { name: 'CR ROLEPLAY', cfx: 'kr7k7d' },
    'memories': { name: 'MEMORIES', cfx: 'lk6x85' },
    'cemara': { name: 'CEMARA', cfx: '4odvg5' },

    // Server Tambahan Baru
    'garuda': { name: 'GARUDA PRIME', cfx: 'vgaqm5' },
    'kisahnusantara': { name: 'KISAH NUSANTARA', cfx: 'gad5d7z' },
    'rumahkita': { name: 'RUMAH KITA', cfx: 'bdx4lql' },
    'coffeeshop': { name: 'COFFEE SHOP 45', cfx: 'javo7a' },
    'townshine': { name: 'TOWNSHINE ROLEPLAY', cfx: '5oyegr7' },
    'kisahbaru': { name: 'KISAH BARU ROLEPLAY', cfx: 'vagdok' },
    'mandara': { name: 'MANDARA ROLEPLAY', cfx: 'yozody' },
    'xavion': { name: 'XAVION ROLEPLAY', cfx: '4mmb8v' },
    'paleto': { name: 'PALETO RACEWAY', cfx: 'adla85' }
};

// ==========================================
//  FUNGSI HELPER - AMBIL DATA FIVEM
// ==========================================
const stripColors = (text) => {
    if (!text) return 'Unknown';
    return text.replace(/\^[0-9]/g, '').trim();
};

const processSingleServerData = (data, cfxCode, ip) => {
    const info = data.Data;
    const players = info.players || [];
    const online = info.clients !== undefined ? info.clients : players.length;
    const max = info.sv_maxclients || info.vars?.sv_maxClients || 32;

    return {
        success: true,
        name: stripColors(info.hostname || info.vars?.sv_projectName || 'Unknown Server'),
        desc: info.vars?.sv_projectDesc || '',
        online: parseInt(online),
        max: parseInt(max),
        gametype: info.gametype || info.vars?.gametype || 'Freeroam/Roleplay',
        tags: info.vars?.tags || '',
        discord: info.vars?.Discord || info.vars?.discord || '',
        ip: ip,
        cfxCode,
        players: players, // Ambil SELURUH pemain tanpa dipotong
        isCfx: true,
        vars: info.vars || {}
    };
};

const fetchServerData = async (ip) => {
    let cfxCode = null;

    // Bersihkan URL jika ada
    ip = ip.replace(/^https?:\/\//, '');

    // Cek apakah input adalah alias server yang terdaftar (Smart Search)
    const aliasKey = ip.toLowerCase().replace(/\s+/g, ''); // Hapus spasi untuk pencocokan singkatan/nama

    if (SERVER_ALIASES[aliasKey]) {
        cfxCode = SERVER_ALIASES[aliasKey].cfx;
    } else if (ip.includes('cfx.re/join/')) {
        cfxCode = ip.split('cfx.re/join/')[1].split('/')[0];
    } else if (/^[a-zA-Z0-9]{6}$/.test(ip)) {
        cfxCode = ip;
    } else if (!ip.includes(':') && !ip.includes('.')) {
        // Karena API pencarian FiveM ditutup, kita cari secara lokal di daftar SERVER_ALIASES
        for (const [key, data] of Object.entries(SERVER_ALIASES)) {
            const dataNameClean = data.name.toLowerCase().replace(/\s+/g, '');
            // Jika nama penuh server mengandung input, atau input mirip dengan alias
            if (dataNameClean.includes(aliasKey) || key.includes(aliasKey) || aliasKey.includes(key) ||
                (aliasKey === 'ckrp' && key === 'ceritakita') ||
                (aliasKey === 'idp' && key === 'idp')
            ) {
                // Hardcode tambahan alias ckrp
                cfxCode = data.cfx;
                break;
            }
        }

        if (!cfxCode && aliasKey === 'ckrp') cfxCode = 'zxmea5'; // Fallback ceritakita

        if (!cfxCode) {
            return { success: false, error: `Server "${ip}" tidak ditemukan di database. Pastikan nama sesuai daftar atau gunakan link CFX.` };
        }
    }

    try {
        let actualIp = ip;

        // Resolve CFX code ke IP Address
        if (cfxCode) {
            const joinRes = await fetch(`https://cfx.re/join/${cfxCode}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 10000
            });
            const citizenUrl = joinRes.headers.get('x-citizenfx-url');
            if (citizenUrl) {
                actualIp = citizenUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            } else {
                throw new Error('Kode CFX tidak valid atau server offline.');
            }
        }

        if (!actualIp.includes(':')) actualIp += ':30120';
        actualIp = actualIp.replace(/^https?:\/\//, '');

        // Direct fetch ke server, tidak pakai proxy allorigins karena bot bypass CORS otomatis
        const controllerInfo = new AbortController();
        const timeoutInfo = setTimeout(() => controllerInfo.abort(), 15000);
        const infoRes = await fetch(`http://${actualIp}/info.json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controllerInfo.signal
        });
        clearTimeout(timeoutInfo);

        if (!infoRes.ok) throw new Error(`Gagal menghubungi server HTTP ${infoRes.status}`);
        const infoNode = await infoRes.json();

        const controllerPlayers = new AbortController();
        const timeoutPlayers = setTimeout(() => controllerPlayers.abort(), 15000);
        const playersRes = await fetch(`http://${actualIp}/players.json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controllerPlayers.signal
        });
        clearTimeout(timeoutPlayers);

        const players = playersRes.ok ? await playersRes.json() : [];

        return {
            success: true,
            name: stripColors(infoNode.vars?.sv_projectName || infoNode.vars?.sv_hostname || 'Unknown Server'),
            desc: infoNode.vars?.sv_projectDesc || '',
            online: players.length,
            max: parseInt(infoNode.vars?.sv_maxClients || 32),
            gametype: infoNode.vars?.gametype || 'Freeroam/Roleplay',
            tags: infoNode.vars?.tags || '',
            discord: infoNode.vars?.Discord || infoNode.vars?.discord || '',
            ip: actualIp,
            cfxCode: cfxCode,
            players: players, // Ambil SELURUH pemain tanpa dipotong
            isCfx: !!cfxCode,
            vars: infoNode.vars || {}
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

// ==========================================
//  BUILD EMBED - STATUS SERVER
// ==========================================
const buildServerEmbed = (data, isFull = false) => {
    const pct = Math.round((data.online / data.max) * 100);
    let color = COLORS.primary;
    if (data.online === 0) color = COLORS.dark;

    // Ambil build version dari vars
    const buildVersion = data.vars?.sv_version || data.vars?.sv_build || '-';
    const locale = data.vars?.locale || data.vars?.sv_locale || 'id-ID';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`#${data.name}`)
        .setDescription(data.desc ? `> ${data.desc.substring(0, 200)}` : '')
        .addFields(
            {
                name: `${EMOJI.players} Jumlah Pemain`,
                value: `**${data.online}/${data.max}**`,
                inline: true
            },
            {
                name: `${EMOJI.build} Versi Build`,
                value: `**${buildVersion}**`,
                inline: true
            },
            {
                name: `${EMOJI.location} Lokasi`,
                value: `**${locale}**`,
                inline: true
            }
        )
        .setFooter({ text: '4llboTracker • Data real-time dari FiveM API' })
        .setTimestamp();

    if (data.tags) {
        const tagList = data.tags.split(',').slice(0, 6).map(t => `\`${t.trim()}\``).join(' ');
        embed.addFields({ name: '🏷️ Tags', value: tagList || '-', inline: false });
    }

    if (data.discord) {
        embed.addFields({ name: `${EMOJI.discord} Discord`, value: data.discord.startsWith('http') ? data.discord : `https://${data.discord}`, inline: false });
    }

    if (isFull && data.players.length > 0) {
        const sorted = [...data.players].sort((a, b) => a.id - b.id);
        const playerList = sorted
            .slice(0, 15)
            .map(p => {
                const safeName = stripColors(p.name).substring(0, 20);
                const bars = getPingBars(p.ping);
                return `**${String(p.id).padStart(4, ' ')}  ${safeName}** \`${p.ping}ms\` ${bars}`;
            })
            .join('\n');
        const remaining = sorted.length > 15 ? `\n\n*...dan ${sorted.length - 15} pemain lainnya. Gunakan \`/pemain\` untuk melihat semua.*` : '';
        embed.addFields({ name: `${EMOJI.page} Pemain Online (${data.players.length})`, value: playerList + remaining, inline: false });
    }

    // Tambahkan banner image
    embed.setImage('attachment://banner.png');

    return embed;
};

// ==========================================
//  REGISTRASI SLASH COMMANDS
// ==========================================
const publicCommands = [
    new SlashCommandBuilder()
        .setName('cek')
        .setDescription('Cek status server FiveM')
        .addStringOption(opt =>
            opt.setName('server')
                .setDescription('IP server atau link CFX (contoh: cfx.re/join/xxxxxx atau 127.0.0.1:30120)')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('pemain')
        .setDescription('Lihat daftar pemain yang online di server FiveM')
        .addStringOption(opt =>
            opt.setName('server')
                .setDescription('IP server atau link CFX')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('monitor')
        .setDescription('Pantau server FiveM secara otomatis di channel ini')
        .addStringOption(opt =>
            opt.setName('server')
                .setDescription('IP server atau link CFX yang ingin dipantau')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('stopmonitor')
        .setDescription('Hentikan pemantauan server FiveM')
        .addStringOption(opt =>
            opt.setName('server')
                .setDescription('IP server yang ingin dihentikan pemantauannya')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('daftarmonitor')
        .setDescription('Lihat semua server yang sedang dipantau'),

    new SlashCommandBuilder()
        .setName('cariserver')
        .setDescription('Cari server FiveM berdasarkan nama')
        .addStringOption(opt =>
            opt.setName('nama')
                .setDescription('Nama server yang ingin dicari')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Tampilkan semua perintah bot 4llboTracker'),

    new SlashCommandBuilder()
        .setName('support')
        .setDescription('Kirim keluhan/pertanyaan langsung ke Owner Bot')
        .addStringOption(opt =>
            opt.setName('pesan')
                .setDescription('Tulis pertanyaan atau bantuan yang Anda butuhkan')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('sewa')
        .setDescription('Melihat status lisensi server ini dan cara berlangganan bot'),

    new SlashCommandBuilder()
        .setName('subscription')
        .setDescription('Melihat status lisensi server ini dan cara berlangganan bot'),

    new SlashCommandBuilder()
        .setName('beli-lisensi')
        .setDescription('Sewa lisensi premium bot 4llboTracker secara instan lewat QRIS')
        .addIntegerOption(opt =>
            opt.setName('durasi')
                .setDescription('Pilih durasi masa sewa lisensi')
                .setRequired(true)
                .addChoices(
                    { name: '30 Hari - Rp 20.000', value: 30 },
                    { name: '90 Hari - Rp 50.000', value: 90 },
                    { name: '365 Hari - Rp 180.000', value: 365 }
                )
        ),

    new SlashCommandBuilder()
        .setName('bayar')
        .setDescription('Mengaktifkan subscription dengan mengunggah bukti transfer pembayaran QRIS')
        .addAttachmentOption(opt =>
            opt.setName('bukti')
                .setDescription('Unggah foto/screenshot bukti pembayaran QRIS')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('activate')
        .setDescription('Mengaktifkan bot di server ini menggunakan kode lisensi')
        .addStringOption(opt =>
            opt.setName('kode')
                .setDescription('Masukkan kode lisensi (contoh: 4LLBO-XXXX-XXXX)')
                .setRequired(true)
        ),
].map(cmd => cmd.toJSON());

const ownerCommands = [
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('(Khusus Owner) Buka Panel Admin Discord'),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('(Khusus Owner) Kirim pengumuman ke semua server')
        .addStringOption(opt =>
            opt.setName('pesan')
                .setDescription('Pesan pengumuman yang ingin dikirim')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('(Khusus Owner) Lihat statistik performa bot'),

    new SlashCommandBuilder()
        .setName('setup-dashboard')
        .setDescription('(Khusus Owner) Setup panel dashboard lisensi di channel ini'),

    new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('(Khusus Owner) Mengaktifkan/menonaktifkan mode pemeliharaan (maintenance)'),

    new SlashCommandBuilder()
        .setName('genkey')
        .setDescription('(Khusus Owner) Membuat kode lisensi baru untuk disewakan')
        .addIntegerOption(opt =>
            opt.setName('hari')
                .setDescription('Durasi masa aktif lisensi dalam hari (contoh: 30)')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('harga')
                .setDescription('Harga sewa lisensi per bulan (Rupiah)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('announce-guild')
        .setDescription('(Khusus Owner) Kirim pengumuman ke server klien tertentu')
        .addStringOption(opt =>
            opt.setName('server_id')
                .setDescription('ID server Discord klien')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('pesan')
                .setDescription('Isi pengumuman')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('backup')
        .setDescription('(Khusus Owner) Mengirimkan file backup config ke DM Anda'),

    new SlashCommandBuilder()
        .setName('set-status')
        .setDescription('(Khusus Owner) Mengubah status tulisan aktivitas bot')
        .addStringOption(opt =>
            opt.setName('teks')
                .setDescription('Status aktivitas baru bot')
                .setRequired(true)
        ),
].map(cmd => cmd.toJSON());

const registerCommands = async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const adminGuildId = process.env.GUILD_ID ? process.env.GUILD_ID.split(',')[0].trim() : null;

    try {
        console.log('⏳ Mendaftarkan slash commands...');

        // Daftarkan ke semua server tempat bot berada saat ini secara instan
        const guilds = client.guilds.cache.map(guild => guild.id);
        for (const guildId of guilds) {
            try {
                let body = [...publicCommands];
                if (guildId === adminGuildId) {
                    body = [...publicCommands, ...ownerCommands];
                }
                await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
                console.log(`✅ Slash commands didaftarkan ke server: ${guildId} (${guildId === adminGuildId ? 'Owner + Public' : 'Public Only'})`);
            } catch (e) {
                console.error(`❌ Gagal mendaftarkan ke server: ${guildId}`, e.message);
            }
        }

        // Daftarkan juga secara global (hanya public commands agar klien & DM bersih dari command owner)
        await rest.put(Routes.applicationCommands(client.user.id), { body: publicCommands });
        console.log('✅ Slash commands berhasil didaftarkan secara global!');
    } catch (err) {
        console.error('❌ Gagal mendaftarkan commands:', err);
    }
};

// ==========================================
//  INISIALISASI CLIENT DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // <-- Membaca isi pesan
        GatewayIntentBits.DirectMessages, // <-- Membaca pesan di DM
    ],
    partials: [Partials.Channel, Partials.Message] // <-- Wajib untuk DM
});

client.once('ready', async () => {
    console.log(`\n🎮 4llboTracker Bot Online!`);
    console.log(`👤 Login sebagai: ${client.user.tag}`);
    console.log(`📡 Terhubung ke ${client.guilds.cache.size} server Discord\n`);

    // Inisialisasi & sinkronkan konfigurasi lisensi dari database MySQL
    await initConfigDatabase();
    await loadConfigFromDb();

    client.user.setActivity(botConfig.statusText || '/help & !help untuk panduan yawwww🤏🏻😜', { type: ActivityType.Listening });

    await registerCommands();

    // Load dari database
    try {
        const [rows] = await pool.query('SELECT * FROM monitored_servers');
        for (const row of rows) {
            monitoredServers.set(row.ip, {
                name: row.name,
                channelId: row.channelId,
                lastOnline: row.lastOnline,
                lastMax: row.lastMax,
                wasOnline: Boolean(row.wasOnline),
                messageId: row.messageId
            });
        }
        console.log(`✅ Berhasil memuat ${rows.length} server dari database.`);
    } catch (err) {
        console.error('❌ Gagal memuat database:', err.message);
    }

    // Mulai monitoring otomatis jika MONITOR_CHANNEL_ID diset
    if (MONITOR_CHANNEL_ID && monitoredServers.size > 0) {
        startMonitorLoop();
    }

    // Inisialisasi schedule harian & update panel dashboard lisensi saat bot menyala
    scheduleDailyHeartbeat();
    updateDashboard();

    // Jalankan pemeriksaan lisensi dan setel interval 6 jam
    await checkLicenses();
    setInterval(checkLicenses, 6 * 60 * 60 * 1000);
});

// Event ketika bot dimasukkan ke server baru
client.on('guildCreate', async (guild) => {
    console.log(`📥 Bot ditambahkan ke server baru: ${guild.name} (ID: ${guild.id})`);

    const allowedGuilds = getAllowedGuilds();
    const isWhitelisted = allowedGuilds.length === 0 || allowedGuilds.includes(guild.id);

    if (!isWhitelisted) {
        // Kirim pesan peringatan ke channel pertama yang bisa dikirimi pesan
        try {
            const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
            if (channel) {
                await channel.send('❌ **Akses Ditolak!** Server ini belum memiliki lisensi aktif untuk menggunakan bot **4llboTracker**.\nSilakan hubungi Developer (@4llbob) untuk mendapatkan lisensi.\n\n*Bot akan otomatis keluar dari server ini dalam 10 detik...*');
            }
        } catch (e) { }

        // Kirim log spy ke owner
        if (SPY_LOG_CHANNEL) {
            try {
                const owner = await guild.fetchOwner().catch(() => null);
                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('🚨 Upaya Undangan Tanpa Lisensi!')
                    .setDescription(`Bot diundang ke server ilegal dan akan otomatis keluar (leave).`)
                    .addFields(
                        { name: 'Nama Server', value: guild.name, inline: true },
                        { name: 'ID Server', value: `\`${guild.id}\``, inline: true },
                        { name: 'Jumlah Member', value: `${guild.memberCount}`, inline: true },
                        { name: 'Pemilik', value: owner ? `${owner.user.tag}` : 'Tidak diketahui', inline: true }
                    )
                    .setTimestamp();
                await sendSpyLog({ embeds: [embed] });
            } catch (e) { }
        }

        // Keluar setelah 10 detik
        setTimeout(() => {
            guild.leave().then(() => {
                console.log(`✅ Berhasil keluar dari server tidak terlisensi: ${guild.name}`);
            }).catch(e => {
                console.error(`❌ Gagal keluar dari server: ${guild.name}`, e.message);
            });
        }, 10000);
        return;
    }

    // Jika berizin, daftarkan command
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const adminGuildId = process.env.GUILD_ID ? process.env.GUILD_ID.split(',')[0].trim() : null;
    try {
        let body = [...publicCommands];
        if (guild.id === adminGuildId) {
            body = [...publicCommands, ...ownerCommands];
        }
        await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body });
        console.log(`✅ Slash commands instan didaftarkan ke server baru: ${guild.id}`);
    } catch (e) {
        console.error(`❌ Gagal mendaftarkan commands ke server baru: ${guild.id}`, e.message);
    }

    // Sistem Log Pengintai untuk Server Berizin
    if (SPY_LOG_CHANNEL) {
        try {
            const owner = await guild.fetchOwner().catch(() => null);
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('📥 Server Berizin Mengundang Bot!')
                .addFields(
                    { name: 'Nama Server', value: guild.name, inline: true },
                    { name: 'ID Server', value: `\`${guild.id}\``, inline: true },
                    { name: 'Jumlah Member', value: `${guild.memberCount}`, inline: true },
                    { name: 'Pemilik', value: owner ? `${owner.user.tag}` : 'Tidak diketahui', inline: true }
                )
                .setTimestamp();
            await sendSpyLog({ embeds: [embed] });
        } catch (e) {
            console.log('Gagal kirim log spy guildCreate');
        }
    }
});

/**
 * Helper untuk membuat tagihan / invoice QRIS dinamis
 */
const createQRISInvoiceInteraction = async (target, duration, isButton = false) => {
    const isMessage = !target.editReply;
    const guildId = target.guildId;
    if (!guildId) {
        const msg = { content: '❌ Perintah ini hanya bisa digunakan di dalam server!', ephemeral: true };
        return isMessage ? target.reply(msg) : target.reply(msg);
    }

    let basePrice = 20000;
    if (duration === 90) basePrice = 50000;
    if (duration === 365) basePrice = 180000;

    let responseMsg;
    if (isMessage) {
        responseMsg = await target.reply('⏳ Sedang membuat tagihan QRIS...');
    } else {
        if (!target.deferred && !target.replied) {
            await target.deferReply({ ephemeral: isButton });
        }
    }

    // Cari nominal unik yang belum dipakai
    let amount = basePrice;
    let isUnique = false;
    let attempts = 0;
    
    try {
        while (!isUnique && attempts < 50) {
            const suffix = Math.floor(Math.random() * 999) + 1; // 1-999
            amount = basePrice + suffix;
            const [rows] = await pool.query('SELECT amount FROM pending_payments WHERE amount = ? AND status = "PENDING"', [amount]);
            if (rows.length === 0) {
                isUnique = true;
            }
            attempts++;
        }
    } catch (err) {
        console.error('Gagal memeriksa nominal unik di database:', err.message);
        const errPayload = { content: '❌ Terjadi kesalahan koneksi database saat membuat tagihan. Silakan coba lagi.' };
        return isMessage ? (responseMsg ? responseMsg.edit(errPayload) : target.reply(errPayload)) : target.editReply(errPayload);
    }

    const txId = 'TX' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);

    // Simpan transaksi
    try {
        await pool.query(
            'INSERT INTO pending_payments (txId, serverId, userId, amount, duration, status) VALUES (?, ?, ?, ?, ?, "PENDING")',
            [txId, guildId, isMessage ? target.author.id : target.user.id, amount, duration]
        );
    } catch (err) {
        console.error('Gagal menyimpan pending payment:', err.message);
        const errPayload = { content: '❌ Terjadi kesalahan internal saat membuat tagihan. Silakan coba lagi.' };
        return isMessage ? responseMsg.edit(errPayload) : target.editReply(errPayload);
    }

    // Buat Invoice QRIS Canvas
    const { generateQRISInvoice } = require('./utils/qrisCanvas');
    const invoiceBuffer = await generateQRISInvoice(amount, txId, duration, target.guild.name);
    const { AttachmentBuilder } = require('discord.js');
    const file = new AttachmentBuilder(invoiceBuffer, { name: `invoice_${txId}.png` });

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🧾 TAGIHAN PEMBAYARAN LISENSI')
        .setDescription(`Silakan pindai kode QRIS di bawah ini untuk mengaktifkan **4llboTracker Premium** di server **${target.guild.name}**.\n\n` +
            `• **ID Transaksi**: \`${txId}\`\n` +
            `• **Durasi Sewa**: \`${duration} Hari\`\n` +
            `• **Nominal Unik**: **Rp ${amount.toLocaleString('id-ID')}**\n\n` +
            `⚠️ **PENTING:** Anda harus mentransfer jumlah yang **SAMA PERSIS** hingga 3 digit terakhir. Nominal unik ini digunakan untuk verifikasi otomatis oleh sistem.`)
        .setImage(`attachment://invoice_${txId}.png`)
        .setFooter({ text: 'Tagihan berlaku selama 15 menit • 4llboTracker' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`pay_status_${txId}`)
            .setLabel('Cek Status Pembayaran')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`pay_cancel_${txId}`)
            .setLabel('Batalkan')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
    );

    const successPayload = { content: null, embeds: [embed], files: [file], components: [row] };
    if (isMessage) {
        await responseMsg.edit(successPayload);
    } else {
        await target.editReply(successPayload);
    }
    
    // Hapus tagihan otomatis setelah 15 menit jika belum dibayar
    setTimeout(async () => {
        try {
            const [rows] = await pool.query('SELECT status FROM pending_payments WHERE txId = ?', [txId]);
            if (rows.length > 0 && rows[0].status === 'PENDING') {
                await pool.query('DELETE FROM pending_payments WHERE txId = ?', [txId]);
                console.log(`[BILLING] Tagihan expired: ${txId}`);
            }
        } catch (err) { }
    }, 15 * 60 * 1000);
};

// ==========================================
//  HANDLER SLASH COMMANDS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // Proteksi Perintah Khusus Owner secara Terpusat
    const ownerCommandNames = ['panel', 'announce', 'announce-guild', 'stats', 'setup-dashboard', 'maintenance', 'genkey', 'backup', 'set-status'];
    if (ownerCommandNames.includes(commandName) && !isOwner(interaction.user.id)) {
        return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
    }

    // Cek Maintenance Mode (Kecuali Owner)
    if (botConfig.maintenanceMode && !isOwner(interaction.user.id)) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xfaa61a)
                    .setTitle('🛠️ Bot Sedang Pemeliharaan (Maintenance)')
                    .setDescription('Developer sedang melakukan pemeliharaan sistem agar performa bot lebih optimal.\nSilakan coba kembali beberapa saat lagi. Terima kasih!')
                    .setFooter({ text: '4llboTracker • Maintenance' })
                    .setTimestamp()
            ],
            ephemeral: true
        });
    }

    const allowedGuilds = getAllowedGuilds();

    // Proteksi Server (Akses Ditolak jika tidak ada di config), KECUALI command public seputar registrasi/bantuan
    const bypassCommands = ['help', 'sewa', 'subscription', 'bayar', 'activate', 'redeem', 'beli-lisensi'];
    if (allowedGuilds.length > 0 && !allowedGuilds.includes(interaction.guildId)) {
        if (!bypassCommands.includes(commandName)) {
            // Log Pengintai Penolakan
            await sendSpyLog(`🚨 **Akses Ditolak:** Seseorang mencoba command \`/${commandName}\` di server **${interaction.guild?.name || 'Unknown'}** (ID: \`${interaction.guildId}\`).`);
            return interaction.reply({
                content: '❌ **Akses Ditolak!** Bot ini belum diizinkan atau dilisensikan untuk digunakan di server ini. Silakan hubungi pemilik bot.',
                ephemeral: true
            });
        }
    }

    // ── /cek ───────────────────────────────────
    if (commandName === 'cek') {
        await interaction.deferReply();
        const ip = interaction.options.getString('server');

        // Animasi loading + fetch paralel
        const fetchPromise = fetchServerData(ip);

        await runLoadingAnimation(
            { edit: (p) => interaction.editReply(p) },
            (spin, bar, step) => new EmbedBuilder()
                .setColor(COLORS.primary)
                .setTitle(`${spin} Menghubungkan ke Server...`)
                .setDescription(
                    `\`\`\`\nTarget : ${ip}\nStatus : Mengambil data server...\n\`\`\`` +
                    `\n${bar}\n` +
                    (step >= 5 ? '✅ Terhubung ke FiveM API\n' : '⏳ Koneksi...\n') +
                    (step >= 8 ? '✅ Data diterima\n' : '')
                )
                .setFooter({ text: '4llboTracker' }),
            10, 300
        );

        const data = await fetchPromise;

        if (!data.success) {
            const errEmbed = new EmbedBuilder()
                .setColor(COLORS.primary)
                .setTitle('❌ Server Tidak Ditemukan')
                .setDescription(
                    `\`\`\`diff\n- ${data.error}\n\`\`\`` +
                    `\n> Pastikan IP/Link CFX valid dan server sedang online.`
                )
                .setFooter({ text: '4llboTracker' })
                .setTimestamp();
            return interaction.editReply({ embeds: [errEmbed] });
        }

        const embed = buildServerEmbed(data);
        const banner = createBannerAttachment();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Join Server')
                .setEmoji('🎮')
                .setStyle(ButtonStyle.Link)
                .setURL(`fivem://connect/${data.ip}`),
            new ButtonBuilder()
                .setCustomId(`refresh_${data.ip}`)
                .setLabel('Refresh')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`players_${data.ip}`)
                .setLabel('Lihat Pemain')
                .setEmoji('👥')
                .setStyle(ButtonStyle.Primary)
        );

        const replyPayload = { embeds: [embed], components: [row] };
        if (banner) replyPayload.files = [banner];
        await interaction.editReply(replyPayload);
    }

    // ── /pemain ────────────────────────────────
    else if (commandName === 'pemain') {
        await interaction.deferReply();
        const ip = interaction.options.getString('server');

        const fetchPromise = fetchServerData(ip);

        await runLoadingAnimation(
            { edit: (p) => interaction.editReply(p) },
            (spin, bar, step) => new EmbedBuilder()
                .setColor(COLORS.primary)
                .setTitle(`${spin} Memindai Daftar Pemain...`)
                .setDescription(
                    `\`\`\`\nServer  : ${ip}\nStatus  : Mengambil data pemain...\n\`\`\`` +
                    `\n${bar}\n` +
                    (step >= 4 ? '👤 Menghitung pemain online...\n' : '') +
                    (step >= 7 ? '📋 Menyusun daftar...\n' : '')
                )
                .setFooter({ text: '4llboTracker' }),
            9, 320
        );

        const data = await fetchPromise;

        if (!data.success) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.primary)
                        .setTitle('❌ Gagal Mengambil Data Pemain')
                        .setDescription(`\`\`\`diff\n- ${data.error}\n\`\`\``)
                        .setFooter({ text: '4llboTracker' })
                ]
            });
        }

        const embed = buildServerEmbed(data, true);
        const banner = createBannerAttachment();

        if (data.players.length === 0) {
            embed.addFields({ name: '📋 Status', value: 'Tidak ada pemain online saat ini.', inline: false });
        }

        const replyPayload = { embeds: [embed] };
        if (banner) replyPayload.files = [banner];
        await interaction.editReply(replyPayload);
    }

    // ── /monitor ───────────────────────────────
    else if (commandName === 'monitor') {
        const ip = interaction.options.getString('server');
        const channelId = interaction.channelId;

        if (monitoredServers.has(ip)) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle('⚠️ Server Sudah Dipantau')
                    .setDescription(`Server \`${ip}\` sudah dipantau.\nGunakan \`/stopmonitor\` untuk menghentikan.`)
                ],
                ephemeral: true
            });
        }

        await interaction.deferReply();
        const fetchPromise = fetchServerData(ip);

        await runLoadingAnimation(
            { edit: (p) => interaction.editReply(p) },
            (spin, bar, step) => new EmbedBuilder()
                .setColor(COLORS.primary)
                .setTitle(`${spin} Mengaktifkan Monitor...`)
                .setDescription(
                    `\`\`\`\nTarget : ${ip}\nStatus : Inisialisasi...\n\`\`\`` +
                    `\n${bar}`
                )
                .setFooter({ text: '4llboTracker' }),
            8, 400
        );

        const data = await fetchPromise;

        if (!data.success) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.primary)
                        .setTitle('❌ Gagal Mengaktifkan Monitor')
                        .setDescription(`\`\`\`diff\n- ${data.error}\n\`\`\`\n> Pastikan server valid dan menyala.`)
                        .setFooter({ text: '4llboTracker' })
                ]
            });
        }

        monitoredServers.set(ip, {
            name: data.name,
            channelId,
            lastOnline: data.online,
            lastMax: data.max,
            wasOnline: true,
            messageId: null
        });

        try {
            await pool.query(
                'INSERT INTO monitored_servers (ip, name, channelId, lastOnline, lastMax, wasOnline, messageId) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), channelId=VALUES(channelId), lastOnline=VALUES(lastOnline), lastMax=VALUES(lastMax), wasOnline=VALUES(wasOnline)',
                [ip, data.name, channelId, data.online, data.max, true, null]
            );
        } catch (err) {
            console.error('Database Error (Insert):', err.message);
        }

        const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle(`#${data.name}`)
            .setDescription(`📡 **Monitor Aktif** — Server terdaftar untuk dipantau otomatis.`)
            .addFields(
                { name: `${EMOJI.location} Endpoint`, value: `\`${data.ip}\``, inline: true },
                { name: `${EMOJI.players} Status`, value: `🟢 Online (${data.online}/${data.max})`, inline: true },
                { name: '⏱️ Interval', value: `${process.env.MONITOR_INTERVAL_MINUTES || 5} menit`, inline: true }
            )
            .setFooter({ text: '4llboTracker • Monitor Aktif' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        startMonitorLoop();
    }

    // ── /stopmonitor ───────────────────────────
    else if (commandName === 'stopmonitor') {
        const ip = interaction.options.getString('server');

        if (!monitoredServers.has(ip)) {
            return interaction.reply({
                embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`⚠️ Server \`${ip}\` tidak ada dalam daftar monitor.`)],
                ephemeral: true
            });
        }

        const server = monitoredServers.get(ip);
        monitoredServers.delete(ip);

        try {
            await pool.query('DELETE FROM monitored_servers WHERE ip = ?', [ip]);
        } catch (err) {
            console.error('Database Error (Delete):', err.message);
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle(`#${server.name}`)
                    .setDescription(`🛑 **Monitor Dihentikan** — Pemantauan server ini telah dinonaktifkan.`)
                    .setFooter({ text: '4llboTracker' })
                    .setTimestamp()
            ]
        });
    }

    // ── /daftarmonitor ─────────────────────────
    else if (commandName === 'daftarmonitor') {
        if (monitoredServers.size === 0) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.primary)
                        .setDescription(`${EMOJI.page} Belum ada server yang dipantau. Gunakan \`/monitor\` untuk menambahkan.`)
                ], ephemeral: true
            });
        }

        const list = [...monitoredServers.entries()].map(([ip, s], i) =>
            `**${i + 1}.** ${s.wasOnline ? '🟢' : '🔴'} **${s.name}**\n└ \`${ip}\` • ${EMOJI.players} ${s.lastOnline}/${s.lastMax}`
        ).join('\n\n');

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle(`${EMOJI.page} Server yang Dipantau`)
                    .setDescription(list)
                    .setFooter({ text: `Total: ${monitoredServers.size} server • 4llboTracker` })
                    .setTimestamp()
            ]
        });
    }

    // ── /cariserver ────────────────────────────
    else if (commandName === 'cariserver') {
        await interaction.deferReply();
        const query = interaction.options.getString('nama').toLowerCase();

        const fetchPromise = fetch(
            `https://servers-frontend.fivem.net/api/servers/?search=${encodeURIComponent(query)}&top=true`,
            { timeout: 10000 }
        );

        await runLoadingAnimation(
            { edit: (p) => interaction.editReply(p) },
            (spin, bar, step) => new EmbedBuilder()
                .setColor(COLORS.primary)
                .setTitle(`${spin} Mencari Server...`)
                .setDescription(
                    `\`\`\`\nKeyword : "${query}"\nStatus  : Memindai database...\n\`\`\`` +
                    `\n${bar}`
                )
                .setFooter({ text: '4llboTracker' }),
            8, 350
        );

        try {
            const res = await fetchPromise;
            if (!res.ok) throw new Error('Gagal mengakses API pencarian FiveM');
            const data = await res.json();
            const servers = data?.data || [];

            if (servers.length === 0) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(COLORS.primary)
                            .setTitle(`${EMOJI.search} Tidak Ada Hasil`)
                            .setDescription(
                                `\`\`\`diff\n- Tidak ditemukan server: "${query}"\n\`\`\`` +
                                `\n> Coba kata kunci lain.`
                            )
                            .setFooter({ text: '4llboTracker' })
                    ]
                });
            }

            const list = servers.slice(0, 8).map((s, i) => {
                const info = s.Data || s;
                const name = stripColors(info.hostname || info.vars?.sv_projectName || 'Unknown');
                const online = info.clients || 0;
                const max = info.sv_maxclients || info.vars?.sv_maxClients || 32;
                const code = info.EndPoint || '';
                const buildVer = info.vars?.sv_version || info.vars?.sv_build || '-';
                const loc = info.vars?.locale || 'id-ID';
                return `**${i + 1}. ${name}**\n${EMOJI.players} \`${online}/${max}\` • ${EMOJI.build} \`${buildVer}\` • ${EMOJI.location} \`${loc}\`\n\`cfx.re/join/${code}\``;
            }).join('\n\n');

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.primary)
                        .setTitle(`${EMOJI.search} Hasil Pencarian: "${query}"`)
                        .setDescription(list)
                        .setFooter({ text: `${Math.min(servers.length, 8)} hasil teratas • 4llboTracker` })
                        .setTimestamp()
                ]
            });
        } catch (err) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.primary)
                        .setTitle('❌ Error Pencarian')
                        .setDescription(`\`\`\`diff\n- ${err.message}\n\`\`\``)
                        .setFooter({ text: '4llboTracker' })
                ]
            });
        }
    }

    // ── /help ──────────────────────────────────
    else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle('#4llboTracker — Panduan')
            .setDescription('Bot pemantau server FiveM real-time.')
            .addFields(
                { name: `${EMOJI.search} \`/cek [server]\``, value: 'Cek status server', inline: true },
                { name: `${EMOJI.players} \`/pemain [server]\``, value: 'Lihat pemain online', inline: true },
                { name: '📡 `/monitor [server]`', value: 'Pantau server otomatis', inline: true },
                { name: '🛑 `/stopmonitor [server]`', value: 'Hentikan pemantauan', inline: true },
                { name: `${EMOJI.page} \`/daftarmonitor\``, value: 'Lihat server dipantau', inline: true },
                { name: `${EMOJI.search} \`/cariserver [nama]\``, value: 'Cari server', inline: true },
                { name: '\u200b', value: '**Prefix Commands**', inline: false },
                { name: '`!allplayer <server>`', value: 'Semua pemain (pagination)', inline: true },
                { name: '`!player <server> <nama>`', value: 'Cari pemain by nama', inline: true },
                { name: '`!id <server> <id>`', value: 'Cari pemain by ID', inline: true },
                { name: '`!serverlist`', value: 'Daftar shortcut server', inline: true }
            )
            .setFooter({ text: '4llboTracker • FiveM Server Tracker' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── /panel (Khusus Owner) ──────────────────
    else if (commandName === 'panel') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('🔧 Panel Admin Discord')
            .setDescription('Atur ID Server klien secara langsung di sini tanpa perlu mengubah file `.env`. Perubahan akan otomatis tersimpan permanen.')
            .addFields({ name: 'Jumlah Klien Saat Ini', value: `${getAllowedGuilds().length} Server Aktif` })
            .setFooter({ text: 'Panel Admin • 4llboTracker' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_add_server').setLabel('Tambah Klien').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('btn_remove_server').setLabel('Hapus Klien').setStyle(ButtonStyle.Danger).setEmoji('➖'),
            new ButtonBuilder().setCustomId('btn_list_server').setLabel('Lihat Daftar').setStyle(ButtonStyle.Secondary).setEmoji('📋')
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // ── /announce (Khusus Owner) ────────────────
    else if (commandName === 'announce') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const pesan = interaction.options.getString('pesan');
        let sukses = 0;
        let gagal = 0;

        const guilds = client.guilds.cache;
        for (const [id, guild] of guilds) {
            try {
                // Cari channel general atau teks pertama yang bisa dikirimi pesan
                const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setColor(COLORS.warn)
                        .setTitle('📢 PENGUMUMAN GLOBAL')
                        .setDescription(`\n\n${pesan}\n\n`)
                        .setFooter({ text: 'Pesan resmi dari Developer 4llboTracker' })
                        .setTimestamp();
                    await channel.send({ embeds: [embed] });
                    sukses++;
                } else {
                    gagal++;
                }
            } catch (e) {
                gagal++;
            }
        }

        await interaction.editReply(`✅ Pengumuman berhasil dikirim ke **${sukses}** server. (Gagal/Tidak ada akses channel: **${gagal}** server).`);
    }

    // ── /stats (Khusus Owner) ──────────────────
    else if (commandName === 'stats') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }
        const uptime = process.uptime();
        const days = Math.floor(uptime / (24 * 3600));
        const hours = Math.floor((uptime % (24 * 3600)) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        const embed = new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('📊 Statistik Performa Bot')
            .addFields(
                { name: 'Uptime', value: `\`${days} Hari ${hours} Jam ${minutes} Menit\``, inline: true },
                { name: 'RAM Usage', value: `\`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\``, inline: true },
                { name: 'Server Count', value: `\`${client.guilds.cache.size} Server\``, inline: true },
                { name: 'Total Users', value: `\`${client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)} Members\``, inline: true },
                { name: 'Database Status', value: pool ? '🟢 Terhubung' : '🔴 Terputus', inline: true }
            )
            .setFooter({ text: '4llboTracker' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── /support ───────────────────────────────
    else if (commandName === 'support') {
        const pesan = interaction.options.getString('pesan');
        try {
            const owner = await client.users.fetch(OWNER_ID).catch(() => null);
            if (owner) {
                const embed = new EmbedBuilder()
                    .setColor(COLORS.warn)
                    .setTitle('📩 TIKET SUPPORT MASUK')
                    .addFields(
                        { name: 'Dari Pengguna', value: `${interaction.user.tag} (ID: \`${interaction.user.id}\`)`, inline: true },
                        { name: 'Dari Server', value: `${interaction.guild?.name || 'DM'} (ID: \`${interaction.guildId || 'DM'}\`)`, inline: true },
                        { name: 'Isi Pesan', value: pesan }
                    )
                    .setFooter({ text: `Gunakan format: [${interaction.user.id}] pesan_balasan untuk membalas.` })
                    .setTimestamp();

                await owner.send({ embeds: [embed] });
                await interaction.reply({ content: '✅ Pertanyaan/keluhan Anda berhasil dikirim ke Owner Bot. Anda akan menerima balasan lewat DM Discord jika sudah ditanggapi.', ephemeral: true });
            } else {
                throw new Error('Owner tidak dapat ditemukan');
            }
        } catch (e) {
            await interaction.reply({ content: `❌ Gagal mengirim tiket bantuan: ${e.message}`, ephemeral: true });
        }
    }

    // ── /beli-lisensi ──────────────────────────
    else if (commandName === 'beli-lisensi') {
        const duration = interaction.options.getInteger('durasi');
        await createQRISInvoiceInteraction(interaction, duration, false);
    }

    // ── /setup-dashboard (Khusus Owner) ─────────
    else if (commandName === 'setup-dashboard') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const guilds = Object.keys(botConfig.licenses || {});
        const list = guilds.map((id, i) => {
            const lic = botConfig.licenses[id];
            const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const priceStr = lic.price ? `Rp ${parseInt(lic.price).toLocaleString('id-ID')}` : 'Rp 20.000';
            return `**${i + 1}.** ID Server: \`${id}\` (Exp: \`${dateStr}\` • \`${priceStr}/bln\`)`;
        }).join('\n') || 'Belum ada klien aktif.';
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📌 Panel Dashboard Lisensi')
            .setDescription('Daftar server klien yang memiliki lisensi aktif:\n\n' + list)
            .setFooter({ text: 'Terakhir Diupdate • 4llboTracker' })
            .setTimestamp();

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_add_server').setLabel('Tambah Klien').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('btn_remove_server').setLabel('Hapus Klien').setStyle(ButtonStyle.Danger).setEmoji('➖'),
            new ButtonBuilder().setCustomId('btn_list_server').setLabel('Lihat Daftar').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
            new ButtonBuilder().setCustomId('btn_msg_owner').setLabel('Kirim Pesan').setStyle(ButtonStyle.Primary).setEmoji('💬')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_list_tx').setLabel('Daftar Transaksi').setStyle(ButtonStyle.Secondary).setEmoji('💸'),
            new ButtonBuilder().setCustomId('btn_genkey').setLabel('Buat Key').setStyle(ButtonStyle.Success).setEmoji('🔑'),
            new ButtonBuilder().setCustomId('btn_list_keys').setLabel('Daftar Key').setStyle(ButtonStyle.Secondary).setEmoji('🗂️')
        );

        const msg = await interaction.channel.send({ embeds: [embed], components: [row1, row2] });

        botConfig.dashboardChannelId = interaction.channelId;
        botConfig.dashboardMsgId = msg.id;
        saveConfig();

        await interaction.editReply('✅ Dashboard lisensi berhasil di-setup di channel ini dan disimpan ke config!');
    }

    // ── /maintenance (Khusus Owner) ─────────────
    else if (commandName === 'maintenance') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }

        botConfig.maintenanceMode = !botConfig.maintenanceMode;
        saveConfig();

        const statusText = botConfig.maintenanceMode ? '🔴 **AKTIF (Maintenance)**' : '🟢 **NON-AKTIF (Normal)**';
        return interaction.reply({
            content: `🔧 **Maintenance Mode** sekarang: ${statusText}\n*Semua user biasa/klien akan diblokir dari pemakaian bot sampai status dinonaktifkan kembali.*`,
            ephemeral: true
        });
    }

    // ── /genkey (Khusus Owner) ───────────────────
    else if (commandName === 'genkey') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }
        const hari = interaction.options.getInteger('hari');
        const harga = interaction.options.getInteger('harga') || 50000;

        const crypto = require('crypto');
        const randPart1 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const randPart2 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const key = `4LLBO-${randPart1}-${randPart2}`;

        botConfig.pendingKeys.push({
            key,
            duration: hari,
            price: harga
        });
        saveConfig();

        return interaction.reply({
            content: `🔑 **Kode Lisensi Berhasil Dibuat!**\n` +
                `• Kode: \`${key}\`\n` +
                `• Durasi: \`${hari} Hari\`\n` +
                `• Tarif: \`Rp ${harga.toLocaleString('id-ID')}/bulan\`\n\n` +
                `*Silakan berikan kode ini kepada pembeli. Pembeli cukup mengetik \`/activate kode: ${key}\` di server tujuan.*`,
            ephemeral: true
        });
    }

    // ── /activate (Public) ──────────────────────
    else if (commandName === 'activate') {
        const kode = interaction.options.getString('kode').trim().toUpperCase();

        const keyIndex = botConfig.pendingKeys.findIndex(k => k.key === kode);
        if (keyIndex === -1) {
            return interaction.reply({ content: '❌ **Kode Lisensi Invalid!** Pastikan kode yang Anda masukkan benar atau hubungi Developer.', ephemeral: true });
        }

        const keyData = botConfig.pendingKeys[keyIndex];
        const serverId = interaction.guildId;

        // Hitung masa aktif
        const expiresAt = new Date(Date.now() + keyData.duration * 24 * 60 * 60 * 1000).toISOString();

        botConfig.licenses[serverId] = {
            expiresAt,
            ownerId: interaction.user.id,
            price: keyData.price,
            duration: keyData.duration
        };

        // Tambah ke allowedGuilds jika belum ada
        if (!botConfig.allowedGuilds.includes(serverId)) {
            botConfig.allowedGuilds.push(serverId);
        }

        // Hapus key yang sudah dipakai
        botConfig.pendingKeys.splice(keyIndex, 1);
        saveConfig();

        // Register slash commands instan ke server ini
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        try {
            await rest.put(Routes.applicationGuildCommands(client.user.id, serverId), { body: publicCommands });
        } catch (e) {
            console.error('Gagal daftarkan commands instan saat aktivasi:', e.message);
        }

        // Kirim Log Pengintai ke Admin
        await sendSpyLog(`🔑 **Lisensi Diaktifkan!**\n• Server: **${interaction.guild?.name || 'Unknown'}** (\`${serverId}\`)\n• Aktivator: **${interaction.user.tag}** (\`${interaction.user.id}\`)\n• Durasi: \`${keyData.duration} Hari\`\n• Tarif: \`Rp ${keyData.price.toLocaleString('id-ID')}/bulan\``);

        const dateStr = new Date(expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x43b581)
                    .setTitle('🎉 Lisensi Berhasil Diaktifkan!')
                    .setDescription(`Bot **4llboTracker** kini aktif sepenuhnya di server **${interaction.guild?.name || 'Unknown'}**.\n\n` +
                        `• **Masa Aktif**: \`${keyData.duration} Hari\`\n` +
                        `• **Jatuh Tempo**: \`${dateStr}\`\n` +
                        `• **Tarif Sewa**: \`Rp ${keyData.price.toLocaleString('id-ID')}/bulan\`\n` +
                        `• **Pemegang Lisensi**: <@${interaction.user.id}>`)
                    .setFooter({ text: '4llboTracker • Aktivasi Lisensi' })
                    .setTimestamp()
            ]
        });
    }

    // ── /announce-guild (Khusus Owner) ───────────
    else if (commandName === 'announce-guild') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }
        const serverId = interaction.options.getString('server_id').trim();
        const pesan = interaction.options.getString('pesan');

        try {
            const guild = await client.guilds.fetch(serverId).catch(() => null);
            if (!guild) {
                return interaction.reply({ content: `❌ Bot tidak ada di server dengan ID \`${serverId}\`!`, ephemeral: true });
            }
            // Cari channel monitor atau text channel pertama
            const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
            if (!channel) {
                return interaction.reply({ content: `❌ Bot tidak memiliki izin mengirim pesan di server **${guild.name}**.`, ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor(COLORS.warn)
                .setTitle('📢 PENGUMUMAN KHUSUS DEVELOPER')
                .setDescription(pesan)
                .setFooter({ text: 'Pesan resmi dari Developer 4llboTracker' })
                .setTimestamp();

            await channel.send({ embeds: [embed] });
            return interaction.reply({ content: `✅ Pengumuman berhasil dikirim ke server **${guild.name}** (Channel: <#${channel.id}>).`, ephemeral: true });
        } catch (e) {
            return interaction.reply({ content: `❌ Gagal mengirim pengumuman: ${e.message}`, ephemeral: true });
        }
    }

    // ── /backup (Khusus Owner) ───────────────────
    else if (commandName === 'backup') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }
        try {
            const owner = await client.users.fetch(OWNER_ID).catch(() => null);
            if (owner) {
                await owner.send({
                    content: '💾 **Backup Data Config 4llboTracker**',
                    files: [CONFIG_PATH]
                });
                return interaction.reply({ content: '✅ File backup `config.json` berhasil dikirim ke DM Anda!', ephemeral: true });
            } else {
                throw new Error('Owner tidak ditemukan');
            }
        } catch (e) {
            return interaction.reply({ content: `❌ Gagal mengirim backup: ${e.message}`, ephemeral: true });
        }
    }

    // ── /set-status (Khusus Owner) ─────────────────
    else if (commandName === 'set-status') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }
        const teks = interaction.options.getString('teks');

        botConfig.statusText = teks;
        saveConfig();

        client.user.setActivity(teks, { type: ActivityType.Listening });

        return interaction.reply({ content: `✅ Status aktivitas bot berhasil diubah menjadi: \`Listening to ${teks}\``, ephemeral: true });
    }

    // ── /sewa & /subscription (Public) ──────────────
    else if (commandName === 'sewa' || commandName === 'subscription') {
        const guildId = interaction.guildId;
        const allowedGuilds = getAllowedGuilds();

        let statusString = '🔴 **TIDAK AKTIF / BELUM BERLANGGANAN**';
        const lic = botConfig.licenses[guildId];

        if (lic) {
            const expiresTime = new Date(lic.expiresAt).getTime();
            const daysLeft = Math.ceil((expiresTime - Date.now()) / (24 * 60 * 60 * 1000));
            const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

            if (daysLeft <= 0) {
                statusString = '🔴 **KADALUARSA / EXPIRED**';
            } else {
                statusString = `🟢 **ACTIVE** - \`${daysLeft} hari tersisa\`\nBerakhir: \`${dateStr}\``;
            }
        } else if (allowedGuilds.includes(guildId)) {
            statusString = '🟢 **ACTIVE** - `PERMANEN`';
        }

        const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('✨ 4llboTracker Premium Access')
            .setDescription('Tingkatkan performa server Discord Anda dengan pemantauan FiveM terbaik secara real-time!')
            .addFields(
                { name: '💰 Tarif Langganan', value: '`Rp 20.000 / 30 Hari`', inline: true },
                { name: '⏰ Masa Aktif', value: '`30 Hari`', inline: true },
                {
                    name: '⭐ Fitur Premium Yang Terbuka', value:
                        '🟢 `/monitor` — Sistem pemantauan status server otomatis (Aktif 24/7).\n' +
                        '👥 `/pemain` & `!allplayer` — Akses ke daftar & ping seluruh pemain online secara detail.\n' +
                        '🔍 `/cariserver` — Pencarian server list global dengan cepat.\n' +
                        '📶 `/cek` — Cek performa, build version, dan status FiveM API server Anda.\n' +
                        '🔎 `!player` & `!id` — Fitur pencarian instan nama atau ID player di dalam game.',
                    inline: false
                },
                {
                    name: '💳 Metode Pembayaran (QRIS)', value:
                        'Silakan lakukan pembayaran sebesar **Rp 20.000** dengan memindai kode QRIS (ALBAR RAYA, ONLINE) di bawah ini.\n' +
                        '*(Tidak perlu mengisi kolom catatan/pesan transfer jika aplikasi M-Banking Anda tidak menyediakannya)*',
                    inline: false
                },
                {
                    name: '🚀 Panduan Aktivasi Otomatis', value:
                        '**1.** Screenshot bukti transfer pembayaran QRIS Anda.\n' +
                        '**2.** Jalankan perintah `/bayar` (lalu unggah foto) atau `!bayar` (sambil mengunggah foto) di channel server Anda.\n' +
                        '**3.** **Sistem akan langsung memverifikasi dan mengaktifkan lisensi secara instan!** 🎉',
                    inline: false
                },
                {
                    name: '📢 Informasi Tambahan', value:
                        '• Lisensi ini berlaku untuk **seluruh member** di server Discord ini.\n' +
                        '• Jika Anda memiliki **Redeem Code** resmi, aktifkan langsung dengan perintah `/activate` atau `!activate`.\n' +
                        '• Pembayaran yang masuk akan diverifikasi secara berkala oleh Owner Bot.',
                    inline: false
                },
                { name: '📌 Status Lisensi Server', value: statusString, inline: false }
            )
            .setFooter({ text: '4llboTracker Premium • Layanan Terbaik untuk Komunitas Anda' })
            .setTimestamp();

        const fs = require('fs');
        const path = require('path');
        let qrisFile = null;
        for (const ext of ['png', 'jpg', 'jpeg']) {
            const tempPath = path.join(__dirname, `qris.${ext}`);
            if (fs.existsSync(tempPath)) {
                qrisFile = { path: tempPath, name: `qris.${ext}` };
                break;
            }
        }
        const files = [];

        if (qrisFile) {
            const { AttachmentBuilder } = require('discord.js');
            const stats = fs.statSync(qrisFile.path);
            const uniqueName = `qris_${Math.floor(stats.mtimeMs)}_${qrisFile.name}`;
            const file = new AttachmentBuilder(qrisFile.path, { name: uniqueName });
            files.push(file);
            embed.setImage(`attachment://${uniqueName}`);
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('order_duration_30')
                .setLabel('Sewa 30 Hari')
                .setEmoji('💳')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('order_duration_90')
                .setLabel('Sewa 90 Hari')
                .setEmoji('💳')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('order_duration_365')
                .setLabel('Sewa 1 Tahun')
                .setEmoji('👑')
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], files, components: [row] });
    }

    // ── /bayar (Public) ─────────────────────────
    else if (commandName === 'bayar') {
        const guildId = interaction.guildId;
        const attachment = interaction.options.getAttachment('bukti');

        if (!attachment || !attachment.contentType || !attachment.contentType.startsWith('image/')) {
            return interaction.reply({ content: '❌ **Bukti Invalid!** Harap unggah file berupa foto/screenshot bukti transfer pembayaran QRIS.', ephemeral: true });
        }

        if (!pool) {
            return interaction.reply({ content: '❌ Database tidak tersedia.', ephemeral: true });
        }

        // Generate ID Transaksi Manual Unik
        const txId = 'MAN_' + Math.floor(100000 + Math.random() * 900000);

        try {
            // Simpan ke database pending_payments
            await pool.query(
                'INSERT INTO pending_payments (txId, serverId, userId, amount, duration, status) VALUES (?, ?, ?, ?, ?, ?)',
                [txId, guildId, interaction.user.id, 20000, 30, 'PENDING_MANUAL']
            );

            // Kirim Verifikasi ke Admin/Owner via DM dan Log Channel
            const spyEmbed = new EmbedBuilder()
                .setColor(COLORS.warn)
                .setTitle('🔔 Verifikasi Pembayaran Manual Baru!')
                .setDescription(
                    `Ada unggahan bukti transfer manual baru dari server **${interaction.guild?.name || 'Unknown'}**.\n\n` +
                    `• **Server ID**: \`${guildId}\`\n` +
                    `• **Pengirim**: <@${interaction.user.id}> (\`${interaction.user.id}\`)\n` +
                    `• **Durasi**: \`30 Hari\`\n` +
                    `• **Tarif**: \`Rp 20.000\`\n` +
                    `• **Transaction ID**: \`${txId}\``
                )
                .setImage(attachment.url)
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`btn_app_man_${txId}`)
                    .setLabel('Setujui (Approve)')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`btn_rej_man_${txId}`)
                    .setLabel('Tolak (Reject)')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            await sendSpyLog({ embeds: [spyEmbed], components: [row] });

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.warn)
                        .setTitle('⏳ Bukti Pembayaran Dikirim!')
                        .setDescription(
                            `Bukti transfer Anda telah berhasil dikirim ke Admin/Developer untuk verifikasi manual.\n\n` +
                            `• **Server**: **${interaction.guild?.name || 'Unknown'}** (\`${guildId}\`)\n` +
                            `• **Durasi**: \`30 Hari\`\n` +
                            `• **Tarif**: \`Rp 20.000\`\n` +
                            `• **Status**: \`MENUNGGU PERSETUJUAN\`\n\n` +
                            `*Anda akan menerima pesan DM secara otomatis setelah Admin menyetujui pembayaran ini. Terima kasih atas kesabaran Anda.*`
                        )
                        .setFooter({ text: '4llboTracker • Manual Payment Verification' })
                        .setTimestamp()
                ]
            });
        } catch (err) {
            console.error('Gagal memproses upload bayar manual:', err.message);
            return interaction.reply({ content: `❌ Gagal memproses data pembayaran: ${err.message}`, ephemeral: true });
        }
    }
});

// ==========================================
//  HANDLER BUTTON INTERACTIONS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_add_server') {
            const serverId = interaction.fields.getTextInputValue('input_server_id').trim();
            const durationRaw = interaction.fields.getTextInputValue('input_duration').trim();
            const ownerId = interaction.fields.getTextInputValue('input_owner_id').trim() || null;
            const priceRaw = interaction.fields.getTextInputValue('input_price').trim();

            const duration = parseInt(durationRaw) || 30;
            const price = parseInt(priceRaw) || 50000;
            const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

            botConfig.licenses[serverId] = {
                expiresAt,
                ownerId,
                price,
                duration
            };

            const isNew = !botConfig.allowedGuilds.includes(serverId);
            if (isNew) {
                botConfig.allowedGuilds.push(serverId);
            }
            saveConfig();

            const dateStr = new Date(expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const priceStr = price.toLocaleString('id-ID');
            return interaction.reply({
                content: `✅ **Lisensi Berhasil Ditambahkan/Diperbarui!**\n` +
                    `• Server ID: \`${serverId}\`\n` +
                    `• Durasi: \`${duration} Hari\`\n` +
                    `• Jatuh Tempo: \`${dateStr}\`\n` +
                    `• Tarif Sewa: \`Rp ${priceStr}/bulan\`\n` +
                    `• Owner ID: \`${ownerId || '-'}\`\n\n` +
                    `*Bot langsung aktif dan siap digunakan di server tersebut.*`,
                ephemeral: true
            });
        } else if (interaction.customId === 'modal_remove_server') {
            const serverId = interaction.fields.getTextInputValue('input_server_id').trim();
            if (botConfig.allowedGuilds.includes(serverId)) {
                botConfig.allowedGuilds = botConfig.allowedGuilds.filter(id => id !== serverId);
                delete botConfig.licenses[serverId];
                saveConfig();

                let leftMessage = '';
                try {
                    const guild = await client.guilds.fetch(serverId).catch(() => null);
                    if (guild) {
                        const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                        if (channel) {
                            await channel.send('⚠️ **Lisensi Dicabut!** Masa aktif bot **4llboTracker** di server ini telah dihentikan oleh Developer. Seluruh fitur monitoring telah dinonaktifkan.');
                        }
                        leftMessage = '\n*Fitur bot di server tersebut otomatis dinonaktifkan (Bot tidak keluar dari server).*';
                    }
                } catch (err) {
                    leftMessage = `\n*(Gagal mengirim pesan pemberitahuan ke server: ${err.message})*`;
                }

                return interaction.reply({ content: `✅ Server ID \`${serverId}\` berhasil dihapus! Akses dicabut seketika.${leftMessage}`, ephemeral: true });
            } else {
                return interaction.reply({ content: `⚠️ Server ID \`${serverId}\` tidak ditemukan di config.`, ephemeral: true });
            }
        } else if (interaction.customId === 'modal_msg_owner') {
            const serverId = interaction.fields.getTextInputValue('input_server_id').trim();
            const pesan = interaction.fields.getTextInputValue('input_pesan');
            try {
                const guild = await client.guilds.fetch(serverId).catch(() => null);
                if (!guild) {
                    return interaction.reply({ content: `❌ Bot tidak ada di server dengan ID \`${serverId}\`! Pastikan bot sudah di-invite.`, ephemeral: true });
                }
                const owner = await guild.fetchOwner().catch(() => null);
                if (!owner) {
                    return interaction.reply({ content: `❌ Gagal mengambil pemilik server untuk ID \`${serverId}\`.`, ephemeral: true });
                }
                await owner.send(`⚠️ **Pesan penting dari Developer Bot:**\n\n${pesan}`);
                return interaction.reply({ content: `✅ Pesan berhasil terkirim ke DM Pemilik Server **${guild.name}** (@${owner.user.tag}).`, ephemeral: true });
            } catch (e) {
                return interaction.reply({ content: `❌ Gagal mengirim pesan ke owner server: ${e.message}`, ephemeral: true });
            }
        } else if (interaction.customId === 'modal_genkey') {
            const durationRaw = interaction.fields.getTextInputValue('input_duration').trim();
            const priceRaw = interaction.fields.getTextInputValue('input_price').trim();

            const duration = parseInt(durationRaw) || 30;
            const price = parseInt(priceRaw) || 50000;

            const crypto = require('crypto');
            const randPart1 = crypto.randomBytes(2).toString('hex').toUpperCase();
            const randPart2 = crypto.randomBytes(2).toString('hex').toUpperCase();
            const key = `4LLBO-${randPart1}-${randPart2}`;

            botConfig.pendingKeys.push({
                key,
                duration,
                price
            });
            saveConfig();

            return interaction.reply({
                content: `🔑 **Kode Lisensi Baru Berhasil Dibuat!**\n\n` +
                    `• **Kode**: \`${key}\` (Klik ganda untuk menyalin)\n` +
                    `• **Durasi**: \`${duration} Hari\`\n` +
                    `• **Tarif**: \`Rp ${price.toLocaleString('id-ID')}/bulan\`\n\n` +
                    `*Silakan berikan kode di atas kepada pembeli.*`,
                ephemeral: true
            });
        }
        return;
    }

    if (!interaction.isButton()) return;

    // Panel Admin Buttons
    if (['btn_add_server', 'btn_remove_server', 'btn_list_server', 'btn_msg_owner', 'btn_list_tx', 'btn_genkey', 'btn_list_keys'].includes(interaction.customId)) {
        if (interaction.user.id !== OWNER_ID) return;

        if (interaction.customId === 'btn_list_server') {
            const clientGuilds = Object.keys(botConfig.licenses || {});
            
            // 1. Klien Premium (Berbayar)
            const premiumList = clientGuilds.map((id, i) => {
                const lic = botConfig.licenses[id];
                const guild = client.guilds.cache.get(id);
                const guildName = guild ? guild.name : 'Unknown Server';
                const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const num = String(i + 1).padStart(2, '0');
                return `**[${num}]** **${guildName}**\n` +
                       `  ├─ ID: \`${id}\`\n` +
                       `  ├─ Jatuh Tempo: \`${dateStr}\`\n` +
                       `  └─ Tarif Sewa: \`Rp ${(lic.price || 20000).toLocaleString('id-ID')}/bln\``;
            }).join('\n\n') || '*Belum ada klien premium aktif.*';

            // 2. Seluruh Server Discord yang Diikuti Bot (Diubah ke Array agar indeks 'i' menjadi angka urut, bukan ID)
            const joinedList = [...client.guilds.cache.values()].map((g, i) => {
                const num = String(i + 1).padStart(2, '0');
                return `**[${num}]** **${g.name}**\n` +
                       `  ├─ ID: \`${g.id}\`\n` +
                       `  └─ Anggota: \`${g.memberCount} members\``;
            }).join('\n\n') || '*Bot tidak tergabung di server manapun.*';

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📋 Status Penempatan Bot 4llboTracker')
                .addFields(
                    { name: '👑 Server Klien Berlisensi (Sudah Bayar)', value: premiumList.substring(0, 1024) },
                    { name: '📡 Seluruh Server yang Diikuti Bot', value: joinedList.substring(0, 1024) }
                )
                .setFooter({ text: 'Informasi Real-time • 4llboTracker' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.customId === 'btn_msg_owner') {
            const modal = new (require('discord.js').ModalBuilder)()
                .setCustomId('modal_msg_owner')
                .setTitle('💬 Kirim Pesan ke Owner Server');

            const serverInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_server_id')
                .setLabel('Masukkan ID Server Klien')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setPlaceholder('Misal: 1321775400120094770')
                .setRequired(true);

            const msgInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_pesan')
                .setLabel('Isi Pesan')
                .setStyle(require('discord.js').TextInputStyle.Paragraph)
                .setPlaceholder('Tulis pesan pengingat tagihan atau pesan penting lainnya di sini...')
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(serverInput),
                new ActionRowBuilder().addComponents(msgInput)
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId === 'btn_list_tx') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const [rows] = await pool.query('SELECT * FROM pending_payments ORDER BY createdAt DESC LIMIT 10');
                const list = rows.map((tx, i) => {
                    const dateStr = new Date(tx.createdAt).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
                    const statusStr = tx.status === 'PENDING_MANUAL' ? '⚠️ Menunggu Approval Manual' : `⏳ Pending (${tx.status})`;
                    return `**${i + 1}.** ID Transaksi: \`${tx.txId}\` (${statusStr})\n` +
                           `  ├─ Server: \`${tx.serverId}\`\n` +
                           `  ├─ Pembeli: <@${tx.userId}> | Durasi: \`${tx.duration} Hari\`\n` +
                           `  └─ Nominal: \`Rp ${tx.amount.toLocaleString('id-ID')}\` | Tanggal: \`${dateStr}\``;
                }).join('\n\n') || '*Tidak ada transaksi pending saat ini.*';

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('📋 Daftar Transaksi Pending & Berjalan')
                    .setDescription(list)
                    .setFooter({ text: 'Informasi Real-time • 4llboTracker' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                return interaction.editReply({ content: `❌ Gagal mengambil transaksi: ${err.message}` });
            }
        }

        if (interaction.customId === 'btn_list_keys') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const [rows] = await pool.query('SELECT * FROM pending_keys');
                const list = rows.map((k, i) => {
                    return `**${i + 1}.** Kode: \`${k.license_key}\`\n` +
                           `  └─ Durasi: \`${k.duration} Hari\` | Tarif: \`Rp ${k.price.toLocaleString('id-ID')}/bulan\``;
                }).join('\n\n') || '*Tidak ada kode lisensi aktif (belum terpakai) saat ini.*';

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🗂️ Daftar Kode Lisensi Aktif (Belum Dipakai)')
                    .setDescription(list)
                    .setFooter({ text: '4llboTracker' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                return interaction.editReply({ content: `❌ Gagal mengambil daftar kode: ${err.message}` });
            }
        }

        if (interaction.customId === 'btn_genkey') {
            const modal = new (require('discord.js').ModalBuilder)()
                .setCustomId('modal_genkey')
                .setTitle('🔑 Buat Kode Lisensi Baru');

            const durationInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_duration')
                .setLabel('Durasi Lisensi (Hari)')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setValue('30')
                .setRequired(true);

            const priceInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_price')
                .setLabel('Tarif Sewa Bulanan (Rupiah)')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setValue('50000')
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(priceInput)
            );

            await interaction.showModal(modal);
            return;
        }

        const isAdd = interaction.customId === 'btn_add_server';
        const modal = new (require('discord.js').ModalBuilder)()
            .setCustomId(isAdd ? 'modal_add_server' : 'modal_remove_server')
            .setTitle(isAdd ? '➕ Tambah Server Klien' : '➖ Hapus Server Klien');

        if (isAdd) {
            const serverInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_server_id')
                .setLabel('ID Server Discord')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setPlaceholder('Misal: 1321775400120094770')
                .setRequired(true);

            const durationInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_duration')
                .setLabel('Durasi Masa Sewa (Hari)')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setValue('30')
                .setRequired(true);

            const ownerInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_owner_id')
                .setLabel('ID Discord Owner Server (Untuk DM Tagihan)')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setPlaceholder('Kosongkan jika tidak ada')
                .setRequired(false);

            const priceInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_price')
                .setLabel('Harga Sewa / Bulan (Rupiah)')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setValue('50000')
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(serverInput),
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(ownerInput),
                new ActionRowBuilder().addComponents(priceInput)
            );
        } else {
            const serverInput = new (require('discord.js').TextInputBuilder)()
                .setCustomId('input_server_id')
                .setLabel('Masukkan ID Server Discord')
                .setStyle(require('discord.js').TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(serverInput));
        }

        await interaction.showModal(modal);
        return;
    }

    const allowedGuilds = getAllowedGuilds();
    const isPaymentButton = interaction.customId.startsWith('order_duration_') || 
                            interaction.customId.startsWith('pay_sim_') || 
                            interaction.customId.startsWith('pay_status_') || 
                            interaction.customId.startsWith('pay_cancel_') ||
                            interaction.customId.startsWith('btn_app_man_') ||
                            interaction.customId.startsWith('btn_rej_man_');
    if (!isPaymentButton && allowedGuilds.length > 0 && !allowedGuilds.includes(interaction.guildId)) {
        return interaction.reply({
            content: '❌ **Akses Ditolak!** Bot ini belum diizinkan atau dilisensikan untuk digunakan di server ini.',
            ephemeral: true
        });
    }

    const { customId } = interaction;

    if (customId.startsWith('refresh_')) {
        await interaction.deferUpdate();
        const ip = customId.replace('refresh_', '');
        const data = await fetchServerData(ip);

        if (!data.success) {
            return interaction.followUp({
                content: `❌ Server offline atau tidak bisa dijangkau: ${data.error}`,
                ephemeral: true
            });
        }

        const embed = buildServerEmbed(data);
        const banner = createBannerAttachment();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Join Server')
                .setEmoji('🎮')
                .setStyle(ButtonStyle.Link)
                .setURL(`fivem://connect/${data.ip}`),
            new ButtonBuilder()
                .setCustomId(`refresh_${data.ip}`)
                .setLabel('Refresh')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`players_${data.ip}`)
                .setLabel('Lihat Pemain')
                .setEmoji('👥')
                .setStyle(ButtonStyle.Primary)
        );
        const replyPayload = { embeds: [embed], components: [row] };
        if (banner) replyPayload.files = [banner];
        await interaction.editReply(replyPayload);
    }

    if (customId.startsWith('players_')) {
        await interaction.deferReply({ ephemeral: true });
        const ip = customId.replace('players_', '');
        const data = await fetchServerData(ip);

        if (!data.success || data.players.length === 0) {
            return interaction.editReply({ content: '📋 Tidak ada pemain online saat ini atau server tidak bisa dijangkau.' });
        }

        const sorted = [...data.players].sort((a, b) => a.id - b.id);
        const playerList = sorted
            .slice(0, 30)
            .map(p => {
                const color = getPingColor(p.ping);
                const safeName = stripColors(p.name).replace(/`/g, "'").replace(/\n/g, '').substring(0, 25);
                const idPad = String(p.id).padStart(3, '0');
                const pingPad = String(p.ping + 'ms').padEnd(5, ' ');
                return `${color} \`[${idPad}]\` \`[${pingPad}]\` **${safeName}**`;
            })
            .join('\n');

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle(`#${data.name}`)
                    .setDescription(`${EMOJI.players} **${data.online}/${data.max}** online\n\n${playerList}`)
                    .setFooter({ text: `4llboTracker` })
                    .setTimestamp()
            ]
        });
    }

    // Handle Manual Approval & Rejection
    if (customId.startsWith('btn_app_man_')) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }

        const txId = customId.replace('btn_app_man_', '');
        await interaction.deferReply({ ephemeral: true });

        if (!pool) return interaction.editReply({ content: '❌ Database tidak tersedia.' });

        try {
            const [txs] = await pool.query('SELECT * FROM pending_payments WHERE txId = ?', [txId]);
            if (txs.length === 0) {
                return interaction.editReply({ content: '❌ Transaksi manual tidak ditemukan atau sudah diproses.' });
            }

            const transaction = txs[0];

            // Hitung masa aktif lisensi baru (Stacking)
            const duration = transaction.duration || 30;
            let currentExpiry = Date.now();

            if (botConfig.licenses[transaction.serverId]) {
                const activeExpiry = new Date(botConfig.licenses[transaction.serverId].expiresAt).getTime();
                if (activeExpiry > Date.now()) {
                    currentExpiry = activeExpiry;
                }
            }

            const newExpiry = new Date(currentExpiry + duration * 24 * 60 * 60 * 1000).toISOString();

            // Update data lisensi di memori & allowedGuilds
            botConfig.licenses[transaction.serverId] = {
                expiresAt: newExpiry,
                ownerId: transaction.userId,
                price: transaction.amount || 20000,
                duration: duration
            };

            if (!botConfig.allowedGuilds.includes(transaction.serverId)) {
                botConfig.allowedGuilds.push(transaction.serverId);
            }

            // Simpan konfigurasi (JSON, DB, dan update Dashboard)
            await saveConfig();

            // Hapus dari pending_payments
            await pool.query('DELETE FROM pending_payments WHERE txId = ?', [txId]);

            // Register slash commands instan ke server klien tersebut
            const rest = new (require('@discordjs/rest').REST)({ version: '10' }).setToken(TOKEN);
            const { Routes } = require('discord.js');
            try {
                await rest.put(Routes.applicationGuildCommands(client.user.id, transaction.serverId), { body: publicCommands });
            } catch (e) {
                console.error('Gagal mendaftarkan commands instan saat manual approve:', e.message);
            }

            // Kirim notifikasi sukses via DM Discord ke pembeli
            try {
                const user = await client.users.fetch(transaction.userId).catch(() => null);
                if (user) {
                    const dateStr = new Date(newExpiry).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const successEmbed = new EmbedBuilder()
                        .setColor(0x10b981)
                        .setTitle('✅ Pembayaran Manual Disetujui!')
                        .setDescription(`Halo! Bukti transfer pembayaran Anda telah berhasil diverifikasi dan disetujui oleh Admin.`)
                        .addFields(
                            { name: '📌 Server Tujuan', value: `ID Server: \`${transaction.serverId}\``, inline: true },
                            { name: '⏳ Masa Sewa Tambahan', value: `+${duration} Hari`, inline: true },
                            { name: '📆 Jatuh Tempo Baru', value: `\`${dateStr}\``, inline: false },
                            { name: '💰 Total Pembayaran', value: `Rp ${(transaction.amount || 20000).toLocaleString('id-ID')}`, inline: true }
                        )
                        .setFooter({ text: '4llboTracker Automated Billing System' })
                        .setTimestamp();
                    await user.send({ embeds: [successEmbed] });
                }
            } catch (e) {
                console.error('Gagal mengirim DM sukses ke user:', e.message);
            }

            // Beri tahu server tujuan jika bot di dalamnya
            try {
                const guild = await client.guilds.fetch(transaction.serverId).catch(() => null);
                if (guild) {
                    const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has(require('discord.js').PermissionsBitField.Flags.SendMessages));
                    if (channel) {
                        const dateStr = new Date(newExpiry).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        await channel.send(`🎉 **Lisensi Diaktifkan!** Pembayaran manual untuk server ini telah disetujui oleh Developer. Bot kini aktif sepenuhnya!\n• **Jatuh Tempo**: \`${dateStr}\``);
                    }
                }
            } catch (e) {
                console.error('Gagal mengirim pesan sukses ke channel guild:', e.message);
            }

            // Edit message asli untuk hilangkan tombol dan ganti embed
            try {
                const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x10b981)
                    .setTitle('✅ Pembayaran Manual Disetujui')
                    .setDescription(`Transaksi \`${txId}\` telah disetujui oleh <@${interaction.user.id}> pada ${new Date().toLocaleString('id-ID')}.`);
                await interaction.message.edit({ embeds: [originalEmbed], components: [] });
            } catch (err) { }

            return interaction.editReply({ content: '✅ Berhasil menyetujui pembayaran manual dan mengaktifkan lisensi!' });
        } catch (err) {
            console.error('Gagal memproses manual approve:', err.message);
            return interaction.editReply({ content: `❌ Gagal memproses manual approve: ${err.message}` });
        }
    }

    if (customId.startsWith('btn_rej_man_')) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ Anda bukan pemilik bot!', ephemeral: true });
        }

        const txId = customId.replace('btn_rej_man_', '');
        await interaction.deferReply({ ephemeral: true });

        if (!pool) return interaction.editReply({ content: '❌ Database tidak tersedia.' });

        try {
            const [txs] = await pool.query('SELECT * FROM pending_payments WHERE txId = ?', [txId]);
            if (txs.length === 0) {
                return interaction.editReply({ content: '❌ Transaksi manual tidak ditemukan atau sudah diproses.' });
            }

            const transaction = txs[0];

            // Hapus dari pending_payments
            await pool.query('DELETE FROM pending_payments WHERE txId = ?', [txId]);

            // Kirim notifikasi penolakan via DM Discord ke pembeli
            try {
                const user = await client.users.fetch(transaction.userId).catch(() => null);
                if (user) {
                    const failEmbed = new EmbedBuilder()
                        .setColor(0xef4444)
                        .setTitle('❌ Pembayaran Manual Ditolak!')
                        .setDescription(`Halo! Bukti transfer pembayaran Anda untuk server ID \`${transaction.serverId}\` ditolak oleh Admin.`)
                        .addFields(
                            { name: 'Alasan', value: 'Bukti transfer tidak valid, tidak terbaca, atau tidak sesuai dengan mutasi bank kami.' },
                            { name: '💡 Solusi', value: 'Silakan upload bukti transfer yang valid menggunakan perintah `/bayar` kembali, atau hubungi Developer.' }
                        )
                        .setFooter({ text: '4llboTracker Automated Billing System' })
                        .setTimestamp();
                    await user.send({ embeds: [failEmbed] });
                }
            } catch (e) {
                console.error('Gagal mengirim DM penolakan ke user:', e.message);
            }

            // Edit message asli untuk hilangkan tombol dan ganti embed
            try {
                const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle('❌ Pembayaran Manual Ditolak')
                    .setDescription(`Transaksi \`${txId}\` telah ditolak oleh <@${interaction.user.id}> pada ${new Date().toLocaleString('id-ID')}.`);
                await interaction.message.edit({ embeds: [originalEmbed], components: [] });
            } catch (err) { }

            return interaction.editReply({ content: '❌ Berhasil menolak pembayaran manual.' });
        } catch (err) {
            console.error('Gagal memproses manual reject:', err.message);
            return interaction.editReply({ content: `❌ Gagal memproses manual reject: ${err.message}` });
        }
    }

    // Handle Ordering Packages
    if (customId.startsWith('order_duration_')) {
        const duration = parseInt(customId.replace('order_duration_', ''));
        return createQRISInvoiceInteraction(interaction, duration, true);
    }

    // Handle Simulation Payment (OWNER ONLY)
    if (customId.startsWith('pay_sim_')) {
        if (!isOwner(interaction.user.id)) {
            return interaction.reply({ content: '❌ Tombol ini hanya bisa digunakan oleh owner bot untuk keperluan testing.', ephemeral: true });
        }
        const parts = customId.split('_'); // pay_sim_TXxxxxxx_amount
        const txId = parts[2];
        const amount = parseInt(parts[3]) || 0;
        
        await interaction.reply({ content: '📱 **[SIMULASI]** Menghubungi payment gateway callback untuk verifikasi...', ephemeral: true });
        
        const result = await processPaymentNotification(txId, amount, 'simulation');
        if (result.success) {
            await interaction.followUp({ content: '✅ **[SIMULASI SUKSES]** Pembayaran berhasil terverifikasi. Lisensi server telah diaktifkan secara otomatis! 🎉', ephemeral: true });
            
            try {
                const completedEmbed = new EmbedBuilder()
                    .setColor(0x10b981)
                    .setTitle('✅ PEMBAYARAN TELAH SELESAI')
                    .setDescription(`Transaksi \`${txId}\` telah berhasil dibayar.\nLisensi server premium telah diaktifkan!`)
                    .setTimestamp();
                await interaction.message.edit({ embeds: [completedEmbed], files: [], components: [] });
            } catch (err) { }
        } else {
            await interaction.followUp({ content: `❌ **[SIMULASI GAGAL]** ${result.error}`, ephemeral: true });
        }
        return;
    }

    // Handle Check Status Payment
    if (customId.startsWith('pay_status_')) {
        const txId = customId.replace('pay_status_', '');
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const [rows] = await pool.query('SELECT status, userId FROM pending_payments WHERE txId = ?', [txId]);
            if (rows.length === 0) {
                // Transaksi sudah tidak ada di DB - mungkin sudah berhasil diproses
                // Cek apakah user ini yang punya lisensi untuk guild ini
                const lic = botConfig.licenses[interaction.guildId];
                const isLicActive = lic && new Date(lic.expiresAt).getTime() > Date.now();
                const isOwnerOfLic = lic && lic.ownerId === interaction.user.id;
                if (isLicActive && isOwnerOfLic) {
                    await interaction.editReply({ content: '✅ **Verifikasi Berhasil!** Lisensi server premium Anda aktif dan sudah terdaftar.' });
                    try {
                        const completedEmbed = new EmbedBuilder()
                            .setColor(0x10b981)
                            .setTitle('✅ PEMBAYARAN TELAH SELESAI')
                            .setDescription(`Transaksi \`${txId}\` telah berhasil dibayar.\nLisensi server premium telah diaktifkan!`)
                            .setTimestamp();
                        await interaction.message.edit({ embeds: [completedEmbed], files: [], components: [] });
                    } catch (err) { }
                    return;
                }
                return interaction.editReply({ content: '❌ Transaksi tidak ditemukan. Mungkin telah kedaluwarsa atau dibatalkan.' });
            }

            const tx = rows[0];
            if (tx.status === 'PAID') {
                return interaction.editReply({ content: '✅ Pembayaran terverifikasi! Sistem sedang memproses lisensi Anda.' });
            } else {
                return interaction.editReply({ content: '⏳ **Menunggu Pembayaran.** Pastikan Anda telah men-scan QRIS dan mentransfer nominal yang **sama persis** hingga 3 digit terakhir.' });
            }
        } catch (err) {
            console.error('Gagal mengecek status pembayaran:', err.message);
            return interaction.editReply({ content: '❌ Gagal mengecek status. Coba beberapa saat lagi.' });
        }
    }

    // Handle Cancel Payment
    if (customId.startsWith('pay_cancel_')) {
        const txId = customId.replace('pay_cancel_', '');
        await interaction.deferReply({ ephemeral: true });

        const [rows] = await pool.query('SELECT userId FROM pending_payments WHERE txId = ? AND status = "PENDING"', [txId]);
        if (rows.length === 0) {
            // Cek apakah sudah diproses/dibayar
            const [paidRows] = await pool.query('SELECT status FROM pending_payments WHERE txId = ?', [txId]);
            if (paidRows.length > 0 && paidRows[0].status === 'PAID') {
                return interaction.editReply({ content: '⚠️ Transaksi ini sudah berhasil dibayar dan tidak bisa dibatalkan.' });
            }
            return interaction.editReply({ content: '❌ Transaksi tidak ditemukan atau sudah kedaluwarsa.' });
        }

        // Hanya pembuat tagihan atau owner yang bisa membatalkan
        if (rows[0].userId !== interaction.user.id && !isOwner(interaction.user.id)) {
            return interaction.editReply({ content: '❌ Hanya orang yang membuat tagihan ini yang bisa membatalkannya.' });
        }

        await pool.query('DELETE FROM pending_payments WHERE txId = ?', [txId]);
        await interaction.editReply({ content: '✅ Transaksi berhasil dibatalkan.' });

        try {
            await interaction.message.edit({
                content: `❌ **Tagihan Dibatalkan** oleh <@${interaction.user.id}>.`,
                embeds: [],
                files: [],
                components: []
            });
        } catch (err) { }
        return;
    }
});

// ==========================================
//  MONITORING LOOP
// ==========================================
let monitorLoopStarted = false;

const startMonitorLoop = () => {
    if (monitorLoopStarted) return;
    monitorLoopStarted = true;

    console.log(`📡 Monitor loop dimulai. Interval: ${MONITOR_INTERVAL / 1000}s`);

    setInterval(async () => {
        if (monitoredServers.size === 0) return;

        for (const [ip, serverInfo] of monitoredServers.entries()) {
            try {
                const data = await fetchServerData(ip);
                const channel = await client.channels.fetch(serverInfo.channelId).catch(() => null);
                if (!channel) continue;

                const isNowOnline = data.success;
                const wasOnlineBefore = serverInfo.wasOnline;

                // Notif jika status berubah
                if (!wasOnlineBefore && isNowOnline) {
                    const embed = new EmbedBuilder()
                        .setColor(COLORS.primary)
                        .setTitle(`#${serverInfo.name}`)
                        .setDescription(`🟢 **Server Kembali Online!**\n${EMOJI.players} ${data.online}/${data.max} pemain`)
                        .setFooter({ text: '4llboTracker • Monitor' })
                        .setTimestamp();
                    channel.send({ embeds: [embed] });
                } else if (wasOnlineBefore && !isNowOnline) {
                    const embed = new EmbedBuilder()
                        .setColor(COLORS.primary)
                        .setTitle(`#${serverInfo.name}`)
                        .setDescription(`🔴 **Server Offline!**\n${data.error || 'Tidak diketahui'}`)
                        .setFooter({ text: '4llboTracker • Monitor' })
                        .setTimestamp();
                    channel.send({ embeds: [embed] });
                }

                // Update info di memori
                monitoredServers.set(ip, {
                    ...serverInfo,
                    lastOnline: isNowOnline ? data.online : 0,
                    lastMax: isNowOnline ? data.max : serverInfo.lastMax,
                    wasOnline: isNowOnline,
                    name: isNowOnline ? data.name : serverInfo.name
                });

                try {
                    await pool.query(
                        'UPDATE monitored_servers SET lastOnline=?, lastMax=?, wasOnline=?, name=? WHERE ip=?',
                        [isNowOnline ? data.online : 0, isNowOnline ? data.max : serverInfo.lastMax, isNowOnline, isNowOnline ? data.name : serverInfo.name, ip]
                    );
                } catch (err) {
                    console.error('Database Error (Update Loop):', err.message);
                }

                console.log(`[Monitor] ${serverInfo.name}: ${isNowOnline ? `🟢 Online (${data.online}/${data.max})` : '🔴 Offline'}`);
            } catch (err) {
                console.error(`[Monitor] Error untuk ${ip}:`, err.message);
            }
        }
    }, MONITOR_INTERVAL);
};

// ==========================================
//  HANDLER PAGINATION
// ==========================================
const generatePlayerEmbed = (playersArray, page, serverData, isSearch = false, query = '') => {
    const playersPerPage = 25; // 25 pemain per halaman (1 kolom memanjang)
    const totalPages = Math.ceil(playersArray.length / playersPerPage) || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const startIdx = (page - 1) * playersPerPage;
    const visiblePlayers = playersArray.slice(startIdx, startIdx + playersPerPage);

    const embed = new EmbedBuilder()
        .setColor(COLORS.primary);

    if (isSearch) {
        embed.setTitle(`🔍 Pencarian: ${query} (${serverData.name})`);
    } else {
        embed.setTitle(`📋 Daftar Pemain (${serverData.name})`);
    }

    if (visiblePlayers.length === 0) {
        embed.setDescription('Tidak ada pemain ditemukan.');
    } else {
        const formatPlayer = (p) => {
            const color = getPingColor(p.ping);
            const safeName = stripColors(p.name).replace(/`/g, "'").replace(/\n/g, '').substring(0, 25);
            // Tambahkan spasi agar rata (tabular)
            const idPad = String(p.id).padStart(3, '0');
            const pingPad = String(p.ping + 'ms').padEnd(5, ' ');
            return `${color} \`[${idPad}]\` \`[${pingPad}]\` **${safeName}**`;
        };

        const playerListStr = visiblePlayers.map(formatPlayer).join('\n');

        embed.setDescription(`**Total Online:** ${serverData.online}/${serverData.max}\n\n${playerListStr}`);
    }

    embed.setImage('attachment://banner.png');
    embed.setFooter({ text: `Hal ${page}/${totalPages} • Total: ${playersArray.length} pemain` });

    return embed;
};

const createPaginationButtons = (page, totalPages) => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev_page').setLabel('◀️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId('next_page').setLabel('Next ▶️').setStyle(ButtonStyle.Primary).setDisabled(page === totalPages)
    );
};

const handlePaginatedPlayerList = async (message, botMessage, playersArray, serverData, isSearch = false, query = '') => {
    const sortedPlayers = playersArray.sort((a, b) => a.id - b.id);
    const totalPages = Math.ceil(sortedPlayers.length / 20) || 1; // 20 per halaman
    let currentPage = 1;

    const banner = createBannerAttachment();
    let responsePayload = { content: null, embeds: [generatePlayerEmbed(sortedPlayers, currentPage, serverData, isSearch, query)] };
    if (banner) responsePayload.files = [banner];
    if (totalPages > 1) {
        responsePayload.components = [createPaginationButtons(currentPage, totalPages)];
    }

    const finalMsg = await botMessage.edit(responsePayload);

    if (totalPages > 1) {
        const collector = finalMsg.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) {
                return i.reply({ content: '❌ Hanya yang trigger command yang bisa memindah halaman.', ephemeral: true });
            }
            if (i.customId === 'prev_page') currentPage--;
            if (i.customId === 'next_page') currentPage++;

            const newBanner = createBannerAttachment();
            const updatePayload = {
                embeds: [generatePlayerEmbed(sortedPlayers, currentPage, serverData, isSearch, query)],
                components: [createPaginationButtons(currentPage, totalPages)]
            };
            if (newBanner) updatePayload.files = [newBanner];
            await i.update(updatePayload);
        });

        collector.on('end', () => {
            finalMsg.edit({ components: [] }).catch(() => { });
        });
    }
};

// ==========================================
//  HANDLER PREFIX COMMANDS (!command)
// ==========================================
const PREFIX = '!';

client.on('messageCreate', async (message) => {
    console.log(`[DEBUG] Pesan baru dari ${message.author.tag}: "${message.content}"`);
    // Abaikan pesan dari bot lain
    if (message.author.bot) return;

    // Cek jika pesan masuk lewat DM dan pengirimnya adalah Owner (untuk balas tiket support)
    if (!message.guild && isOwner(message.author.id)) {
        const match = message.content.match(/^\[(\d+)\]\s+(.+)$/s);
        if (match) {
            const targetUserId = match[1];
            const replyContent = match[2];
            try {
                const targetUser = await client.users.fetch(targetUserId).catch(() => null);
                if (targetUser) {
                    const embed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('💬 Balasan dari Developer Bot')
                        .setDescription(replyContent)
                        .setFooter({ text: '4llboTracker Support' })
                        .setTimestamp();
                    await targetUser.send({ embeds: [embed] });
                    return message.reply(`✅ Balasan berhasil dikirim ke **${targetUser.tag}** (ID: \`${targetUserId}\`).`);
                } else {
                    return message.reply(`❌ User dengan ID \`${targetUserId}\` tidak ditemukan atau tidak dapat di-DM.`);
                }
            } catch (e) {
                return message.reply(`❌ Gagal mengirim balasan ke User ID \`${targetUserId}\`: ${e.message}`);
            }
        }
    }

    // Cek apakah pesan diawali dengan prefix (!)
    if (!message.content.startsWith(PREFIX)) return;

    // Cek Maintenance Mode (Kecuali Owner)
    if (botConfig.maintenanceMode && !isOwner(message.author.id)) {
        const embed = new EmbedBuilder()
            .setColor(0xfaa61a)
            .setTitle('🛠️ Bot Sedang Pemeliharaan (Maintenance)')
            .setDescription('Developer sedang melakukan pemeliharaan sistem agar performa bot lebih optimal.\nSilakan coba kembali beberapa saat lagi. Terima kasih!')
            .setFooter({ text: '4llboTracker • Maintenance' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // Pisahkan command dan argumennya
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Proteksi Perintah Khusus Owner secara Terpusat (Prefix)
    const ownerPrefixCommands = ['panel', 'announce', 'announce-guild', 'stats', 'setup-dashboard', 'maintenance', 'genkey', 'backup', 'set-status'];
    if (ownerPrefixCommands.includes(commandName) && !isOwner(message.author.id)) {
        return message.reply('❌ Anda bukan pemilik bot!');
    }

    const allowedGuilds = getAllowedGuilds();

    // Proteksi Server (Akses Ditolak jika tidak ada di config), KECUALI command public seputar registrasi/bantuan
    const bypassCommands = ['help', 'sewa', 'subscription', 'bayar', 'activate', 'redeem', 'beli-lisensi'];
    if (allowedGuilds.length > 0 && !allowedGuilds.includes(message.guildId)) {
        if (!bypassCommands.includes(commandName)) {
            // Log Pengintai Penolakan
            await sendSpyLog(`🚨 **Akses Ditolak:** Seseorang mencoba prefix command \`!${commandName}\` di server **${message.guild?.name || 'Unknown'}** (ID: \`${message.guildId}\`).`);
            return message.reply('❌ **Akses Ditolak!** Bot ini belum diizinkan atau dilisensikan untuk digunakan di server ini. Silakan hubungi pemilik bot.');
        }
    }

    // ── !help ──────────────────────────────────
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle('#4llboTracker — Panduan')
            .setDescription('Bot pemantau server FiveM real-time.')
            .addFields(
                { name: '`!allplayer <server>`', value: 'Lihat semua pemain (pagination)', inline: true },
                { name: '`!player <server> <nama>`', value: 'Cari pemain berdasarkan nama', inline: true },
                { name: '`!id <server> <id>`', value: 'Cari pemain berdasarkan ID', inline: true },
                { name: '`!serverlist`', value: 'Daftar shortcut server', inline: true }
            )
            .setFooter({ text: '4llboTracker • FiveM Server Tracker' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // ── !serverlist ────────────────────────────
    if (commandName === 'serverlist') {
        let page = parseInt(args[0]) || 1;
        const itemsPerPage = 20;
        const allAliases = Object.entries(SERVER_ALIASES);
        const totalPages = Math.ceil(allAliases.length / itemsPerPage);

        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        const startIdx = (page - 1) * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;
        const pagedAliases = allAliases.slice(startIdx, endIdx);

        const list = pagedAliases.map(([alias, data]) => {
            return `**${data.name}** — \`${alias}\` • \`${data.cfx}\``;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle(`${EMOJI.page} Daftar Server`)
            .setDescription(list)
            .setFooter({ text: `Hal ${page}/${totalPages} • 4llboTracker` });

        return message.reply({ embeds: [embed] });
    }

    // ── !allplayer ─────────────────────────────
    if (commandName === 'allplayer') {
        if (!args[0]) return message.reply('\`\`\`diff\n- Format: !allplayer <server>\n\`\`\`');

        const ip = args[0];
        const msg = await message.reply(`⏳ Menghubungkan ke \`${ip}\`...`);

        const fetchPromise = fetchServerData(ip);

        const data = await fetchPromise;

        if (!data.success) {
            return msg.edit({
                content: null,
                embeds: [new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle('❌ Server Tidak Ditemukan')
                    .setDescription(`\`\`\`diff\n- ${data.error}\n\`\`\``)
                    .setFooter({ text: '4llboTracker' })
                ]
            });
        }

        if (data.players.length === 0) {
            return msg.edit({
                content: null,
                embeds: [new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle(`#${data.name}`)
                    .setDescription(`${EMOJI.page} Tidak ada pemain online saat ini.`)
                    .setFooter({ text: '4llboTracker' })
                ]
            });
        }

        return handlePaginatedPlayerList(message, msg, data.players, data, false);
    }

    // ── !player ────────────────────────────────
    if (commandName === 'player') {
        if (args.length < 2) return message.reply('\`\`\`diff\n- Format: !player <server> <nama>\n\`\`\`');

        const ip = args[0];
        const searchName = args.slice(1).join(' ').toLowerCase();

        const msg = await message.reply(`⏳ Mencari **${searchName}**...`);

        const fetchPromise = fetchServerData(ip);

        const data = await fetchPromise;

        if (!data.success) return msg.edit({
            content: null,
            embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`\`\`\`diff\n- ${data.error}\n\`\`\``).setFooter({ text: '4llboTracker' })]
        });

        const foundPlayers = data.players.filter(p => stripColors(p.name).toLowerCase().includes(searchName));

        if (foundPlayers.length === 0) {
            return msg.edit({
                content: null,
                embeds: [new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle(`#${data.name}`)
                    .setDescription(`\`\`\`diff\n- "${searchName}" tidak ditemukan\n\`\`\`\n> Coba nama yang lebih pendek.`)
                    .setFooter({ text: '4llboTracker' })
                ]
            });
        }

        return handlePaginatedPlayerList(message, msg, foundPlayers, data, true, searchName);
    }

    // ── !id ────────────────────────────────────
    if (commandName === 'id') {
        if (args.length < 2) return message.reply('\`\`\`diff\n- Format: !id <server> <id_nomor>\n\`\`\`');

        const ip = args[0];
        const searchId = args[1];

        const msg = await message.reply(`⏳ Mencari ID **#${searchId}**...`);

        const fetchPromise = fetchServerData(ip);
        runDotAnimation(msg, `Mencari ID **#${searchId}** di \`${ip}\`...`, 5);

        const data = await fetchPromise;

        if (!data.success) return msg.edit({
            content: null,
            embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`\`\`\`diff\n- ${data.error}\n\`\`\``).setFooter({ text: '4llboTracker' })]
        });

        const foundPlayer = data.players.find(p => p.id.toString() === searchId);

        if (!foundPlayer) {
            return msg.edit({
                content: null,
                embeds: [new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setTitle(`#${data.name}`)
                    .setDescription(`\`\`\`diff\n- ID #${searchId} tidak ditemukan\n\`\`\`\n> Pastikan ID benar atau pemain sudah leave.`)
                    .setFooter({ text: '4llboTracker' })
                ]
            });
        }

        const bars = getPingBars(foundPlayer.ping);
        const embed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle(`#${data.name}`)
            .setDescription(`✅ **Pemain Ditemukan**\n\n**${String(foundPlayer.id).padStart(4, ' ')}  ${stripColors(foundPlayer.name)}** \`${foundPlayer.ping}ms\` ${bars}`)
            .addFields(
                { name: `${EMOJI.server} Server`, value: data.name, inline: true },
                { name: '🆔 ID', value: `\`#${foundPlayer.id}\``, inline: true },
                { name: `${EMOJI.ping} Ping`, value: `\`${foundPlayer.ping}ms\``, inline: true }
            )
            .setFooter({ text: '4llboTracker' })
            .setTimestamp();

        return msg.edit({ content: null, embeds: [embed] });
    }

    // ── !sewa & !subscribe ─────────────────────
    if (commandName === 'sewa' || commandName === 'subscribe') {
        const guildId = message.guildId;
        const allowedGuilds = getAllowedGuilds();

        let statusString = '🔴 **TIDAK AKTIF / BELUM BERLANGGANAN**';
        const lic = botConfig.licenses[guildId];

        if (lic) {
            const expiresTime = new Date(lic.expiresAt).getTime();
            const daysLeft = Math.ceil((expiresTime - Date.now()) / (24 * 60 * 60 * 1000));
            const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

            if (daysLeft <= 0) {
                statusString = '🔴 **KADALUARSA / EXPIRED**';
            } else {
                statusString = `🟢 **ACTIVE** - \`${daysLeft} hari tersisa\`\nBerakhir: \`${dateStr}\``;
            }
        } else if (allowedGuilds.includes(guildId)) {
            statusString = '🟢 **ACTIVE** - `PERMANEN`';
        }

        const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('✨ 4llboTracker Premium Access')
            .setDescription('Tingkatkan performa server Discord Anda dengan pemantauan FiveM terbaik secara real-time!')
            .addFields(
                { name: '💰 Tarif Langganan', value: '`Rp 20.000 / 30 Hari`', inline: true },
                { name: '⏰ Masa Aktif', value: '`30 Hari`', inline: true },
                {
                    name: '⭐ Fitur Premium Yang Terbuka', value:
                        '🟢 `/monitor` — Sistem pemantauan status server otomatis (Aktif 24/7).\n' +
                        '👥 `/pemain` & `!allplayer` — Akses ke daftar & ping seluruh pemain online secara detail.\n' +
                        '🔍 `/cariserver` — Pencarian server list global dengan cepat.\n' +
                        '📶 `/cek` — Cek performa, build version, dan status FiveM API server Anda.\n' +
                        '🔎 `!player` & `!id` — Fitur pencarian instan nama atau ID player di dalam game.',
                    inline: false
                },
                {
                    name: '💳 Metode Pembayaran (QRIS)', value:
                        'Silakan lakukan pembayaran sebesar **Rp 20.000** dengan memindai kode QRIS (ALBAR RAYA, ONLINE) di bawah ini.\n' +
                        '*(Tidak perlu mengisi kolom catatan/pesan transfer jika aplikasi M-Banking Anda tidak menyediakannya)*',
                    inline: false
                },
                {
                    name: '🚀 Panduan Aktivasi Otomatis', value:
                        '**1.** Screenshot bukti transfer pembayaran QRIS Anda.\n' +
                        '**2.** Jalankan perintah `/bayar` (lalu unggah foto) atau `!bayar` (sambil mengunggah foto) di channel server Anda.\n' +
                        '**3.** **Sistem akan langsung memverifikasi dan mengaktifkan lisensi secara instan!** 🎉',
                    inline: false
                },
                {
                    name: '📢 Informasi Tambahan', value:
                        '• Lisensi ini berlaku untuk **seluruh member** di server Discord ini.\n' +
                        '• Jika Anda memiliki **Redeem Code** resmi, aktifkan langsung dengan perintah `/activate` atau `!activate`.\n' +
                        '• Pembayaran yang masuk akan diverifikasi secara berkala oleh Owner Bot.',
                    inline: false
                },
                { name: '📌 Status Lisensi Server', value: statusString, inline: false }
            )
            .setFooter({ text: '4llboTracker Premium • Layanan Terbaik untuk Komunitas Anda' })
            .setTimestamp();

        const fs = require('fs');
        const path = require('path');
        let qrisFile = null;
        for (const ext of ['png', 'jpg', 'jpeg']) {
            const tempPath = path.join(__dirname, `qris.${ext}`);
            if (fs.existsSync(tempPath)) {
                qrisFile = { path: tempPath, name: `qris.${ext}` };
                break;
            }
        }
        const files = [];

        if (qrisFile) {
            const { AttachmentBuilder } = require('discord.js');
            const stats = fs.statSync(qrisFile.path);
            const uniqueName = `qris_${Math.floor(stats.mtimeMs)}_${qrisFile.name}`;
            const file = new AttachmentBuilder(qrisFile.path, { name: uniqueName });
            files.push(file);
            embed.setImage(`attachment://${uniqueName}`);
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('order_duration_30')
                .setLabel('Sewa 30 Hari')
                .setEmoji('💳')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('order_duration_90')
                .setLabel('Sewa 90 Hari')
                .setEmoji('💳')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('order_duration_365')
                .setLabel('Sewa 1 Tahun')
                .setEmoji('👑')
                .setStyle(ButtonStyle.Secondary)
        );

        return message.reply({ embeds: [embed], files, components: [row] });
    }

    // ── !beli-lisensi ──────────────────────────
    if (commandName === 'beli-lisensi') {
        const durationRaw = args[0] || '30';
        let duration = parseInt(durationRaw);
        if (![30, 90, 365].includes(duration)) {
            return message.reply('❌ **Durasi Invalid!** Pilihan durasi: `30` (30 Hari), `90` (90 Hari), atau `365` (1 Tahun).');
        }
        await createQRISInvoiceInteraction(message, duration, false);
        return;
    }

    // ── !bayar ─────────────────────────────────
    if (commandName === 'bayar') {
        const guildId = message.guildId;
        const attachment = message.attachments.first();

        if (!attachment || !attachment.contentType || !attachment.contentType.startsWith('image/')) {
            return message.reply('❌ **Bukti Invalid!** Harap ketik `!bayar` sambil mengunggah/melampirkan foto/screenshot bukti transfer pembayaran QRIS Anda.');
        }

        if (!pool) {
            return message.reply('❌ Database tidak tersedia.');
        }

        // Generate ID Transaksi Manual Unik
        const txId = 'MAN_' + Math.floor(100000 + Math.random() * 900000);

        try {
            // Simpan ke database pending_payments
            await pool.query(
                'INSERT INTO pending_payments (txId, serverId, userId, amount, duration, status) VALUES (?, ?, ?, ?, ?, ?)',
                [txId, guildId, message.author.id, 20000, 30, 'PENDING_MANUAL']
            );

            // Kirim Verifikasi ke Admin/Owner via DM dan Log Channel
            const spyEmbed = new EmbedBuilder()
                .setColor(COLORS.warn)
                .setTitle('🔔 Verifikasi Pembayaran Manual Baru!')
                .setDescription(
                    `Ada unggahan bukti transfer manual baru dari server **${message.guild?.name || 'Unknown'}**.\n\n` +
                    `• **Server ID**: \`${guildId}\`\n` +
                    `• **Pengirim**: <@${message.author.id}> (\`${message.author.id}\`)\n` +
                    `• **Durasi**: \`30 Hari\`\n` +
                    `• **Tarif**: \`Rp 20.000\`\n` +
                    `• **Transaction ID**: \`${txId}\``
                )
                .setImage(attachment.url)
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`btn_app_man_${txId}`)
                    .setLabel('Setujui (Approve)')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`btn_rej_man_${txId}`)
                    .setLabel('Tolak (Reject)')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            await sendSpyLog({ embeds: [spyEmbed], components: [row] });

            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.warn)
                        .setTitle('⏳ Bukti Pembayaran Dikirim!')
                        .setDescription(
                            `Bukti transfer Anda telah berhasil dikirim ke Admin/Developer untuk verifikasi manual.\n\n` +
                            `• **Server**: **${message.guild?.name || 'Unknown'}** (\`${guildId}\`)\n` +
                            `• **Durasi**: \`30 Hari\`\n` +
                            `• **Tarif**: \`Rp 20.000\`\n` +
                            `• **Status**: \`MENUNGGU PERSETUJUAN\`\n\n` +
                            `*Anda akan menerima pesan DM secara otomatis setelah Admin menyetujui pembayaran ini. Terima kasih atas kesabaran Anda.*`
                        )
                        .setFooter({ text: '4llboTracker • Manual Payment Verification' })
                        .setTimestamp()
                ]
            });
        } catch (err) {
            console.error('Gagal memproses upload bayar manual prefix:', err.message);
            return message.reply(`❌ Gagal memproses data pembayaran: ${err.message}`);
        }
    }

    // ── !activate & !redeem ────────────────────
    if (commandName === 'activate' || commandName === 'redeem') {
        const kode = (args[0] || '').trim().toUpperCase();
        if (!kode) {
            return message.reply('❌ **Format Salah!** Gunakan: `!activate [KODE_LISENSI]` atau `!redeem [KODE_LISENSI]`');
        }

        const keyIndex = botConfig.pendingKeys.findIndex(k => k.key === kode);
        if (keyIndex === -1) {
            return message.reply('❌ **Kode Lisensi Invalid!** Pastikan kode yang Anda masukkan benar atau hubungi Developer.');
        }

        const keyData = botConfig.pendingKeys[keyIndex];
        const serverId = message.guildId;

        // Hitung masa aktif
        const expiresAt = new Date(Date.now() + keyData.duration * 24 * 60 * 60 * 1000).toISOString();

        botConfig.licenses[serverId] = {
            expiresAt,
            ownerId: message.author.id,
            price: keyData.price,
            duration: keyData.duration
        };

        // Tambah ke allowedGuilds jika belum ada
        if (!botConfig.allowedGuilds.includes(serverId)) {
            botConfig.allowedGuilds.push(serverId);
        }

        // Hapus key yang sudah dipakai
        botConfig.pendingKeys.splice(keyIndex, 1);
        saveConfig();

        // Register slash commands instan ke server ini
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        try {
            await rest.put(Routes.applicationGuildCommands(client.user.id, serverId), { body: commands });
        } catch (e) {
            console.error('Gagal daftarkan commands instan saat aktivasi:', e.message);
        }

        // Kirim Log Pengintai ke Admin
        await sendSpyLog(`🔑 **Lisensi Diaktifkan!**\n• Server: **${message.guild?.name || 'Unknown'}** (\`${serverId}\`)\n• Aktivator: **${message.author.tag}** (\`${message.author.id}\`)\n• Durasi: \`${keyData.duration} Hari\`\n• Tarif: \`Rp ${keyData.price.toLocaleString('id-ID')}/bulan\``);

        const dateStr = new Date(expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x43b581)
                    .setTitle('🎉 Lisensi Berhasil Diaktifkan!')
                    .setDescription(`Bot **4llboTracker** kini aktif sepenuhnya di server **${message.guild?.name || 'Unknown'}**.\n\n` +
                        `• **Masa Aktif**: \`${keyData.duration} Hari\`\n` +
                        `• **Jatuh Tempo**: \`${dateStr}\`\n` +
                        `• **Tarif Sewa**: \`Rp ${keyData.price.toLocaleString('id-ID')}/bulan\`\n` +
                        `• **Pemegang Lisensi**: <@${message.author.id}>`)
                    .setFooter({ text: '4llboTracker • Aktivasi Lisensi' })
                    .setTimestamp()
            ]
        });
    }

    // ── !maintenance (Khusus Owner) ─────────────
    if (commandName === 'maintenance') {
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Anda bukan pemilik bot!');
        }
        botConfig.maintenanceMode = !botConfig.maintenanceMode;
        saveConfig();
        const statusText = botConfig.maintenanceMode ? '🔴 **AKTIF (Maintenance)**' : '🟢 **NON-AKTIF (Normal)**';
        return message.reply(`🔧 **Maintenance Mode** sekarang: ${statusText}\n*Semua user biasa/klien akan diblokir dari pemakaian bot.*`);
    }

    // ── !setup-dashboard (Khusus Owner) ──────────
    if (commandName === 'setup-dashboard') {
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Anda bukan pemilik bot!');
        }
        const guilds = getAllowedGuilds();
        const list = guilds.map((id, i) => {
            const lic = botConfig.licenses[id];
            if (lic) {
                const dateStr = new Date(lic.expiresAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const priceStr = lic.price ? `Rp ${parseInt(lic.price).toLocaleString('id-ID')}` : 'Rp 50.000';
                return `**${i + 1}.** ID Server: \`${id}\` (Exp: \`${dateStr}\` • \`${priceStr}/bln\`)`;
            }
            return `**${i + 1}.** ID Server: \`${id}\` (Exp: \`PERMANEN\`)`;
        }).join('\n') || 'Belum ada klien aktif.';

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📌 Panel Dashboard Lisensi')
            .setDescription('Daftar server klien yang memiliki lisensi aktif:\n\n' + list)
            .setFooter({ text: 'Terakhir Diupdate • 4llboTracker' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_add_server').setLabel('Tambah Klien').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('btn_remove_server').setLabel('Hapus Klien').setStyle(ButtonStyle.Danger).setEmoji('➖'),
            new ButtonBuilder().setCustomId('btn_list_server').setLabel('Lihat Daftar').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
            new ButtonBuilder().setCustomId('btn_msg_owner').setLabel('Kirim Pesan').setStyle(ButtonStyle.Primary).setEmoji('💬')
        );

        const msg = await message.channel.send({ embeds: [embed], components: [row] });
        botConfig.dashboardChannelId = message.channelId;
        botConfig.dashboardMsgId = msg.id;
        saveConfig();
        return message.reply('✅ Dashboard lisensi berhasil di-setup di channel ini dan disimpan ke config!');
    }

    // ── !genkey (Khusus Owner) ───────────────────
    if (commandName === 'genkey') {
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Anda bukan pemilik bot!');
        }
        const hari = parseInt(args[0]) || 30;
        const harga = parseInt(args[1]) || 20000;

        const crypto = require('crypto');
        const randPart1 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const randPart2 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const key = `4LLBO-${randPart1}-${randPart2}`;

        botConfig.pendingKeys.push({
            key,
            duration: hari,
            price: harga
        });
        saveConfig();

        return message.reply(`🔑 **Kode Lisensi Berhasil Dibuat!**\n• Kode: \`${key}\`\n• Durasi: \`${hari} Hari\`\n• Tarif: \`Rp ${harga.toLocaleString('id-ID')}/bulan\``);
    }

    // ── !announce-guild (Khusus Owner) ───────────
    if (commandName === 'announce-guild') {
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Anda bukan pemilik bot!');
        }
        const serverId = args[0];
        const pesan = args.slice(1).join(' ');

        if (!serverId || !pesan) {
            return message.reply('❌ **Format salah!** Gunakan: `!announce-guild [server_id] [pesan]`');
        }

        try {
            const guild = await client.guilds.fetch(serverId).catch(() => null);
            if (!guild) return message.reply('❌ Bot tidak ada di server dengan ID tersebut.');
            const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
            if (!channel) return message.reply('❌ Bot tidak dapat mengirim pesan di server tersebut.');

            const embed = new EmbedBuilder()
                .setColor(COLORS.warn)
                .setTitle('📢 PENGUMUMAN KHUSUS DEVELOPER')
                .setDescription(pesan)
                .setFooter({ text: 'Pesan resmi dari Developer 4llboTracker' })
                .setTimestamp();

            await channel.send({ embeds: [embed] });
            return message.reply(`✅ Berhasil dikirim ke server **${guild.name}**.`);
        } catch (e) {
            return message.reply(`❌ Gagal: ${e.message}`);
        }
    }

    // ── !backup (Khusus Owner) ───────────────────
    if (commandName === 'backup') {
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Anda bukan pemilik bot!');
        }
        try {
            const owner = await client.users.fetch(OWNER_ID).catch(() => null);
            if (owner) {
                await owner.send({
                    content: '💾 **Backup Data Config 4llboTracker**',
                    files: [CONFIG_PATH]
                });
                return message.reply('✅ File backup `config.json` berhasil dikirim ke DM Anda!');
            }
        } catch (e) {
            return message.reply(`❌ Gagal: ${e.message}`);
        }
    }

    // ── !set-status (Khusus Owner) ─────────────────
    if (commandName === 'set-status') {
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Anda bukan pemilik bot!');
        }
        const teks = args.join(' ');
        if (!teks) return message.reply('❌ **Format salah!** Gunakan: `!set-status [teks]`');

        botConfig.statusText = teks;
        saveConfig();
        client.user.setActivity(teks, { type: ActivityType.Listening });
        return message.reply(`✅ Status aktivitas bot diubah ke: \`Listening to ${teks}\``);
    }
});



// ==========================================
//  START BOT
// ==========================================
console.log('🚀 Menghidupkan 4llboTracker Bot...');
client.login(TOKEN).catch(err => {
    console.error('❌ Gagal login ke Discord:', err.message);
    console.error('Pastikan DISCORD_TOKEN di file .env sudah benar!');
    process.exit(1);
});
