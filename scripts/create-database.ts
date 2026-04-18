/**
 * One-time: creates the MariaDB/MySQL database from MARIA_DATABASE (default 314_bot).
 * Uses admin credentials — set MARIA_ADMIN_USER / MARIA_ADMIN_PASSWORD for the account
 * that is allowed to CREATE DATABASE (often root). Your app's MARIA_USER/MARIA_PASSWORD
 * can stay as the bot user later.
 *
 * Usage: set vars in .env then: npm run db:create
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const host = process.env.MARIA_HOST?.trim() ?? "127.0.0.1";
const port = Number.parseInt(process.env.MARIA_PORT ?? "3306", 10);
const adminUser = process.env.MARIA_ADMIN_USER?.trim() ?? "root";
const adminPassword = process.env.MARIA_ADMIN_PASSWORD ?? "";
const dbName = process.env.MARIA_DATABASE?.trim() ?? "314_bot";

if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
  console.error("MARIA_DATABASE must contain only letters, numbers, and underscores.");
  process.exit(1);
}

async function main() {
  const conn = await mysql.createConnection({
    host,
    port,
    user: adminUser,
    password: adminPassword,
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`Database "${dbName}" is ready.`);
  } finally {
    await conn.end();
  }
}

void main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
