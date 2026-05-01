const crypto = require("crypto");

function fingerprintFromValidatedCart(v) {
  const s = v.lines.map((l) => `${l.id}:${l.quantity}`).sort().join("|");
  return crypto.createHash("sha256").update(s).digest("hex");
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = { fingerprintFromValidatedCart, round2 };
