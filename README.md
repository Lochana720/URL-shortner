# URL Shortener

A modern URL shortening service built with Cloudflare Workers and Supabase.

## Features

- **Fast URL shortening**: Create short, 6-character alphanumeric codes
- **Persistent storage**: URLs stored in Supabase PostgreSQL
- **Automatic redirects**: 301 redirects from short codes to original URLs
- **CORS support**: Works seamlessly with any frontend
- **Error handling**: Comprehensive validation and error messages
- **Security headers**: Includes X-Frame-Options and content-type protection

## Setup

1. Clone and install dependencies
```bash
npm install
```

2. Set environment secrets
```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
```

3. Deploy
```bash
wrangler deploy
```

## API Endpoints

### POST /shorten
Creates a new short URL mapping.

**Request:**
```json
{
  "longUrl": "https://example.com/very/long/url"
}
```

**Response:**
```json
{
  "shortCode": "AbC123"
}
```

### GET /:shortCode
Redirects to the original long URL.

**Response:** 301 redirect to long URL

## Frontend

Open `index.html` in a browser to use the interactive UI. Update the Worker endpoint URL to match your deployed Workers subdomain.

## License

MIT
