const pool = require('../db');
const { EmbedBuilder } = require('discord.js');

const POLL_MS = 12_000;
const ONE_TIME_HOURS = 24;

/** Default sales channel if SALES_CHANNEL_ID is unset (Lucid store feed). */
const DEFAULT_SALES_CHANNEL_ID = '1495743337725038642';

function fmtEur(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0.00 EUR';
  return `${x.toFixed(2)} EUR`;
}

function fmtLucids(n) {
  const x = Math.max(0, Math.floor(Number(n) || 0));
  return new Intl.NumberFormat('en-US').format(x);
}

async function resolveRole(guild, roleName) {
  const want = String(roleName || '').trim();
  if (!want) return null;
  await guild.roles.fetch().catch(() => null);
  return (
    guild.roles.cache.find((role) => role.name === want) ||
    guild.roles.cache.find((role) => role.name.toLowerCase() === want.toLowerCase()) ||
    null
  );
}

async function fulfillRow(client, guild, salesChannel, row) {
  const items = JSON.parse(row.items_json);
  if (!Array.isArray(items) || items.length === 0) throw new Error('Empty items_json');

  const member = await guild.members.fetch(row.discord_user_id).catch(() => null);
  if (!member) throw new Error(`Member ${row.discord_user_id} not in guild`);

  const removeAt = new Date(Date.now() + ONE_TIME_HOURS * 60 * 60 * 1000);
  const removeTs = Math.floor(removeAt.getTime() / 1000);

  const finalRoleLines = [];

  for (const it of items) {
    const qty = Math.max(1, Math.min(5, Math.floor(Number(it.quantity) || 1)));
    const role = await resolveRole(guild, it.storeRoleName);
    if (!role) throw new Error(`Discord role not found: "${it.storeRoleName}"`);

    await member.roles.add(role, 'Lucid store purchase');
    if (it.kind === 'one-time') {
      for (let q = 0; q < qty; q++) {
        await pool.execute(
          `INSERT INTO lucid_store_temp_roles (discord_user_id, role_id, remove_at, fulfillment_id) VALUES (?,?,?,?)`,
          [row.discord_user_id, role.id, removeAt, row.id]
        );
      }
    }

    if (it.kind === 'one-time') {
      finalRoleLines.push(`• Added <@&${role.id}> (removes <t:${removeTs}:R>)`);
    } else {
      finalRoleLines.push(`• Added <@&${role.id}> (Lifetime)`);
    }
  }

  const itemLines = items.map((it) => {
    const qty = Math.max(1, Math.min(5, Math.floor(Number(it.quantity) || 1)));
    const tag = it.kind === 'one-time' ? 'One Time' : 'Lifetime';
    const qSuffix = qty > 1 ? ` ×${qty}` : '';
    return `• **[${tag}]** ${it.name}${qSuffix}`;
  });

  const lucidsEquiv = fmtLucids(Math.round(Number(row.amount_eur) * 100));
  let lucidsPart;
  if (String(row.payment_method || '').toLowerCase() === 'paypal') {
    lucidsPart =
      row.lucids_spent != null && Number(row.lucids_spent) > 0
        ? `${fmtEur(row.amount_eur)} (${fmtLucids(row.lucids_spent)} Lucids from balance + PayPal)`
        : `${fmtEur(row.amount_eur)} (${lucidsEquiv} Lucids value)`;
  } else {
    lucidsPart =
      row.lucids_spent != null
        ? `${fmtEur(row.amount_eur)} (${fmtLucids(row.lucids_spent)} Lucids)`
        : `${fmtEur(row.amount_eur)} (${lucidsEquiv} Lucids)`;
  }

  const paymentMethod = String(row.payment_method || '').toLowerCase() === 'paypal' ? 'PayPal' : 'Lucids';

  const uname = member.user?.username ?? 'user';
  const dname = member.displayName || uname;
  const saleHead = `**@${uname}** | **${dname}** just purchased:`;

  const embed = new EmbedBuilder()
    .setColor(0x6a0dad) // purple
    .setTitle('🛒 Store Sale')
    .setDescription(saleHead)
    .addFields(
      { name: 'Payment type', value: paymentMethod, inline: true },
      { name: 'Amount', value: lucidsPart, inline: true },
      { name: 'Items', value: itemLines.join('\n').slice(0, 1024) || '—', inline: false },
      { name: 'Roles', value: finalRoleLines.join('\n').slice(0, 1024) || '—', inline: false }
    )
    .setTimestamp(new Date());

  // Optional balance info (only available for Lucids when the website passes newBalance)
  const nbRaw = row.new_balance;
  const newBalance =
    typeof nbRaw === 'number'
      ? Math.max(0, Math.floor(nbRaw))
      : typeof nbRaw === 'string'
        ? Math.max(0, Math.floor(Number.parseInt(nbRaw, 10) || 0))
        : null;
  if (paymentMethod === 'Lucids' && newBalance != null && row.lucids_spent != null) {
    const before = Math.max(0, Math.floor(newBalance + Math.max(0, Math.floor(Number(row.lucids_spent) || 0))));
    embed.addFields({
      name: 'Lucids balance',
      value: `Before: **${fmtLucids(before)}**\nAfter: **${fmtLucids(newBalance)}**`,
      inline: true,
    });
  }

  await salesChannel.send({
    content: `<@${row.discord_user_id}>`,
    embeds: [embed],
    allowedMentions: { users: [row.discord_user_id] },
  });
}

async function processDueTempRoles(guild) {
  const [rows] = await pool.query(
    `SELECT id, discord_user_id, role_id FROM lucid_store_temp_roles
     WHERE remove_at <= UTC_TIMESTAMP(6) AND removed_at IS NULL
     ORDER BY id ASC LIMIT 25`
  );

  for (const r of rows) {
    const [res] = await pool.execute(
      `UPDATE lucid_store_temp_roles SET removed_at = UTC_TIMESTAMP(6) WHERE id = ? AND removed_at IS NULL`,
      [r.id]
    );
    if (!res || res.affectedRows !== 1) continue;

    const member = await guild.members.fetch(r.discord_user_id).catch(() => null);
    if (!member) continue;
    const role = guild.roles.cache.get(r.role_id) || (await guild.roles.fetch(r.role_id).catch(() => null));
    if (!role) continue;
    await member.roles.remove(role, 'Lucid store: one-time kit expired (24h)').catch(() => null);
  }
}

async function processPendingFulfillment(client, guild, salesChannel) {
  const [rows] = await pool.query(
    `SELECT * FROM lucid_store_fulfillment WHERE status = 'pending' ORDER BY id ASC LIMIT 3`
  );

  for (const row of rows) {
    const [res] = await pool.execute(
      `UPDATE lucid_store_fulfillment SET status = 'processing' WHERE id = ? AND status = 'pending'`,
      [row.id]
    );
    if (!res || res.affectedRows !== 1) continue;

    try {
      await fulfillRow(client, guild, salesChannel, row);
      await pool.execute(`UPDATE lucid_store_fulfillment SET status = 'done', processed_at = UTC_TIMESTAMP() WHERE id = ?`, [
        row.id,
      ]);
    } catch (e) {
      console.error('[LUCID][store] fulfillment failed', row.id, e);
      await pool
        .execute(
          `UPDATE lucid_store_fulfillment SET status = 'failed', error_text = ?, processed_at = UTC_TIMESTAMP() WHERE id = ?`,
          [String(e.message || e).slice(0, 900), row.id]
        )
        .catch(() => {});
    }
  }
}

/**
 * Fulfill a purchase immediately (used by the HTTP tunnel endpoint).
 * Expects the same "lines" structure the store catalog uses.
 */
async function fulfillPurchaseNow(client, payload) {
  const gid = process.env.GUILD_ID;
  const salesId = process.env.SALES_CHANNEL_ID || DEFAULT_SALES_CHANNEL_ID;
  if (!gid || !salesId) throw new Error('Missing GUILD_ID or SALES_CHANNEL_ID');

  const guild = client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
  if (!guild) throw new Error('Guild not found');

  const salesChannel = await guild.channels.fetch(salesId).catch(() => null);
  if (!salesChannel || !salesChannel.isTextBased()) throw new Error('SALES_CHANNEL_ID not usable');

  const discordUserId = String(payload?.discordUserId || '').trim();
  if (!discordUserId) throw new Error('Missing discordUserId');

  const lines = payload?.lines;
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Missing lines');

  const row = {
    id: null,
    discord_user_id: discordUserId,
    username: payload?.username == null ? null : String(payload.username),
    payment_method: String(payload?.paymentMethod || 'lucids').toLowerCase() === 'paypal' ? 'paypal' : 'lucids',
    amount_eur: Number(payload?.amountEur || 0),
    lucids_spent: payload?.lucidsSpent == null ? null : Math.max(0, Math.floor(Number(payload.lucidsSpent) || 0)),
    new_balance: payload?.newBalance == null ? null : payload.newBalance,
    items_json: JSON.stringify(lines),
  };

  await fulfillRow(client, guild, salesChannel, row);
  return { ok: true };
}

function startStoreFulfillmentPoller(client) {
  const tick = async () => {
    const gid = process.env.GUILD_ID;
    const salesId = process.env.SALES_CHANNEL_ID || DEFAULT_SALES_CHANNEL_ID;
    if (!gid || !salesId) return;

    const guild = client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
    if (!guild) return;

    const salesChannel = await guild.channels.fetch(salesId).catch(() => null);
    if (!salesChannel || !salesChannel.isTextBased()) {
      console.warn('[LUCID][store] SALES_CHANNEL_ID not usable');
      return;
    }

    await processDueTempRoles(guild).catch((e) => console.error('[LUCID][store] temp role sweep', e));
    await processPendingFulfillment(client, guild, salesChannel).catch((e) =>
      console.error('[LUCID][store] fulfillment poll', e)
    );
  };

  setInterval(() => void tick(), POLL_MS);
  void tick();
}

module.exports = { startStoreFulfillmentPoller, fulfillPurchaseNow };
