import mysql from "mysql2/promise";
import { config } from "../config.js";

export const pool = mysql.createPool({
  host: config.maria.host,
  port: config.maria.port,
  user: config.maria.user,
  password: config.maria.password,
  database: config.maria.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
});

export async function ensureSchema(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS guilds (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        discord_guild_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_guilds_discord (discord_guild_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS rust_servers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        nickname VARCHAR(100) NOT NULL,
        server_ip VARCHAR(255) NOT NULL,
        rcon_port INT UNSIGNED NOT NULL,
        rcon_password_encrypted BLOB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_rust_nickname_per_guild (guild_id, nickname),
        KEY idx_rust_guild (guild_id),
        CONSTRAINT fk_rust_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS clan_settings (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        max_members TINYINT UNSIGNED NOT NULL DEFAULT 10,
        channel_id BIGINT UNSIGNED NULL,
        message_id BIGINT UNSIGNED NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_clan_settings_guild (guild_id),
        CONSTRAINT fk_clan_settings_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS clans (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(64) NOT NULL,
        tag CHAR(4) NULL,
        color VARCHAR(16) NULL,
        owner_discord_user_id BIGINT UNSIGNED NULL,
        discord_role_id BIGINT UNSIGNED NULL,
        discord_channel_id BIGINT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_clan_name_per_guild (guild_id, name),
        UNIQUE KEY uq_clan_tag_per_guild (guild_id, tag),
        KEY idx_clans_guild (guild_id),
        CONSTRAINT fk_clans_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS clan_members (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        clan_id BIGINT UNSIGNED NOT NULL,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_clan_member (clan_id, discord_user_id),
        KEY idx_members_clan (clan_id),
        CONSTRAINT fk_members_clan FOREIGN KEY (clan_id) REFERENCES clans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS clan_invites (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        code CHAR(4) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_invite_code_per_guild (guild_id, code),
        KEY idx_invite_clan (clan_id),
        KEY idx_invite_guild (guild_id),
        CONSTRAINT fk_invite_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_invite_clan FOREIGN KEY (clan_id) REFERENCES clans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // --- lightweight migrations for existing installs ---
    // We avoid failing startup if columns already exist.
    const ignoreDup = async (sql: string) => {
      try {
        await conn.query(sql);
      } catch (e: unknown) {
        const msg = typeof e === "object" && e && "message" in e ? String((e as { message: string }).message) : "";
        const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
        if (code === "ER_DUP_FIELDNAME" || code === "ER_DUP_KEYNAME") return;
        if (msg.includes("Duplicate column") || msg.includes("Duplicate key")) return;
        throw e;
      }
    };

    await ignoreDup("ALTER TABLE clans ADD COLUMN tag CHAR(4) NULL");
    await ignoreDup("ALTER TABLE clans ADD COLUMN color VARCHAR(16) NULL");
    await ignoreDup("ALTER TABLE clans ADD COLUMN owner_discord_user_id BIGINT UNSIGNED NULL");
    await ignoreDup("ALTER TABLE clans ADD COLUMN discord_role_id BIGINT UNSIGNED NULL");
    await ignoreDup("ALTER TABLE clans ADD COLUMN discord_channel_id BIGINT UNSIGNED NULL");
    await ignoreDup("ALTER TABLE clans ADD UNIQUE KEY uq_clan_tag_per_guild (guild_id, tag)");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS discord_links (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        ingame_name VARCHAR(128) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_link_user_per_guild (guild_id, discord_user_id),
        UNIQUE KEY uq_link_name_per_guild (guild_id, ingame_name),
        CONSTRAINT fk_links_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS koth_configs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        announcement_channel_id BIGINT UNSIGNED NOT NULL,
        announcement_role_id BIGINT UNSIGNED NULL,
        gates TINYINT UNSIGNED NOT NULL,
        gate_frequency INT UNSIGNED NOT NULL,
        message_id BIGINT UNSIGNED NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_koth_config_server (guild_id, rust_server_id),
        CONSTRAINT fk_koth_config_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_koth_config_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS koth_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        status VARCHAR(16) NOT NULL,
        duration_per_wave_min INT UNSIGNED NULL,
        waves INT UNSIGNED NULL,
        kit_name VARCHAR(64) NULL,
        current_wave INT UNSIGNED NOT NULL DEFAULT 0,
        wave_started_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_koth_events_server (guild_id, rust_server_id, status),
        CONSTRAINT fk_koth_events_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_koth_events_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS koth_event_gates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id BIGINT UNSIGNED NOT NULL,
        gate_number TINYINT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_gate_event_gate (event_id, gate_number),
        UNIQUE KEY uq_gate_event_clan (event_id, clan_id),
        CONSTRAINT fk_gate_event FOREIGN KEY (event_id) REFERENCES koth_events (id) ON DELETE CASCADE,
        CONSTRAINT fk_gate_clan FOREIGN KEY (clan_id) REFERENCES clans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS koth_event_members (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id BIGINT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_event_member (event_id, discord_user_id),
        KEY idx_event_members_event (event_id),
        CONSTRAINT fk_event_member_event FOREIGN KEY (event_id) REFERENCES koth_events (id) ON DELETE CASCADE,
        CONSTRAINT fk_event_member_clan FOREIGN KEY (clan_id) REFERENCES clans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS koth_kills (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id BIGINT UNSIGNED NOT NULL,
        wave INT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        kills INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_kills_event_wave_user (event_id, wave, discord_user_id),
        KEY idx_kills_event_wave (event_id, wave),
        CONSTRAINT fk_kills_event FOREIGN KEY (event_id) REFERENCES koth_events (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS koth_gate_coords (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        gate_number TINYINT UNSIGNED NOT NULL,
        coord VARCHAR(64) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_coords (guild_id, rust_server_id, gate_number),
        CONSTRAINT fk_coords_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_coords_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS nuketown_configs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        announcement_channel_id BIGINT UNSIGNED NOT NULL,
        announcement_role_id BIGINT UNSIGNED NULL,
        gates TINYINT UNSIGNED NOT NULL,
        gate_frequency INT UNSIGNED NOT NULL,
        team_limit TINYINT UNSIGNED NOT NULL,
        kit_name VARCHAR(64) NOT NULL,
        message_id BIGINT UNSIGNED NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_nuketown_config_server (guild_id, rust_server_id),
        CONSTRAINT fk_nuketown_config_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_nuketown_config_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS nuketown_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        status VARCHAR(16) NOT NULL,
        kit_name VARCHAR(64) NULL,
        team_limit TINYINT UNSIGNED NULL,
        lobby_ends_at TIMESTAMP NULL,
        started_at TIMESTAMP NULL,
        bracket_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_nuketown_events_server (guild_id, rust_server_id, status),
        CONSTRAINT fk_nuketown_events_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_nuketown_events_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS nuketown_event_teams (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id BIGINT UNSIGNED NOT NULL,
        slot TINYINT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_nt_event_slot (event_id, slot),
        UNIQUE KEY uq_nt_event_clan (event_id, clan_id),
        CONSTRAINT fk_nt_team_event FOREIGN KEY (event_id) REFERENCES nuketown_events (id) ON DELETE CASCADE,
        CONSTRAINT fk_nt_team_clan FOREIGN KEY (clan_id) REFERENCES clans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS nuketown_event_members (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id BIGINT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_nt_event_member (event_id, discord_user_id),
        KEY idx_nt_members_event (event_id),
        CONSTRAINT fk_nt_member_event FOREIGN KEY (event_id) REFERENCES nuketown_events (id) ON DELETE CASCADE,
        CONSTRAINT fk_nt_member_clan FOREIGN KEY (clan_id) REFERENCES clans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS nuketown_gate_coords (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        gate_number TINYINT UNSIGNED NOT NULL,
        coord VARCHAR(64) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_nt_coords (guild_id, rust_server_id, gate_number),
        CONSTRAINT fk_nt_coords_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_nt_coords_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS one_v_one_configs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        announcement_channel_id BIGINT UNSIGNED NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        kit_name VARCHAR(64) NOT NULL,
        gate_frequency INT UNSIGNED NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_onev1_config_server (guild_id, rust_server_id),
        CONSTRAINT fk_onev1_cfg_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_onev1_cfg_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS one_v_one_gate_coords (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        gate_number TINYINT UNSIGNED NOT NULL,
        coord VARCHAR(64) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_onev1_gate (guild_id, rust_server_id, gate_number),
        CONSTRAINT fk_onev1_gc_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_onev1_gc_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS one_v_one_matches (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        challenger_discord_id BIGINT UNSIGNED NOT NULL,
        opponent_discord_id BIGINT UNSIGNED NOT NULL,
        status VARCHAR(16) NOT NULL,
        channel_id BIGINT UNSIGNED NOT NULL,
        message_id BIGINT UNSIGNED NULL,
        state_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_onev1_server_status (rust_server_id, status),
        CONSTRAINT fk_onev1_match_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_onev1_match_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS rust_player_kd (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        ingame_name VARCHAR(128) NOT NULL,
        kills INT UNSIGNED NOT NULL DEFAULT 0,
        deaths INT UNSIGNED NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_kd (guild_id, rust_server_id, ingame_name),
        KEY idx_kd_server (guild_id, rust_server_id),
        CONSTRAINT fk_kd_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_kd_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS rust_killfeed_config (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        format_string TEXT NOT NULL,
        randomizer_enabled TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_killfeed_server (guild_id, rust_server_id),
        CONSTRAINT fk_killfeed_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_killfeed_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ignoreDup(
      "ALTER TABLE rust_killfeed_config ADD COLUMN randomizer_enabled TINYINT(1) NOT NULL DEFAULT 0"
    );

    await conn.query(`
      CREATE TABLE IF NOT EXISTS koth_kill_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        event_id BIGINT UNSIGNED NOT NULL,
        wave INT UNSIGNED NOT NULL,
        killer_discord_user_id BIGINT UNSIGNED NOT NULL,
        victim_discord_user_id BIGINT UNSIGNED NULL,
        killer_label VARCHAR(128) NOT NULL,
        victim_label VARCHAR(128) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_koth_kill_log_wave (guild_id, event_id, wave),
        CONSTRAINT fk_koth_kill_log_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_koth_kill_log_event FOREIGN KEY (event_id) REFERENCES koth_events (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS maze_configs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        announcement_channel_id BIGINT UNSIGNED NOT NULL,
        announcement_role_id BIGINT UNSIGNED NULL,
        spawn_points TINYINT UNSIGNED NOT NULL,
        message_id BIGINT UNSIGNED NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_maze_config_server (guild_id, rust_server_id),
        CONSTRAINT fk_maze_config_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_maze_config_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS maze_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        status VARCHAR(16) NOT NULL,
        duration_minutes INT UNSIGNED NULL,
        kit_name VARCHAR(64) NULL,
        respawn_enabled TINYINT(1) NOT NULL DEFAULT 0,
        started_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_maze_events_server (guild_id, rust_server_id, status),
        CONSTRAINT fk_maze_events_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_maze_events_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS maze_event_members (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id BIGINT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        spawn_number TINYINT UNSIGNED NOT NULL,
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_maze_member_event_user (event_id, discord_user_id),
        UNIQUE KEY uq_maze_spawn_slot (event_id, spawn_number),
        KEY idx_maze_members_event (event_id),
        CONSTRAINT fk_maze_members_event FOREIGN KEY (event_id) REFERENCES maze_events (id) ON DELETE CASCADE,
        CONSTRAINT fk_maze_members_clan FOREIGN KEY (clan_id) REFERENCES clans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS maze_kills (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id BIGINT UNSIGNED NOT NULL,
        clan_id BIGINT UNSIGNED NOT NULL,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        kills INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_maze_kills (event_id, discord_user_id),
        KEY idx_maze_kills_event (event_id),
        CONSTRAINT fk_maze_kills_event FOREIGN KEY (event_id) REFERENCES maze_events (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS maze_kill_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        event_id BIGINT UNSIGNED NOT NULL,
        killer_discord_user_id BIGINT UNSIGNED NOT NULL,
        victim_discord_user_id BIGINT UNSIGNED NULL,
        killer_label VARCHAR(128) NOT NULL,
        victim_label VARCHAR(128) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_maze_kill_log (guild_id, event_id),
        CONSTRAINT fk_maze_kill_log_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_maze_kill_log_event FOREIGN KEY (event_id) REFERENCES maze_events (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS maze_spawn_coords (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        spawn_number TINYINT UNSIGNED NOT NULL,
        coord VARCHAR(64) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_maze_spawn (guild_id, rust_server_id, spawn_number),
        CONSTRAINT fk_maze_spawn_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_maze_spawn_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS event_snapshots (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        type VARCHAR(16) NOT NULL,
        payload_json LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        PRIMARY KEY (id),
        KEY idx_snapshots_lookup (guild_id, rust_server_id, type, expires_at),
        CONSTRAINT fk_snapshots_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_snapshots_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS web_push_subscriptions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        discord_user_id BIGINT UNSIGNED NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh VARCHAR(255) NOT NULL,
        auth VARCHAR(128) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_wpush_endpoint (endpoint(768)),
        KEY idx_wpush_user (discord_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS web_push_server_scope (
        discord_user_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (discord_user_id, rust_server_id),
        KEY idx_wpush_scope_user (discord_user_id),
        KEY idx_wpush_scope_server (rust_server_id),
        CONSTRAINT fk_wpush_scope_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS docked_cargo_configs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        guild_id BIGINT UNSIGNED NOT NULL,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        coord_x DOUBLE NULL,
        coord_y DOUBLE NULL,
        coord_z DOUBLE NULL,
        how_often_hours DECIMAL(12,4) NULL,
        in_game_message TEXT NULL,
        say_enabled TINYINT(1) NOT NULL DEFAULT 1,
        leave_message TEXT NULL,
        locked_crates TINYINT UNSIGNED NULL,
        time_docked_minutes INT UNSIGNED NULL,
        announcement_channel_id VARCHAR(32) NULL,
        announcement_role_id VARCHAR(32) NULL,
        automation_started TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_docked_cargo_server (guild_id, rust_server_id),
        CONSTRAINT fk_docked_cargo_guild FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
        CONSTRAINT fk_docked_cargo_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ignoreDup("ALTER TABLE docked_cargo_configs ADD COLUMN announcement_role_id VARCHAR(32) NULL");
    await ignoreDup(
      "ALTER TABLE docked_cargo_configs ADD COLUMN automation_phase VARCHAR(16) NULL COMMENT 'docked|between'"
    );
    await ignoreDup("ALTER TABLE docked_cargo_configs ADD COLUMN phase_deadline_ms BIGINT UNSIGNED NULL");

    await ignoreDup("ALTER TABLE koth_events ADD COLUMN lobby_ends_at TIMESTAMP NULL");
    await ignoreDup("ALTER TABLE koth_configs ADD COLUMN how_often_hours DECIMAL(12,4) NULL");
    await ignoreDup("ALTER TABLE koth_configs ADD COLUMN waves INT UNSIGNED NULL");
    await ignoreDup("ALTER TABLE koth_configs ADD COLUMN duration_per_wave_min INT UNSIGNED NULL");
    await ignoreDup("ALTER TABLE koth_configs ADD COLUMN kit_name VARCHAR(64) NULL");
    await ignoreDup(
      "ALTER TABLE koth_configs ADD COLUMN automation_started TINYINT(1) NOT NULL DEFAULT 0"
    );
    await ignoreDup("ALTER TABLE koth_configs ADD COLUMN next_lobby_at_ms BIGINT UNSIGNED NULL");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS site_inbox (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        target_discord_user_id BIGINT UNSIGNED NOT NULL,
        kind VARCHAR(64) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        payload_json JSON NULL,
        read_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_site_inbox_target_unread (target_discord_user_id, read_at),
        KEY idx_site_inbox_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS server_metrics_samples (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        rust_server_id BIGINT UNSIGNED NOT NULL,
        captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        server_time DATETIME NULL,
        entity_count INT UNSIGNED NOT NULL,
        framerate DOUBLE NOT NULL,
        memory_mb INT UNSIGNED NOT NULL,
        players SMALLINT UNSIGNED NOT NULL,
        PRIMARY KEY (id),
        KEY idx_server_metrics_server_captured (rust_server_id, captured_at),
        CONSTRAINT fk_server_metrics_server FOREIGN KEY (rust_server_id) REFERENCES rust_servers (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } finally {
    conn.release();
  }
}
