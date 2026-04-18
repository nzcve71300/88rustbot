import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createOrdersTable() {
  let connection;
  
  try {
    // Database credentials (same as Zentro Bot)
    const config = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'Zander',
      password: process.env.DB_PASSWORD || 'Zandewet@123',
      database: process.env.DB_NAME || 'conqueredbot',
      port: parseInt(process.env.DB_PORT || '3306'),
      multipleStatements: true
    };

    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to database');

    // Read SQL file
    const sqlPath = path.join(__dirname, 'sql', 'create_orders_table.sql');
    let sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Remove BOM if present
    sql = sql.replace(/^\uFEFF/, '').trim();
    
    // Filter out SQL comments
    const createTableSQL = sql.split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .trim();

    console.log('📝 Executing SQL to create lucid_orders table...');
    await connection.query(createTableSQL);
    console.log('✅ Table created successfully!');

    // Verify table exists
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'lucid_orders'"
    );

    if (tables.length > 0) {
      console.log('✅ Verified: lucid_orders table exists');
      
      // Show table structure
      const [columns] = await connection.query(
        'DESCRIBE lucid_orders'
      );
      console.log('\n📊 Table structure:');
      console.table(columns);
    } else {
      console.log('⚠️  Warning: Table verification failed');
    }

    await connection.end();
    console.log('\n🎉 Database setup complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (connection) {
      await connection.end();
    }
    process.exit(1);
  }
}

createOrdersTable();
