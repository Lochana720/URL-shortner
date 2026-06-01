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

    // Serve a small landing response at the root path so GET / does not return 404.
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        JSON.stringify({
          message: "URL shortener Worker is running.",
          routes: {
            shorten: "POST /shorten",
            redirect: "GET /:shortCode",
          },
        }),
        {
          status: 200,
          headers: corsHeaders,
        }
      );
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
