const mysql = require('mysql2/promise');

exports.handler = async (event, context) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const sessionToken = event.queryStringParameters?.token || event.headers['x-session-token'];

    if (!sessionToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Session token required' }),
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

    // Get session from database
    const [rows] = await connection.execute(
      `SELECT discord_id, username, email, avatar, expires_at
       FROM store_sessions
       WHERE session_token = ? AND expires_at > NOW()`,
      [sessionToken]
    );

    await connection.end();

    if (rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Session not found or expired' }),
      };
    }

    const session = rows[0];

    return {
      statusCode: 200,
      body: JSON.stringify({
        id: session.discord_id,
        username: session.username,
        email: session.email || '',
        avatar: session.avatar || `https://cdn.discordapp.com/embed/avatars/0.png`,
      }),
    };
  } catch (error) {
    console.error('Error getting session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
};

