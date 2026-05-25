# Zvornicanka Planogram

Web app for creating and managing retail planograms (shelf layouts) with Supabase.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and set your Supabase values:

```bash
cp .env.example .env
```

3. Apply Supabase migrations from `supabase/migrations/` in your Supabase SQL editor (especially `0007` and `0008`).

4. Start the dev server:

```bash
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy

Build the app with `npm run build` and deploy the `dist/` folder to any static host (Vercel, Netlify, Cloudflare Pages, etc.). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in your hosting provider.
