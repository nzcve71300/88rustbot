// Shared Discord sale notification for Netlify functions.
// Uses DISCORD_SALES_WEBHOOK_URL if set, else DISCORD_WEBHOOK_URL.

function getSiteBaseUrl(event) {
  const h = event.headers || {};
  const proto = (h['x-forwarded-proto'] || h['X-Forwarded-Proto'] || 'https').toString().split(',')[0].trim();
  const host =
    h['x-forwarded-host'] ||
    h['X-Forwarded-Host'] ||
    h.host ||
    h.Host;
  if (host) return `${proto === 'http' ? 'http' : 'https'}://${String(host).split(',')[0].trim()}`;
  const origin = h.origin || h.Origin;
  if (origin) return String(origin).replace(/\/+$/, '');
  return null;
}

function formatSalesEmbed({ userId, username, items, amount, currency, imageUrl }) {
  const safeItems = Array.isArray(items) ? items : [];
  const firstName = safeItems[0]?.name ? String(safeItems[0].name) : 'Unknown Item';
  const moreCount = safeItems.length > 1 ? safeItems.length - 1 : 0;
  const itemLabel = moreCount > 0 ? `${firstName} (and ${moreCount} more)` : firstName;

  const buyer = userId ? `<@${String(userId)}>` : username ? String(username) : 'Unknown buyer';
  const money =
    amount != null ? `${String(amount)}${currency ? ` ${String(currency)}` : ''}`.trim() : 'N/A';

  const embed = {
    title: '🛒 Store Sale',
    description: `**${buyer}** Just Purchased **${itemLabel}**`,
    color: 0x6a0dad,
    fields: [{ name: 'Amount', value: String(money).slice(0, 1024), inline: false }],
    timestamp: new Date().toISOString(),
    footer: { text: 'Lucid Store Hub' },
  };

  if (imageUrl) embed.image = { url: imageUrl };
  return embed;
}

async function postWebhook(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Discord webhook failed (${res.status}): ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
}

/**
 * @param {object} opts
 * @param {object} opts.event - Netlify handler event (headers, etc.)
 * @param {string|null} [opts.userId]
 * @param {string|null} [opts.username]
 * @param {unknown} [opts.items]
 * @param {string|number|null} [opts.amount]
 * @param {string} [opts.currency]
 */
async function notifyDiscordSale(opts) {
  const { event, userId, username, items, amount, currency } = opts;
  const webhookUrl =
    process.env.DISCORD_SALES_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';

  if (!webhookUrl) {
    console.error(
      '[discord-sale-notify] No webhook URL. Set DISCORD_SALES_WEBHOOK_URL or DISCORD_WEBHOOK_URL in Netlify (or .env for netlify dev).'
    );
    return { ok: false, skipped: true, reason: 'missing_webhook_url' };
  }

  const explicitImage = (process.env.SALES_IMAGE_URL || '').trim();
  const base = getSiteBaseUrl(event);
  const derivedImage = base ? `${base.replace(/\/+$/, '')}/sales.png` : null;
  const imageUrl = explicitImage || derivedImage || null;

  const buildPayload = (includeImage) => {
    const embed = formatSalesEmbed({
      userId,
      username,
      items,
      amount,
      currency: currency || 'EUR',
      imageUrl: includeImage ? imageUrl : null,
    });
    return { embeds: [embed] };
  };

  try {
    await postWebhook(webhookUrl, buildPayload(!!imageUrl));
    return { ok: true };
  } catch (firstErr) {
    // Broken / missing sales.png URL often makes Discord return 400 for the whole payload.
    const status = firstErr && typeof firstErr === 'object' && 'status' in firstErr ? firstErr.status : null;
    if (imageUrl && status === 400) {
      console.warn('[discord-sale-notify] Retrying without embed image (first request failed).');
      try {
        await postWebhook(webhookUrl, buildPayload(false));
        return { ok: true, retriedWithoutImage: true };
      } catch (e) {
        console.error('[discord-sale-notify] Retry failed:', e);
        return { ok: false, error: String(e?.message || e) };
      }
    }
    console.error('[discord-sale-notify] Failed:', firstErr);
    return { ok: false, error: String(firstErr?.message || firstErr) };
  }
}

module.exports = { notifyDiscordSale, getSiteBaseUrl };
