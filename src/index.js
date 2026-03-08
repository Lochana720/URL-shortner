// Export the default Worker module.
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Handle POST /shorten for creating short codes
    if (request.method === "POST" && url.pathname === "/shorten") {
      return handleShorten(request, env, corsHeaders);
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
      const errorBody = await supabaseResponse.json().catch(() => ({}));
      return jsonResponse(
        { error: errorBody?.message || "Failed to save URL in Supabase." },
        502,
        corsHeaders
      );
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

// Helper to generate a random alphanumeric short code
function generateShortCode(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const randomIndex = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1) * chars.length);
    result += chars[randomIndex];
  }
  return result;
}

// Helper to return JSON responses with CORS headers
function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}
