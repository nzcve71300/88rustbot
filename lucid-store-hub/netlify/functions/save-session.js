const mysql = require('mysql2/promise');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { discordId, username, email, avatar, sessionToken } = JSON.parse(event.body);

    if (!discordId || !username || !sessionToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    // Create database connection
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
    });

    // Create sessions table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS store_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(255) NOT NULL UNIQUE,
        username VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        avatar TEXT,
        session_token VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        INDEX idx_discord_id (discord_id),
        INDEX idx_session_token (session_token)
      )
    `);

    // Insert or update session
    await connection.execute(
      `INSERT INTO store_sessions (discord_id, username, email, avatar, session_token, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         email = VALUES(email),
         avatar = VALUES(avatar),
         session_token = VALUES(session_token),
         expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY),
         updated_at = CURRENT_TIMESTAMP`,
      [discordId, username, email || null, avatar || null, sessionToken]
    );

    await connection.end();

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error saving session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
};

