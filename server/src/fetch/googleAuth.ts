import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { SourceAccessError, readBody } from "./fetchCsv.js";

const exec = promisify(execFile);
const tokenName = "google-token.json";
const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";
const driveScope = "https://www.googleapis.com/auth/drive.readonly";
export const loginRequired = "Run npm run google-login";
const loginTimeout = 5 * 60_000;

function credentials() {
  const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!client_id || !client_secret)
    throw new SourceAccessError(
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env",
    );
  return { client_id, client_secret };
}

export function safeGoogleMessage(message: string, secrets: string[]) {
  for (const secret of secrets.filter(Boolean))
    for (const form of new Set([secret, encodeURIComponent(secret)]))
      message = message.replaceAll(form, "[redacted]");
  return message;
}

export function adminBlocked(value: string) {
  return /admin[_ ]policy[_ ]enforced|access[_ ]policy[_ ]enforced|administrator|admin policy|domain policy/i.test(
    value,
  );
}

export async function googleRequest(
  url: string | URL,
  options: RequestInit,
  request: typeof fetch,
) {
  try {
    return await request(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SourceAccessError("Could not reach Google. Try again.");
  }
}

export async function googleJson(
  response: Response,
  limit = 64 * 1024,
): Promise<unknown> {
  try {
    return JSON.parse(await readBody(response, limit));
  } catch {
    throw new SourceAccessError(
      "Google returned an unreadable response",
      response.status,
    );
  }
}

async function exchange(fields: Record<string, string>, request: typeof fetch) {
  const client = credentials();
  const form = { ...client, ...fields };
  const response = await googleRequest(
    "https://oauth2.googleapis.com/token",
    { method: "POST", body: new URLSearchParams(form) },
    request,
  );
  const result = (await googleJson(response)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof result?.error === "string" ? result.error : "";
    const description =
      typeof result?.error_description === "string"
        ? result.error_description
        : "";
    const message = adminBlocked(code + " " + description)
      ? safeGoogleMessage(description || code, Object.values(form))
      : code === "invalid_grant" || response.status === 401
        ? loginRequired
        : "Google sign-in failed. Check the Desktop OAuth client settings.";
    throw new SourceAccessError(message, response.status);
  }
  const granted =
    typeof result?.scope === "string"
      ? result.scope.split(/\s+/).filter(Boolean)
      : [];
  if (
    granted.length &&
    (!granted.includes(scope) ||
      granted.some((value) => value !== scope && value !== driveScope))
  )
    throw new SourceAccessError(
      "Google returned permissions outside the configured read-only scope",
    );
  return result;
}

async function readToken(dataDir: string) {
  try {
    const refresh_token = JSON.parse(
      await readFile(join(dataDir, tokenName), "utf8"),
    )?.refresh_token;
    if (typeof refresh_token === "string" && refresh_token)
      return refresh_token;
  } catch (error) {
    if (
      !(error instanceof SyntaxError) &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    )
      throw new SourceAccessError("Could not read the Google token file");
  }
  return null;
}

async function saveToken(dataDir: string, refresh_token: string) {
  let staging: string | undefined;
  try {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    staging = await mkdtemp(join(dataDir, ".google-login-"));
    const file = join(staging, tokenName);
    if (process.platform === "win32") {
      const { stdout } = await exec(
        "whoami.exe",
        ["/user", "/fo", "csv", "/nh"],
        { windowsHide: true },
      );
      const sid = /S-1-(?:\d+-)*\d+/.exec(stdout)?.[0];
      if (!sid) throw new Error("Missing user SID");
      await exec(
        "icacls.exe",
        [staging, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F"],
        { windowsHide: true },
      );
      await writeFile(file, "", { flag: "wx" });
      // Make the file ACL explicit so it stays private when moved out of staging.
      await exec(
        "icacls.exe",
        [file, "/inheritance:r", "/grant:r", "*" + sid + ":F"],
        { windowsHide: true },
      );
      await writeFile(file, JSON.stringify({ refresh_token }));
    } else {
      await writeFile(file, JSON.stringify({ refresh_token }), {
        flag: "wx",
        mode: 0o600,
      });
    }
    await rename(file, join(dataDir, tokenName));
  } catch {
    throw new SourceAccessError(
      "Could not save the Google token with owner-only permissions in DATA_DIR",
    );
  } finally {
    if (staging) {
      await unlink(join(staging, tokenName)).catch(() => {});
      await rmdir(staging).catch(() => {});
    }
  }
}

export async function googleAccessToken(
  dataDir: string,
  request: typeof fetch,
) {
  const refreshToken = await readToken(dataDir);
  if (!refreshToken) throw new SourceAccessError(loginRequired);
  const result = await exchange(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    request,
  );
  if (typeof result?.access_token !== "string" || !result.access_token)
    throw new SourceAccessError(loginRequired);
  return { accessToken: result.access_token, refreshToken };
}

async function openBrowser(url: string) {
  if (process.platform === "win32") {
    await exec("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
      windowsHide: true,
    });
  } else {
    await exec(process.platform === "darwin" ? "open" : "xdg-open", [url]);
  }
}

export async function googleLogin(
  dataDir: string,
  open = openBrowser,
  request = fetch,
  withDrive = false,
) {
  const { client_id } = credentials();
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    const redirect_uri = "http://127.0.0.1:" + port + "/oauth2/callback";
    const authorization = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    authorization.search = new URLSearchParams({
      client_id,
      redirect_uri,
      state,
      scope: withDrive ? scope + " " + driveScope : scope,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "select_account consent",
    }).toString();
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Google sign-in timed out. Check the browser and retry."),
          ),
        loginTimeout,
      );
      server.on("request", (req, res) => {
        const callback = new URL(
          "http://127.0.0.1:" +
            port +
            (req.url?.startsWith("/") ? req.url : "/"),
        );
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        if (
          req.method !== "GET" ||
          callback.pathname !== "/oauth2/callback" ||
          callback.searchParams.get("state") !== state
        ) {
          res.writeHead(400).end("Invalid Google sign-in callback.");
          return;
        }
        clearTimeout(timer);
        const value = callback.searchParams.get("code");
        const error = callback.searchParams.get("error") ?? "";
        const description =
          callback.searchParams.get("error_description") ?? "";
        if (!value || error) {
          res
            .writeHead(400)
            .end("Google sign-in failed. Return to the terminal.");
          reject(
            new Error(
              adminBlocked(error + " " + description)
                ? safeGoogleMessage(description || error, [
                    client_id,
                    state,
                    verifier,
                    value ?? "",
                  ])
                : "Google sign-in was not completed.",
            ),
          );
          return;
        }
        res.end(
          "Google returned to Team Dashboard. Check the terminal for the sign-in result.",
        );
        resolve(value);
      });
      void open(authorization.href).catch(() => {
        clearTimeout(timer);
        reject(new Error("Could not open the browser for Google sign-in."));
      });
    });
    const result = await exchange(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri,
      },
      request,
    );
    if (typeof result?.refresh_token !== "string" || !result.refresh_token)
      throw new Error(
        "Google did not return a refresh token. " + loginRequired,
      );
    if (
      withDrive &&
      (typeof result.scope !== "string" ||
        !result.scope.split(/\s+/).includes(driveScope))
    )
      throw new Error(
        "Google did not grant the requested read-only Drive permission.",
      );
    await saveToken(dataDir, result.refresh_token);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

export async function googleLogout(dataDir: string, request = fetch) {
  const token = await readToken(dataDir);
  if (token) {
    const response = await googleRequest(
      "https://oauth2.googleapis.com/revoke",
      { method: "POST", body: new URLSearchParams({ token }) },
      request,
    );
    if (!response.ok) {
      const body = (await googleJson(response)) as { error?: unknown } | null;
      if (response.status !== 400 || body?.error !== "invalid_token")
        throw new Error(
          "Google could not revoke the token. Retry google-logout.",
        );
    }
  }
  await unlink(join(dataDir, tokenName)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT")
        throw new Error("Could not delete the Google token file");
    },
  );
}
