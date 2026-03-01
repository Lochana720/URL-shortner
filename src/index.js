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

    return jsonResponse({ shortCode: "ABC123" }, 200, corsHeaders);
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
