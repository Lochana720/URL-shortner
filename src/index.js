// Export the default Worker module so Cloudflare can invoke fetch() for incoming requests.
export default {
  // Handle every incoming HTTP request.
  async fetch(request, env) {
    // Define CORS headers once so we can reuse them in every response.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    // Handle browser preflight requests for CORS.
    if (request.method === "OPTIONS") {
      // Return an empty successful response for preflight checks.
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Parse the URL so we can route by pathname.
    const url = new URL(request.url);

    // Handle POST /shorten to create a short code.
    if (request.method === "POST" && url.pathname === "/shorten") {
      // Delegate creation logic to a dedicated handler.
      return handleShorten(request, env, corsHeaders);
    }

    // Handle GET /:shortCode to resolve and redirect.
    if (request.method === "GET") {
      // Split pathname into segments and remove empty entries.
      const pathSegments = url.pathname.split("/").filter(Boolean);

      // Match exactly one segment, like /abc123, and avoid routing /shorten as a code.
      if (pathSegments.length === 1 && pathSegments[0] !== "shorten") {
        // Decode and forward the short code to the redirect handler.
        const shortCode = decodeURIComponent(pathSegments[0]);
        return handleResolveShortCode(shortCode, env, corsHeaders);
      }
    }

    // Return method-not-allowed only when path exists but method is wrong.
    if (url.pathname === "/shorten") {
      // Inform clients that only POST is supported for /shorten.
      return jsonResponse(
        { error: "Method not allowed. Use POST for /shorten." },
        405,
        corsHeaders
      );
    }

    // Return not-found for unsupported paths.
    return jsonResponse({ error: "Not found." }, 404, corsHeaders);
  },
};

// Handle creation of a new short URL mapping via POST /shorten.
async function handleShorten(request, env, corsHeaders) {
  try {
    // Attempt to parse the request JSON body.
    const body = await request.json();

    // Pull longUrl from the parsed request body.
    const longUrl = body?.longUrl;

    // Validate that longUrl is a non-empty string.
    if (typeof longUrl !== "string" || longUrl.trim() === "") {
      // Return a validation error if longUrl is missing or invalid.
      return jsonResponse(
        { error: "Invalid request body. 'longUrl' is required." },
        400,
        corsHeaders
      );
    }

    // Validate that longUrl is a syntactically valid URL.
    try {
      // Constructing URL throws for malformed URLs.
      new URL(longUrl);
    } catch {
      // Return a validation error for malformed URL input.
      return jsonResponse(
        { error: "Invalid URL format for 'longUrl'." },
        400,
        corsHeaders
      );
    }

    // Read Supabase project URL from Worker environment variables.
    const supabaseUrl = env.SUPABASE_URL;

    // Read Supabase anon key from Worker environment variables.
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;

    // Ensure required environment variables are configured.
    if (!supabaseUrl || !supabaseAnonKey) {
      // Return a server configuration error when env vars are missing.
      return jsonResponse(
        {
          error:
            "Server misconfiguration. SUPABASE_URL and SUPABASE_ANON_KEY are required.",
        },
        500,
        corsHeaders
      );
    }

    // Generate a random 6-character alphanumeric short code.
    const shortCode = generateShortCode(6);

    // Build the Supabase REST endpoint for inserting into the urls table.
    const insertEndpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/urls`;

    // Insert the long URL and short code into Supabase using the REST API.
    const supabaseResponse = await fetch(insertEndpoint, {
      method: "POST",
      headers: {
        // Required content type for JSON insert payload.
        "Content-Type": "application/json",

        // Supabase REST requires apikey header.
        apikey: supabaseAnonKey,

        // Authorization header can also use the anon key for allowed inserts.
        Authorization: `Bearer ${supabaseAnonKey}`,

        // Ask Supabase to return inserted representation (useful for debugging/confirmation).
        Prefer: "return=representation",
      },
      // Send the table row payload as JSON object supported by PostgREST.
      body: JSON.stringify({
        short_code: shortCode,
        long_url: longUrl,
      }),
    });

    // If Supabase reports an error, read and return details.
    if (!supabaseResponse.ok) {
      // Try to parse Supabase error JSON; fallback to text if needed.
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
        if (errorText) {
          supabaseErrorMessage = errorText;
        }
      }

      // Return a bad-gateway style response because upstream persistence failed.
      return jsonResponse({ error: supabaseErrorMessage }, 502, corsHeaders);
    }

    // Return the generated short code in a successful JSON response.
    return jsonResponse({ shortCode }, 200, corsHeaders);
  } catch (error) {
    // Catch JSON parsing failures and any unexpected runtime errors.
    return jsonResponse(
      {
        error: "Internal server error.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
      corsHeaders
    );
  }
}

// Handle lookup and redirect for GET /:shortCode.
async function handleResolveShortCode(shortCode, env, corsHeaders) {
  try {
    // Validate that shortCode is present and appears to be a plausible token.
    if (!shortCode || shortCode.length === 0) {
      // Return not-found for missing path code.
      return jsonResponse({ error: "Not found." }, 404, corsHeaders);
    }

    // Read Supabase project URL from Worker environment variables.
    const supabaseUrl = env.SUPABASE_URL;

    // Read Supabase anon key from Worker environment variables.
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;

    // Ensure required environment variables are configured.
    if (!supabaseUrl || !supabaseAnonKey) {
      // Return a server configuration error when env vars are missing.
      return jsonResponse(
        {
          error:
            "Server misconfiguration. SUPABASE_URL and SUPABASE_ANON_KEY are required.",
        },
        500,
        corsHeaders
      );
    }

    // Build Supabase query endpoint to select the matching long URL by short code.
    const queryEndpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/urls?select=long_url&short_code=eq.${encodeURIComponent(shortCode)}&limit=1`;

    // Query Supabase REST API for the short code mapping.
    const supabaseResponse = await fetch(queryEndpoint, {
      method: "GET",
      headers: {
        // Required for Supabase REST authentication.
        apikey: supabaseAnonKey,

        // Use anon key as bearer token for row-level policy checks.
        Authorization: `Bearer ${supabaseAnonKey}`,

        // Request JSON response format.
        Accept: "application/json",
      },
    });

    // Handle Supabase query failures.
    if (!supabaseResponse.ok) {
      // Try to parse a useful upstream error payload.
      let supabaseErrorMessage = "Failed to look up short URL in Supabase.";
      try {
        const errorBody = await supabaseResponse.json();
        supabaseErrorMessage =
          errorBody?.message ||
          errorBody?.error_description ||
          errorBody?.hint ||
          JSON.stringify(errorBody);
      } catch {
        const errorText = await supabaseResponse.text();
        if (errorText) {
          supabaseErrorMessage = errorText;
        }
      }

      // Return a bad-gateway style response for upstream read failure.
      return jsonResponse({ error: supabaseErrorMessage }, 502, corsHeaders);
    }

    // Parse the query result rows from Supabase.
    const rows = await supabaseResponse.json();

    // Return not-found when no matching short code row exists.
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0]?.long_url) {
      // Return 404 JSON if code is not present in the table.
      return jsonResponse({ error: "Short code not found." }, 404, corsHeaders);
    }

    // Read the resolved destination URL from the first result row.
    const destinationUrl = rows[0].long_url;

    // Return an HTTP 301 redirect to the destination URL.
    return new Response(null, {
      status: 301,
      headers: {
        // Set the destination for the redirect response.
        Location: destinationUrl,

        // Include CORS headers for consistency across responses.
        ...corsHeaders,
      },
    });
  } catch (error) {
    // Catch any unexpected runtime error during lookup or redirect response construction.
    return jsonResponse(
      {
        error: "Internal server error.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
      corsHeaders
    );
  }
}

// Helper to generate a random alphanumeric code of a given length.
function generateShortCode(length) {
  // Define the allowed characters for the short code.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  // Build the result progressively.
  let result = "";

  // Fill result with random characters until desired length is reached.
  for (let i = 0; i < length; i += 1) {
    // Pick a random index using cryptographically strong randomness when available in Workers.
    const randomIndex = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1) * chars.length);

    // Append the selected character to the result string.
    result += chars[randomIndex];
  }

  // Return the generated short code.
  return result;
}

// Helper to consistently return JSON responses with CORS headers.
function jsonResponse(payload, status, headers) {
  // Construct and return a standard JSON response.
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}
