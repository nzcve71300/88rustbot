-- Run once as a MariaDB/MySQL admin user, e.g.:
--   mariadb -u root -p < scripts/init-db.sql
--   mysql -u root -p < scripts/init-db.sql

CREATE DATABASE IF NOT EXISTS `314_bot`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
