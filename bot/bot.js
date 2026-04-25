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
const BANNER_PATH = path.join(__dirname, 'assets', 'bg.png');

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
// Mengambil variabel GUILD_ID dari .env dan memisahkannya dengan koma jika ada lebih dari 1
const ALLOWED_GUILDS = process.env.GUILD_ID ? process.env.GUILD_ID.split(',').map(id => id.trim()).filter(id => id.length > 0) : [];
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
    'cemara': { name: 'CEMARA', cfx: '4odvg5' }
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

    // Cek apakah input adalah alias server yang terdaftar
    const aliasKey = ip.toLowerCase();
    if (SERVER_ALIASES[aliasKey]) {
        cfxCode = SERVER_ALIASES[aliasKey].cfx;
    } else if (ip.includes('cfx.re/join/')) {
        cfxCode = ip.split('cfx.re/join/')[1].split('/')[0];
    } else if (/^[a-zA-Z0-9]{6}$/.test(ip)) {
        cfxCode = ip;
    } else if (!ip.includes(':') && !ip.includes('.')) {
        // Jika tidak ada titik (.) atau port (:), asumsikan ini adalah PENCARIAN NAMA SERVER
        try {
            const searchRes = await fetch(`https://servers-frontend.fivem.net/api/servers/?search=${encodeURIComponent(ip)}&top=true`, { timeout: 10000 });
            if (!searchRes.ok) throw new Error('API pencarian FiveM sedang gangguan.');
            const searchData = await searchRes.json();
            const servers = searchData?.data || [];

            if (servers.length > 0) {
                cfxCode = servers[0].EndPoint; // Ambil kode CFX dari hasil pertama
            } else {
                return { success: false, error: `Tidak ditemukan server dengan nama "${ip}". Coba gunakan nama lain atau link CFX.` };
            }
        } catch (err) {
            return { success: false, error: `Gagal mencari server: ${err.message}` };
        }
    }

    try {
        if (cfxCode) {
            const res = await fetch(
                `https://servers-frontend.fivem.net/api/servers/single/${cfxCode}`,
                { timeout: 10000 }
            );
            if (!res.ok) {
                // Fallback: Jika pengguna memasukkan nama server 6 huruf persis (yang dikira kode CFX)
                if (!ip.includes('cfx') && /^[a-zA-Z0-9]{6}$/.test(ip)) {
                    const searchRes = await fetch(`https://servers-frontend.fivem.net/api/servers/?search=${encodeURIComponent(ip)}&top=true`, { timeout: 10000 });
                    const searchData = searchRes.ok ? await searchRes.json() : null;
                    if (searchData && searchData.data && searchData.data.length > 0) {
                        const correctCfx = searchData.data[0].EndPoint;
                        const correctRes = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${correctCfx}`, { timeout: 10000 });
                        if (correctRes.ok) {
                            const correctData = await correctRes.json();
                            return processSingleServerData(correctData, correctCfx, `cfx.re/join/${correctCfx}`);
                        }
                    }
                }
                throw new Error('Server tidak ditemukan atau offline.');
            }
            const data = await res.json();
            if (!data.Data) throw new Error('Data server tidak tersedia.');

            return processSingleServerData(data, cfxCode, `cfx.re/join/${cfxCode}`);
        } else {
            // IP biasa
            if (!ip.includes(':')) ip += ':30120';
            ip = ip.replace(/^https?:\/\//, '');

            const proxyUrl = 'https://api.allorigins.win/raw?url=';
            const infoRes = await fetch(
                `${proxyUrl}${encodeURIComponent(`http://${ip}/info.json`)}`,
                { timeout: 10000 }
            );
            if (!infoRes.ok) throw new Error('Server offline atau IP tidak valid.');
            const infoNode = await infoRes.json();

            const playersRes = await fetch(
                `${proxyUrl}${encodeURIComponent(`http://${ip}/players.json`)}`,
                { timeout: 10000 }
            );
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
                ip,
                cfxCode: null,
                players: players, // Ambil SELURUH pemain tanpa dipotong
                isCfx: false,
                vars: infoNode.vars || {}
            };
        }
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
const commands = [
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
].map(cmd => cmd.toJSON());

const registerCommands = async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('⏳ Mendaftarkan slash commands...');
        if (ALLOWED_GUILDS.length > 0) {
            for (const guildId of ALLOWED_GUILDS) {
                try {
                    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
                    console.log(`✅ Slash commands berhasil didaftarkan ke server: ${guildId}`);
                } catch (e) {
                    console.error(`❌ Gagal mendaftarkan ke server: ${guildId}`, e.message);
                }
            }
        } else {
            await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log('✅ Slash commands berhasil didaftarkan secara global (butuh ~1 jam untuk aktif)');
        }
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

    client.user.setActivity('FiveM Servers 🎮', { type: ActivityType.Watching });

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
});

// ==========================================
//  HANDLER SLASH COMMANDS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (ALLOWED_GUILDS.length > 0 && !ALLOWED_GUILDS.includes(interaction.guildId)) {
        return interaction.reply({
            content: '❌ **Akses Ditolak!** Bot ini belum diizinkan atau dilisensikan untuk digunakan di server ini. Silakan hubungi pemilik bot.',
            ephemeral: true
        });
    }

    const { commandName } = interaction;

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
});

// ==========================================
//  HANDLER BUTTON INTERACTIONS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (ALLOWED_GUILDS.length > 0 && !ALLOWED_GUILDS.includes(interaction.guildId)) {
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
                const safeName = stripColors(p.name).substring(0, 20);
                const bars = getPingBars(p.ping);
                return `**${String(p.id).padStart(4, ' ')}  ${safeName}** \`${p.ping}ms\` ${bars}`;
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
    const playersPerPage = 20; // 20 pemain per halaman untuk 2 kolom
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
        // Create 2 columns (Bagian 1 & Bagian 2)
        const col1 = visiblePlayers.slice(0, 10);
        const col2 = visiblePlayers.slice(10, 20);

        const formatPlayer = (p) => {
            const color = getPingColor(p.ping);
            const safeName = stripColors(p.name).replace(/`/g, "'").replace(/\n/g, '').substring(0, 20);
            return `${color} \`${String(p.id).padStart(3, '0')}\` **${safeName}** \`${p.ping}ms\``;
        };

        const str1 = col1.length > 0 ? col1.map(formatPlayer).join('\n\n') : '-';
        const str2 = col2.length > 0 ? col2.map(formatPlayer).join('\n\n') : '-';

        embed.addFields(
            { name: '📋 Bagian 1', value: str1, inline: true },
            { name: '📋 Bagian 2', value: str2, inline: true }
        );
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
    // Cek apakah pesan diawali dengan prefix (!)
    if (!message.content.startsWith(PREFIX)) return;

    // Pisahkan command dan argumennya
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

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
        runDotAnimation(msg, `Memindai pemain di \`${ip}\`...`, 5);

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
        runDotAnimation(msg, `Mencari **${searchName}** di \`${ip}\`...`, 5);

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
});

// ==========================================
//  ERROR HANDLING
// ==========================================
process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Rejection:', err);
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
