const mysql = require('mysql2/promise');

async function setupDatabase() {
    console.log('Menghubungkan ke MySQL (tanpa spesifik database)...');
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: ''
        });

        console.log('Berhasil terhubung!');
        
        console.log('Membuat database db_4llbotracker jika belum ada...');
        await connection.query('CREATE DATABASE IF NOT EXISTS db_4llbotracker;');
        
        console.log('Memilih database db_4llbotracker...');
        await connection.query('USE db_4llbotracker;');

        console.log('Membuat tabel monitored_servers...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS monitored_servers (
                ip VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255),
                channelId VARCHAR(50),
                lastOnline INT,
                lastMax INT,
                wasOnline BOOLEAN,
                messageId VARCHAR(50) NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        console.log('✅ Database dan tabel berhasil disiapkan!');
        await connection.end();
    } catch (error) {
        console.error('❌ Gagal menyiapkan database: ', error.message);
        process.exit(1);
    }
}

setupDatabase();
