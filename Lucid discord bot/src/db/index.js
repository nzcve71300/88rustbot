const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration - uses same database as Zentro bot
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zentro_bot',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ [LUCID] Connected to MariaDB/MySQL database');
    // Test query to ensure connection works
    await connection.query('SELECT 1');
    connection.release();
  } catch (error) {
    console.error('❌ [LUCID] Database connection failed:', error.message);
    console.error('Please check your database configuration in .env file');
    console.error('Error details:', error);
    process.exit(1);
  }
}

// Initialize tickets table
async function initializeTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lucid_tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        ticket_number INT NOT NULL,
        category VARCHAR(100) NOT NULL,
        status ENUM('open', 'claimed', 'closed') DEFAULT 'open',
        claimed_by VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP NULL,
        in_game_name VARCHAR(255) NULL,
        help_message TEXT NOT NULL,
        admin_role_id VARCHAR(255) NULL,
        INDEX idx_guild_id (guild_id),
        INDEX idx_channel_id (channel_id),
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        UNIQUE KEY unique_channel (channel_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lucid_ticket_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL UNIQUE,
        admin_role_id VARCHAR(255) NOT NULL,
        panel_channel_id VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_guild_id (guild_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lucid_welcome_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL UNIQUE,
        welcome_channel_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_guild_id (guild_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lucid_server_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL UNIQUE,
        title VARCHAR(256) NOT NULL DEFAULT 'Server Settings',
        description TEXT NOT NULL DEFAULT '',
        embed_color INT NOT NULL DEFAULT 6954413,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_guild_id (guild_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ [LUCID] Database tables created/verified');
  } catch (error) {
    console.error('❌ [LUCID] Error initializing tables:', error.message);
  }
}

// Initialize database on startup
async function initializeDatabase() {
  await testConnection();
  await initializeTables();
}

// Export the pool and helper functions
module.exports = pool;
module.exports.initializeDatabase = initializeDatabase;

