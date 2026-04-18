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
    const { sessionToken } = JSON.parse(event.body);

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

    // Delete session from database
    await connection.execute(
      `DELETE FROM store_sessions WHERE session_token = ?`,
      [sessionToken]
    );

    await connection.end();

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error deleting session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
};

