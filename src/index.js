// Export the default Worker module.
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Serve the front-end page at the root path.
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(landingPageHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Handle POST /shorten for creating short codes
    if (request.method === "POST" && url.pathname === "/shorten") {
      return handleShorten(request, env, corsHeaders);
    }

    // Handle GET /:shortCode to resolve and redirect.
    if (request.method === "GET") {
      const pathSegments = url.pathname.split("/").filter(Boolean);
      if (pathSegments.length === 1 && pathSegments[0] !== "shorten") {
        const shortCode = decodeURIComponent(pathSegments[0]);
        return handleResolveShortCode(shortCode, env, corsHeaders);
      }
    }

    return jsonResponse({ error: "Not found." }, 404, corsHeaders);
  },
};

// Handle creation of new short URL mappings via POST /shorten
async function handleShorten(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const longUrl = body?.longUrl;

    if (typeof longUrl !== "string" || longUrl.trim() === "") {
      return jsonResponse(
        { error: "Invalid request body. 'longUrl' is required." },
        400,
        corsHeaders
      );
    }

    // Validate that longUrl is a syntactically valid URL
    try {
      new URL(longUrl);
    } catch {
      return jsonResponse(
        { error: "Invalid URL format for 'longUrl'." },
        400,
        corsHeaders
      );
    }

    const supabaseUrl = env.SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(
        { error: "Server misconfiguration. Supabase env vars are required." },
        500,
        corsHeaders
      );
    }

    const shortCode = generateShortCode(6);
    const insertEndpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/urls`;

    const supabaseResponse = await fetch(insertEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        short_code: shortCode,
        long_url: longUrl,
      }),
    });

    if (!supabaseResponse.ok) {
      let supabaseErrorMessage = "Failed to save URL in Supabase.";
      try {
        const errorBody = await supabaseResponse.json();
        supabaseErrorMessage =
          errorBody?.message ||
          errorBody?.error_description ||
          errorBody?.hint ||
          JSON.stringify(errorBody);
      } catch {
        const errorText = await supabaseResponse.text();
        if (errorText) supabaseErrorMessage = errorText;
      }
      return jsonResponse({ error: supabaseErrorMessage }, 502, corsHeaders);
    }

    return jsonResponse({ shortCode }, 200, corsHeaders);
  } catch (error) {
    return jsonResponse(
      { error: "Internal server error.", details: error.message },
      500,
      corsHeaders
    );
  }
}

// Helper to generate a random alphanumeric short code with collision resistance
function generateShortCode(length) {
  // Define the allowed characters for diversity in short codes
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  
  // Use cryptographically secure random values for better entropy
  const randomValues = crypto.getRandomValues(new Uint32Array(length));
  
  for (let i = 0; i < length; i += 1) {
    // Map random value to character index using modulo
    const randomIndex = Math.floor((randomValues[i] / (0xffffffff + 1)) * chars.length);
    result += chars[randomIndex];
  }
  
  return result;
}

// Handle lookup and redirect for GET /:shortCode.
async function handleResolveShortCode(shortCode, env, corsHeaders) {
  try {
    if (!shortCode || shortCode.length === 0) {
      return jsonResponse({ error: "Not found." }, 404, corsHeaders);
    }

    const supabaseUrl = env.SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(
        { error: "Server misconfiguration. Supabase env vars are required." },
        500,
        corsHeaders
      );
    }

    const queryEndpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/urls?select=long_url&short_code=eq.${encodeURIComponent(shortCode)}&limit=1`;

    const supabaseResponse = await fetch(queryEndpoint, {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Accept: "application/json",
      },
    });

    if (!supabaseResponse.ok) {
      return jsonResponse({ error: "Failed to look up short URL." }, 502, corsHeaders);
    }

    const rows = await supabaseResponse.json();

    if (!Array.isArray(rows) || rows.length === 0 || !rows[0]?.long_url) {
      return jsonResponse({ error: "Short code not found." }, 404, corsHeaders);
    }

    const destinationUrl = rows[0].long_url;
    return new Response(null, {
      status: 301,
      headers: {
        Location: destinationUrl,
        ...corsHeaders,
      },
    });
  } catch (error) {
    return jsonResponse(
      { error: "Internal server error.", details: error.message },
      500,
      corsHeaders
    );
  }
}

// Helper to return JSON responses with CORS headers
function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}

// Static front-end HTML served from the Worker root route.
const landingPageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>URL Shortener</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body {
        display: grid;
        place-items: center;
        padding: 24px;
        color: #0f172a;
        background:
          radial-gradient(circle at 15% 20%, rgba(45, 212, 191, 0.28), transparent 22%),
          radial-gradient(circle at 85% 15%, rgba(96, 165, 250, 0.24), transparent 20%),
          radial-gradient(circle at 80% 80%, rgba(251, 191, 36, 0.18), transparent 24%),
          linear-gradient(135deg, #f8fafc 0%, #eef2ff 45%, #fdf2f8 100%);
        overflow-x: hidden;
        position: relative;
      }
      body::before,
      body::after {
        content: "";
        position: fixed;
        inset: auto;
        pointer-events: none;
        z-index: 0;
        filter: blur(22px);
        opacity: 0.55;
      }
      body::before {
        width: 280px;
        height: 280px;
        top: -70px;
        left: -70px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(99, 102, 241, 0.26), rgba(99, 102, 241, 0));
      }
      body::after {
        width: 320px;
        height: 320px;
        right: -90px;
        bottom: -100px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(16, 185, 129, 0.22), rgba(16, 185, 129, 0));
      }
      main { width: min(760px, 100%); position: relative; z-index: 1; }
      section {
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(20px);
        border-radius: 28px;
        padding: 42px;
        box-shadow:
          0 20px 60px rgba(15, 23, 42, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.65);
      }
      h1 { font-size: 2.35rem; margin: 0 0 14px; line-height: 1.08; letter-spacing: -0.04em; }
      p { margin: 0 0 28px; font-size: 1rem; color: #475569; line-height: 1.6; }
      form { display: grid; gap: 14px; }
      div { display: grid; grid-template-columns: 1fr auto; gap: 12px; }
      input {
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 18px;
        padding: 16px 18px;
        font-size: 1rem;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s, background 0.2s;
        background: rgba(255, 255, 255, 0.92);
      }
      input:hover { transform: translateY(-1px); }
      input:focus {
        border-color: rgba(14, 165, 233, 0.7);
        box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.14);
        background: #fff;
      }
      button {
        border: 0;
        border-radius: 18px;
        padding: 16px 22px;
        font-size: 1rem;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, #0f766e, #06b6d4 55%, #6366f1);
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s, filter 0.2s;
        box-shadow: 0 16px 34px rgba(15, 118, 110, 0.22);
      }
      button:hover { transform: translateY(-2px); box-shadow: 0 22px 40px rgba(15, 118, 110, 0.28); filter: saturate(1.04); }
      button:active { transform: translateY(0); }
      #result {
        margin-top: 22px;
        padding: 18px;
        border-radius: 20px;
        background: rgba(248, 250, 252, 0.9);
        border: 1px solid rgba(15, 23, 42, 0.08);
      }
      #result a { color: #0f766e; text-decoration: none; }
      #result a:hover { text-decoration: underline; }
      @media (max-width: 640px) { section { padding: 28px; border-radius: 22px; } h1 { font-size: 1.95rem; } div { grid-template-columns: 1fr; } button { width: 100%; } }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Turn long links into short URLs</h1>
        <p>Paste a long URL and generate a short link instantly.</p>

        <form id="shortenForm">
          <div>
            <input
              id="longUrl"
              name="longUrl"
              type="url"
              placeholder="https://example.com/very/long/link"
              required
            />
            <button type="submit">Shorten</button>
          </div>
        </form>

        <section id="result">
          <div>Your shortened link will appear here.</div>
        </section>
      </section>
    </main>

    <script>
      const form = document.getElementById("shortenForm");
      const input = document.getElementById("longUrl");
      const result = document.getElementById("result");
      const submitBtn = form.querySelector("button");

      const workerEndpoint = "https://url-shortener-worker.url-shortener-worker.workers.dev/shorten";
      const baseShortUrl = "https://url-shortener-worker.url-shortener-worker.workers.dev";

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const longUrl = input.value.trim();

        if (!longUrl) {
          result.innerHTML = "<div style='color: #b91c1c;'>Please enter a long URL first.</div>";
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Shortening...";
        result.innerHTML = "<div>Creating your short link...</div>";

        try {
          const response = await fetch(workerEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ longUrl }),
          });

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.error || "Unable to shorten the URL.");
          }

          const shortCode = data.shortCode;
          if (!shortCode) throw new Error("No short code returned.");

          const shortUrl = baseShortUrl + "/" + shortCode;
          result.innerHTML =
            '<div style="color: #0f766e;">' +
            '<div style="font-size: 0.8rem; text-transform: uppercase; color: #64748b; margin-bottom: 8px;">Short URL</div>' +
            '<div style="font-size: 1.1rem; font-weight: 700; word-break: break-all;"><a href="' + shortUrl + '" target="_blank" rel="noreferrer">' + shortUrl + '</a></div>' +
            '</div>';
        } catch (error) {
          result.innerHTML = '<div style="color: #b91c1c;">' + (error instanceof Error ? error.message : "Something went wrong.") + '</div>';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Shorten";
        }
      });
    </script>
  </body>
</html>`;
