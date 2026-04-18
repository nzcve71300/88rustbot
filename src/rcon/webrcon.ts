import WebSocket from "ws";

const CONNECT_TIMEOUT_MS = 18_000;
/** Consider it a "timeout" if the WebSocket never reaches OPEN within this window. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
const DEBUG_WS = process.env.DEBUG_WS === "1";

export type WebRconResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function buildUri(scheme: "ws" | "wss", host: string, port: number, password: string): string {
  return `${scheme}://${host}:${port}/${encodeURIComponent(password)}`;
}

function redactWebRconUri(uri: string): string {
  // Rust WebRCON puts the password in the path. Redact everything after the last slash.
  const lastSlash = uri.lastIndexOf("/");
  if (lastSlash === -1) return "<redacted>";
  return `${uri.slice(0, lastSlash + 1)}<redacted>`;
}

function wsReadyStateName(state: number): string {
  switch (state) {
    case WebSocket.CONNECTING:
      return "CONNECTING";
    case WebSocket.OPEN:
      return "OPEN";
    case WebSocket.CLOSING:
      return "CLOSING";
    case WebSocket.CLOSED:
      return "CLOSED";
    default:
      return String(state);
  }
}

function debugWs(...args: unknown[]): void {
  if (!DEBUG_WS) return;
  console.log("[rcon][debug-ws]", ...args);
}

function safeJsonPreview(raw: string, limit = 400): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}…(+${s.length - limit} chars)`;
}

function safeTryParseJson(raw: string): unknown | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function extractIdentifierCandidates(root: unknown): number[] {
  const out: number[] = [];
  const objects: Record<string, unknown>[] = [];
  collectJsonObjects(root, objects);
  for (const o of objects) {
    const idRaw = o.Identifier ?? o.identifier;
    if (idRaw === undefined || idRaw === null) continue;
    const n = Number(idRaw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

type RustRconMessage = {
  Identifier?: number;
  Message?: string;
  message?: string;
  Type?: number;
  Stacktrace?: string;
};

/** Collect every nested object so we can match Identifier (Rust sometimes wraps the payload). */
function collectJsonObjects(node: unknown, out: Record<string, unknown>[]): void {
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonObjects(item, out);
    return;
  }
  out.push(node as Record<string, unknown>);
  for (const v of Object.values(node)) {
    if (v && typeof v === "object") collectJsonObjects(v, out);
  }
}

function findResponseInParsedJson(root: unknown, identifier: number): RustRconMessage | null {
  const objects: Record<string, unknown>[] = [];
  collectJsonObjects(root, objects);
  for (const o of objects) {
    const idRaw = o.Identifier ?? o.identifier;
    if (idRaw === undefined || idRaw === null) continue;
    if (Number(idRaw) !== identifier) continue;
    const msg =
      typeof o.Message === "string"
        ? o.Message
        : typeof o.message === "string"
          ? o.message
          : "";
    const st =
      typeof o.Stacktrace === "string"
        ? o.Stacktrace
        : typeof o.stacktrace === "string"
          ? o.stacktrace
          : undefined;
    return { Identifier: Number(idRaw), Message: msg, Stacktrace: st };
  }
  return null;
}

function findResponseForIdentifier(raw: string, identifier: number): RustRconMessage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  /**
   * Rust WebRCON may send:
   * - a single JSON value (sometimes pretty-printed with newlines)
   * - NDJSON (one JSON value per line)
   *
   * Always try the whole payload first; only then fall back to per-line parsing.
   */
  try {
    const root = JSON.parse(trimmed) as unknown;
    const found = findResponseInParsedJson(root, identifier);
    if (found) return found;
  } catch {
    // not a single JSON value
  }

  if (!trimmed.includes("\n")) return null;

  const chunks = trimmed
    .split(/\n/)
    .map((c) => c.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    try {
      const root = JSON.parse(chunk) as unknown;
      const found = findResponseInParsedJson(root, identifier);
      if (found) return found;
    } catch {
      continue;
    }
  }

  return null;
}

function toUtf8String(data: WebSocket.RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}

/** Pull every text chunk Rust may send (JSON Message, NDJSON, or plain console lines). */
function emitPayloads(raw: string, onConsoleText: (text: string) => void): void {
  const s = raw.trim();
  if (!s) return;

  const tryObject = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    const msg =
      rec.Message ??
      rec.message ??
      rec.Content ??
      rec.content ??
      rec.Output ??
      rec.output ??
      rec.String ??
      rec.Log ??
      rec.log;
    if (typeof msg === "string" && msg.length > 0) {
      onConsoleText(msg);
    }
  };

  try {
    const one = JSON.parse(s) as unknown;
    if (typeof one === "string") {
      onConsoleText(one);
      return;
    }
    if (Array.isArray(one)) {
      for (const item of one) {
        if (typeof item === "string") onConsoleText(item);
        else tryObject(item);
      }
      return;
    }
    tryObject(one);
    return;
  } catch {
    /* not a single JSON value */
  }

  for (const line of s.split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as unknown;
      if (Array.isArray(o)) {
        for (const item of o) {
          if (typeof item === "string") onConsoleText(item);
          else tryObject(item);
        }
      } else {
        tryObject(o);
      }
    } catch {
      onConsoleText(t);
    }
  }
}

const VERIFY_COMMAND = "global.serverinfo";

/**
 * One WebSocket per **registered Rust server id** — even if two servers share the same IP/port/password
 * (they shouldn't), they will not share a connection. All kit/teleport/say/commands + console log for
 * that server share this one socket (queued).
 */
const sharedSessions = new Map<string, RconSharedSession>();

function sessionKey(rustServerId: number, host: string, port: number, password: string): string {
  return `${rustServerId}|${host}|${port}|${password}`;
}

class RconSharedSession {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private pending: {
    id: number;
    resolve: (r: WebRconResult) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly consoleSubs = new Set<(text: string) => void>();
  /** Serialize commands on this socket — one in-flight request at a time. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly password: string,
    private readonly label: string
  ) {}

  runCommand(commandLine: string): Promise<WebRconResult> {
    const run = this.chain.then(() => this.executeOne(commandLine));
    this.chain = run.then(
      () => {},
      () => {}
    );
    return run as Promise<WebRconResult>;
  }

  private async executeOne(commandLine: string): Promise<WebRconResult> {
    try {
      await this.ensureConnected();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { ok: false, error: "WebRcon socket is not connected." };
    }

    const identifier = Math.floor(Math.random() * 8_999_999) + 2;

    return await new Promise<WebRconResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id === identifier) {
          this.pending = null;
          debugWs(
            `${this.label} command response timeout after ${CONNECT_TIMEOUT_MS}ms (socket readyState=${
              this.ws ? wsReadyStateName(this.ws.readyState) : "null"
            }) cmd=${JSON.stringify(commandLine)} id=${identifier}`
          );
          resolve({
            ok: false,
            error:
              "Command response timed out. The WebSocket may be connected, but the server didn't send a matching response. Common causes: wrong port (not WebRCON), proxy/panel endpoint, server not echoing Identifier, or firewall dropping server->client traffic. With DEBUG_WS=1, check logs for incoming frames / unexpected-response.",
          });
        }
      }, CONNECT_TIMEOUT_MS);

      this.pending = {
        id: identifier,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        timer,
      };

      try {
        debugWs(`${this.label} send cmd id=${identifier} line=${JSON.stringify(commandLine)}`);
        this.ws!.send(
          JSON.stringify({
            Identifier: identifier,
            Message: commandLine,
            Name: "WebRcon",
          })
        );
      } catch (err) {
        this.pending = null;
        clearTimeout(timer);
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  private handleIncomingMessage(data: WebSocket.RawData): void {
    const raw = toUtf8String(data);

    if (this.pending) {
      if (DEBUG_WS) {
        const parsedOne = safeTryParseJson(raw);
        if (parsedOne) {
          debugWs(
            `${this.label} recv while pending id=${this.pending.id} jsonPreview=${safeJsonPreview(raw)} ids=${JSON.stringify(
              extractIdentifierCandidates(parsedOne)
            )}`
          );
        } else {
          debugWs(
            `${this.label} recv while pending id=${this.pending.id} nonJsonPreview=${safeJsonPreview(raw)}`
          );
        }
      }
      const parsed = findResponseForIdentifier(raw, this.pending.id);
      if (parsed) {
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        if (parsed.Stacktrace && parsed.Stacktrace.length > 0) {
          p.resolve({ ok: false, error: "Server rejected the command." });
        } else {
          p.resolve({ ok: true, message: parsed.Message ?? "" });
        }
        return;
      }
    }

    for (const cb of this.consoleSubs) {
      emitPayloads(raw, cb);
    }
  }

  subscribeConsole(onText: (text: string) => void): () => void {
    this.consoleSubs.add(onText);
    void this.ensureConnected().catch((err) => console.error(`[rcon] ${this.label} subscribe connect:`, err));
    return () => {
      this.consoleSubs.delete(onText);
    };
  }

  /** Avoid comparing `readyState` twice in one function — TS narrows and flags `=== OPEN` as impossible after the first guard. */
  private socketIsOpen(): boolean {
    const w = this.ws;
    return w !== null && w.readyState === WebSocket.OPEN;
  }

  private async ensureConnected(): Promise<void> {
    if (this.socketIsOpen()) return;
    if (this.connecting) {
      await this.connecting;
      if (this.socketIsOpen()) return;
    }
    this.connecting = this.openSocket();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private openSocket(): Promise<void> {
    const forceWss = process.env.WEBRCON_FORCE_WSS === "1";
    const forceWs = process.env.WEBRCON_FORCE_WS === "1";

    const schemes: ("ws" | "wss")[] = forceWss ? ["wss"] : forceWs ? ["ws"] : ["ws", "wss"];

    const attemptOne = (scheme: "ws" | "wss"): Promise<void> => {
      return new Promise((resolve, reject) => {
        const uri = buildUri(scheme, this.host, this.port, this.password);
        const uriForLog = redactWebRconUri(uri);
        const startedAt = Date.now();

        const ws = new WebSocket(uri);
        this.ws = ws;

        // Extra visibility when the socket "hangs" in CONNECTING.
        const readyStatePoll = setInterval(() => {
          debugWs(
            `${this.label} ${scheme.toUpperCase()} readyState=${wsReadyStateName(ws.readyState)} url=${uriForLog}`
          );
        }, 1000);

        const fail = (err: Error) => {
          try {
            clearInterval(readyStatePoll);
            ws.removeAllListeners();
            ws.terminate();
          } catch {
            /* ignore */
          }
          if (this.ws === ws) this.ws = null;
          reject(err);
        };

        const handshakeTimer = setTimeout(() => {
          const elapsedMs = Date.now() - startedAt;
          const rs = wsReadyStateName(ws.readyState);
          fail(
            new Error(
              `WebRCON WebSocket handshake timeout after ${elapsedMs}ms (readyState=${rs}). URL=${uriForLog}`
            )
          );
        }, HANDSHAKE_TIMEOUT_MS);

        ws.on("open", () => {
          clearTimeout(handshakeTimer);
          clearInterval(readyStatePoll);
          const elapsedMs = Date.now() - startedAt;
          console.log(
            `[rcon] shared socket connected ${this.label} (${scheme.toUpperCase()} open in ${elapsedMs}ms)`
          );
          try {
            ws.send(
              JSON.stringify({
                Identifier: 91001,
                Message: 'server.chatlog "True"',
                Name: "WebRcon",
              })
            );
            ws.send(
              JSON.stringify({
                Identifier: 91002,
                Message: 'relationshipmanager.logteamactions "1"',
                Name: "WebRcon",
              })
            );
          } catch (err) {
            console.error(`[rcon] ${this.label}: failed to enable server logging`, err);
          }
          resolve();
        });

        ws.on("message", (data) => this.handleIncomingMessage(data));

        ws.on("error", (err) => {
          clearTimeout(handshakeTimer);
          clearInterval(readyStatePoll);
          const elapsedMs = Date.now() - startedAt;
          const e = err instanceof Error ? err : new Error(String(err));
          if (DEBUG_WS) {
            console.error(
              `[rcon] ${this.label} websocket error (${scheme.toUpperCase()} after ${elapsedMs}ms, readyState=${wsReadyStateName(
                ws.readyState
              )}, url=${uriForLog})`,
              e
            );
          } else {
            console.error(
              `[rcon] ${this.label} websocket error (${scheme.toUpperCase()} after ${elapsedMs}ms): ${e.message}`
            );
          }
          fail(e);
        });

        // If the endpoint isn't actually WebSocket (wrong port, proxy, panel HTTP, etc),
        // ws will emit this with the HTTP response details.
        ws.on("unexpected-response", (_req, res) => {
          clearTimeout(handshakeTimer);
          clearInterval(readyStatePoll);
          const elapsedMs = Date.now() - startedAt;
          const status = (res as { statusCode?: number; statusMessage?: string }).statusCode;
          const statusMsg = (res as { statusMessage?: string }).statusMessage;
          const msg = `Unexpected HTTP response during WebSocket upgrade (${scheme.toUpperCase()} after ${elapsedMs}ms): ${status ?? "?"} ${statusMsg ?? ""
            } url=${uriForLog}`.trim();
          console.error(`[rcon] ${this.label} ${msg}`);
          fail(new Error(msg));
        });

        ws.once("close", (code, reason) => {
          clearTimeout(handshakeTimer);
          clearInterval(readyStatePoll);
          if (this.ws === ws) this.ws = null;
          if (this.pending) {
            clearTimeout(this.pending.timer);
            const p = this.pending;
            this.pending = null;
            p.resolve({
              ok: false,
              error: reason?.toString()?.trim()
                ? `Connection closed (${code}): ${reason.toString()}`
                : `Connection closed before a response (${code}).`,
            });
          }
          const elapsedMs = Date.now() - startedAt;
          console.warn(
            `[rcon] shared socket closed ${this.label} (${scheme.toUpperCase()} ${code}) after ${elapsedMs}ms${reason ? ` ${reason.toString()}` : ""
            }`
          );
          // If close happens before open, treat it as a connection failure for this attempt.
          if (ws.readyState !== WebSocket.OPEN) {
            fail(
              new Error(
                `WebRCON socket closed before OPEN (${code}) after ${elapsedMs}ms. URL=${uriForLog}`
              )
            );
          }
        });

        console.log(
          `[rcon] connecting ${this.label} -> ${scheme} (readyState=${wsReadyStateName(ws.readyState)}) url=${uriForLog}`
        );

        debugWs(
          `${this.label} ${scheme.toUpperCase()} handshake deadline=${HANDSHAKE_TIMEOUT_MS}ms (command timeout=${CONNECT_TIMEOUT_MS}ms)`
        );
      });
    };

    return (async () => {
      let lastErr: unknown = null;
      for (let i = 0; i < schemes.length; i++) {
        const scheme = schemes[i]!;
        try {
          if (i > 0) {
            console.warn(`[rcon] ${this.label} trying ${scheme.toUpperCase()} after prior failure…`, lastErr);
          }
          await attemptOne(scheme);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "WebRCON connection failed")));
    })();
  }
}

function getSharedSession(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  label: string
): RconSharedSession {
  const key = sessionKey(rustServerId, host, port, password);
  let s = sharedSessions.get(key);
  if (!s) {
    s = new RconSharedSession(host, port, password, label);
    sharedSessions.set(key, s);
  }
  return s;
}

export function verifyWebRconConnection(
  rustServerId: number,
  host: string,
  port: number,
  password: string
): Promise<WebRconResult> {
  return getSharedSession(rustServerId, host, port, password, `${host}:${port}`).runCommand(VERIFY_COMMAND);
}

/** All commands for a server share one WebSocket (queued). */
export function runWebRconCommand(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  commandLine: string
): Promise<WebRconResult> {
  return getSharedSession(rustServerId, host, port, password, `${host}:${port}`).runCommand(commandLine);
}

export type ConsoleStreamHandle = { stop: () => void };

/**
 * Console log stream uses the **same** persistent WebSocket as {@link runWebRconCommand} for that server.
 */
export function startConsoleStream(
  rustServerId: number,
  host: string,
  port: number,
  password: string,
  onConsoleText: (text: string) => void,
  label: string
): ConsoleStreamHandle {
  const unsub = getSharedSession(rustServerId, host, port, password, label).subscribeConsole(onConsoleText);
  return {
    stop() {
      unsub();
    },
  };
}
