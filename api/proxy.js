// Vercel Serverless Function - Custom Proxy
// Dipanggil dari frontend sebagai: /api/proxy?url=https://...

export default async function handler(req, res) {
    // Allow CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Parameter URL diperlukan.' });
    }

    let targetUrl;
    try {
        targetUrl = new URL(url);
    } catch (e) {
        return res.status(400).json({ error: 'URL tidak valid.' });
    }

    // Handle CFX Resolve
    if (targetUrl.hostname === 'cfx.re' && targetUrl.pathname.startsWith('/join/')) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            const citizenUrl = response.headers.get('x-citizenfx-url');
            if (citizenUrl) {
                let ip = citizenUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
                return res.status(200).json({ resolvedIp: ip });
            } else {
                return res.status(404).json({ error: 'Kode CFX tidak ditemukan atau server offline.' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Gagal meresolve CFX.' });
        }
    }

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
            },
            signal: AbortSignal.timeout(10000), // 10 detik timeout
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Server mengembalikan status ${response.status}` });
        }

        const data = await response.json();

        // Cache selama 15 detik
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Gagal mengambil data dari server FiveM.' });
    }
}
