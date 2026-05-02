// PayPal Webhook -> Netlify Function -> Discord webhook notifier
// Node 18+ provides global fetch (Netlify Functions runtime does too).
//
// Required env vars (Netlify Site settings -> Environment variables):
// - PAYPAL_CLIENT_ID
// - PAYPAL_CLIENT_SECRET
// - PAYPAL_MODE            ("sandbox" or "live")
// - PAYPAL_WEBHOOK_ID      (from PayPal webhook config)
// - DISCORD_SALES_WEBHOOK_URL  (preferred — webhook for #sales / store channel)
// - DISCORD_WEBHOOK_URL        (fallback if sales URL unset)

function header(event, name) {
  const h = event.headers || {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

async function getPaypalAccessToken(baseUrl, clientId, clientSecret) {
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PayPal auth failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error("PayPal auth response missing access_token");
  return data.access_token;
}

async function verifyPaypalWebhookSignature({ baseUrl, accessToken, webhookId, event, rawBody }) {
  const transmissionId = header(event, "paypal-transmission-id");
  const transmissionTime = header(event, "paypal-transmission-time");
  const certUrl = header(event, "paypal-cert-url");
  const authAlgo = header(event, "paypal-auth-algo");
  const transmissionSig = header(event, "paypal-transmission-sig");

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return { ok: false, reason: "missing_signature_headers" };
  }

  const payload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
    webhook_event: JSON.parse(rawBody),
  };

  const res = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, reason: `verify_api_${res.status}`, details: text };
  }
  const data = JSON.parse(text);
  return { ok: data.verification_status === "SUCCESS", status: data.verification_status };
}

/** Discord snowflake — store sends this as purchase_units[].custom_id from create-paypal-order. */
function parseDiscordUserIdFromCustomId(raw) {
  const s = String(raw ?? "").trim();
  return /^\d{17,20}$/.test(s) ? s : null;
}

function collectPayerFromCapture(resource) {
  const direct = resource.payer || {};
  let email = direct.email_address ?? resource.payer_email ?? null;
  let given = direct.name?.given_name ?? "";
  let surname = direct.name?.surname ?? "";
  let name = [given, surname].join(" ").trim() || null;

  const units = resource.purchase_units;
  if (Array.isArray(units) && units.length > 0) {
    const pu = units[0];
    const ship = pu?.shipping?.name?.full_name || pu?.shipping?.name;
    if (typeof ship === "string" && ship.trim()) name = name || ship.trim();
    const pe = pu?.payee?.email_address;
    if (pe) email = email || pe;
  }

  const alt = resource.payment_source?.paypal?.email_address;
  if (alt) email = email || alt;

  return { name, email };
}

function formatPurchaseMessage(webhookEvent) {
  const resource = webhookEvent.resource || {};

  const amountVal = resource.amount?.value ?? null;
  const amountCur = resource.amount?.currency_code ?? "EUR";
  const captureId = resource.id ?? null;

  const customRaw =
    resource.custom_id ??
    resource.invoice_id ??
    resource.supplementary_data?.related_ids?.transaction_id ??
    null;
  const discordUid = parseDiscordUserIdFromCustomId(customRaw);

  const { name: payerName, email: payerEmail } = collectPayerFromCapture(resource);

  const money =
    amountVal != null ? `${amountVal} ${amountCur}` : "N/A";

  /** Prefer Discord mention when create-paypal-order set custom_id to Discord user id */
  let buyerLine;
  if (discordUid) {
    buyerLine = `<@${discordUid}> · \`${discordUid}\``;
  } else if (payerName || payerEmail) {
    buyerLine = [payerName, payerEmail].filter(Boolean).join(" · ") || "—";
  } else {
    buyerLine =
      "_(PayPal did not include payer details on this webhook — ensure checkout is logged in so orders include your Discord id on the PayPal request.)_";
  }

  const description = discordUid
    ? `<@${discordUid}> **|** **PayPal** payment captured.`
    : `**PayPal** payment captured.`;

  return {
    content: null,
    embeds: [
      {
        title: "🛒 Store Sale (PayPal)",
        description: description.slice(0, 4096),
        color: 0x6a0dad,
        fields: [
          { name: "Buyer", value: buyerLine.slice(0, 1024), inline: false },
          { name: "Payment type", value: "PayPal", inline: true },
          { name: "Amount", value: String(money).slice(0, 1024), inline: true },
          { name: "Capture ID", value: captureId ? String(captureId).slice(0, 1024) : "N/A", inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Lucid Store Hub · webhook (fulfillment message may follow from bot)" },
      },
    ],
  };
}

async function postToDiscord(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed (${res.status}): ${text}`);
  }
}

exports.handler = async (event) => {
  // PayPal sends POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
  const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
  const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
  const DISCORD_WEBHOOK_URL =
    String(process.env.DISCORD_SALES_WEBHOOK_URL || "").trim() ||
    String(process.env.DISCORD_WEBHOOK_URL || "").trim();

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_WEBHOOK_ID) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "PayPal webhook not configured",
        details: "Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID",
      }),
    };
  }
  if (!DISCORD_WEBHOOK_URL) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Discord webhook not configured",
        details: "Missing DISCORD_SALES_WEBHOOK_URL or DISCORD_WEBHOOK_URL",
      }),
    };
  }

  const baseUrl = PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  const rawBody = event.body || "";
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  // Only notify on a successful payment capture.
  const eventType = String(parsed.event_type || "");
  if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
    // Still return 200 so PayPal doesn't keep retrying.
    return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: true, eventType }) };
  }

  try {
    const accessToken = await getPaypalAccessToken(baseUrl, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
    const sig = await verifyPaypalWebhookSignature({
      baseUrl,
      accessToken,
      webhookId: PAYPAL_WEBHOOK_ID,
      event,
      rawBody,
    });

    if (!sig.ok) {
      console.error("[paypal-webhook] signature verification failed", sig);
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Invalid signature", sig }) };
    }

    const discordPayload = formatPurchaseMessage(parsed);
    await postToDiscord(DISCORD_WEBHOOK_URL, discordPayload);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("[paypal-webhook] error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Internal error", message: err?.message || String(err) }),
    };
  }
};

