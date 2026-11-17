#!/usr/bin/env node
// Comprobación de humo de solo lectura para un despliegue de staging.
//
// Uso:
//   node scripts/smoke-staging.mjs <URL_WEB> [URL_BACKEND]
//   UNIFOOD_BACKEND_URL=<URL_BACKEND> node scripts/smoke-staging.mjs <URL_WEB>
//
// Solo hace peticiones GET, sin credenciales, sin cookies y sin enviar datos. No imprime
// cuerpos de respuesta ni cabeceras; solo estado, ruta y motivo. Códigos de salida: 0 todo OK,
// 1 algún FALLO, 2 uso incorrecto.

const TIMEOUT_MS = 15_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function usage(message) {
  console.error(
    `Uso: node scripts/smoke-staging.mjs <URL_WEB> [URL_BACKEND]\n${message}`,
  );
  process.exit(2);
}

// Acepta solo HTTPS (HTTP únicamente en loopback) y sin credenciales ni query.
function parseBaseUrl(name, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    usage(`${name} no es una URL válida.`);
  }
  const secure = url.protocol === "https:";
  const loopbackHttp =
    url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !loopbackHttp)
    usage(`${name} debe usar HTTPS (HTTP solo en localhost).`);
  if (url.username || url.password || url.search || url.hash) {
    usage(`${name} no debe incluir credenciales, query ni fragmento.`);
  }
  return url.origin;
}

async function request(url) {
  return fetch(url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function describeError(error) {
  // Solo el tipo de error: los mensajes de red pueden contener la URL completa.
  return error?.name === "TimeoutError"
    ? "tiempo de espera agotado"
    : "error de red";
}

async function check(label, run) {
  try {
    const result = await run();
    return { label, ok: result.ok, detail: result.detail };
  } catch (error) {
    return { label, ok: false, detail: describeError(error) };
  }
}

function expectRedirectTo(response, base, expectedPath) {
  const location = response.headers.get("location");
  const target = location ? new URL(location, base).pathname : "(sin Location)";
  const ok = REDIRECT_CODES.has(response.status) && target === expectedPath;
  return { ok, detail: `HTTP ${response.status} → ${target}` };
}

async function main() {
  const [webArgument, backendArgument] = process.argv.slice(2);
  if (!webArgument) usage("Falta la URL base de la web.");

  const web = parseBaseUrl("URL_WEB", webArgument);
  const backendRaw = backendArgument ?? process.env.UNIFOOD_BACKEND_URL;
  const backend = backendRaw ? parseBaseUrl("URL_BACKEND", backendRaw) : null;

  const checks = [];

  if (backend) {
    checks.push(
      check("backend /actuator/health", async () => {
        const response = await request(`${backend}/actuator/health`);
        let status = null;
        try {
          status = (await response.json())?.status ?? null;
        } catch {
          status = null;
        }
        const ok = response.status === 200 && status === "UP";
        return {
          ok,
          detail: `HTTP ${response.status}, status ${status ?? "desconocido"}`,
        };
      }),
    );
  } else {
    checks.push(
      Promise.resolve({
        label: "backend /actuator/health",
        ok: null,
        detail: "sin URL del backend (argumento 2 o UNIFOOD_BACKEND_URL)",
      }),
    );
  }

  checks.push(
    check("web responde en /", async () => {
      const response = await request(`${web}/`);
      return {
        ok: response.status >= 200 && response.status < 300,
        detail: `HTTP ${response.status}`,
      };
    }),
    check("/worker exige login", async () => {
      return expectRedirectTo(
        await request(`${web}/worker`),
        web,
        "/panel/login",
      );
    }),
    check("/admin exige login", async () => {
      return expectRedirectTo(
        await request(`${web}/admin`),
        web,
        "/panel/login",
      );
    }),
    check("/cuenta exige login", async () => {
      return expectRedirectTo(await request(`${web}/cuenta`), web, "/login");
    }),
    check("API BFF sin sesión responde 401", async () => {
      const response = await request(`${web}/api/me/context`);
      return { ok: response.status === 401, detail: `HTTP ${response.status}` };
    }),
  );

  const results = await Promise.all(checks);
  let failures = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.ok === null) {
      skipped += 1;
      console.log(`[OMITIDO] ${result.label}: ${result.detail}`);
    } else if (result.ok) {
      console.log(`[OK] ${result.label}: ${result.detail}`);
    } else {
      failures += 1;
      console.log(`[FALLO] ${result.label}: ${result.detail}`);
    }
  }
  const passed = results.length - failures - skipped;
  console.log(
    `\nResultado: ${passed} OK, ${failures} FALLO, ${skipped} OMITIDO`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

await main();
