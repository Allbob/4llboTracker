const { createCanvas, loadImage } = require('@napi-rs/canvas');
const path = require('path');

// Fungsi pembantu untuk membuat kotak dengan sudut melengkung
const roundRect = (ctx, x, y, width, height, radius) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
};

const buildServerBanner = async (data) => {
    // Siapkan kanvas berukuran 800x300 pixel
    const canvas = createCanvas(800, 300);
    const ctx = canvas.getContext('2d');

    // 1. Load Background Image
    try {
        const bgPath = path.join(__dirname, '..', 'assets', 'bg.png');
        const bg = await loadImage(bgPath);
        ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    } catch (err) {
        // Fallback warna gelap jika foto background gagal dimuat
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. Tambahkan overlay hitam transparan agar tulisan lebih terbaca
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 3. Buat kotak utama (Panel Info)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    roundRect(ctx, 40, 40, 720, 220, 20);
    ctx.fill();

    // 4. Tulisan Nama Server
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = '#ffffff';
    let displayName = data.name.length > 28 ? data.name.substring(0, 25) + '...' : data.name;
    ctx.fillText(displayName, 75, 105);

    // 5. Tipe Game (Sebelah Kanan Atas)
    ctx.font = 'italic 20px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#a8b2d1';
    let gametype = data.gametype && data.gametype.length > 25 ? data.gametype.substring(0, 25) : (data.gametype || 'Roleplay');
    ctx.fillText(gametype, 725, 105);
    ctx.textAlign = 'left'; // Kembalikan ke kiri

    // 6. Endpoint / IP
    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#cccccc';
    ctx.fillText(`🎮 Endpoint: ${data.ip}`, 75, 145);

    // 7. Status & Indikator
    if (data.online > 0 || data.success) {
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.arc(85, 220, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('ONLINE', 105, 228);
    } else {
        ctx.fillStyle = '#ff4466';
        ctx.beginPath();
        ctx.arc(85, 220, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('OFFLINE', 105, 228);
    }

    // 8. Teks Jumlah Pemain (Kanan Bawah)
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(`${data.online} / ${data.max} Pemain`, 725, 228);

    // 9. Progress Bar Pemain
    const barWidth = 300;
    const barHeight = 12;
    const barX = 725 - barWidth;
    const barY = 180;
    
    // Background dari progress bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    roundRect(ctx, barX, barY, barWidth, barHeight, 6);
    ctx.fill();
    
    // Isi dari progress bar
    let fillWidth = Math.min((data.online / data.max) * barWidth, barWidth);
    
    // Warnai progress bar menjadi orange jika hampir penuh (90%)
    if ((data.online / data.max) > 0.9) {
        ctx.fillStyle = '#f59e0b';
    } else {
        ctx.fillStyle = '#00ff88';
    }

    if(fillWidth > 5) { // Minimal width agar rounded rect tidak error
        roundRect(ctx, barX, barY, fillWidth, barHeight, 6);
        ctx.fill();
    }

    // Kembalikan gambar sebagai Buffer
    return canvas.toBuffer('image/png');
};

module.exports = { buildServerBanner };
