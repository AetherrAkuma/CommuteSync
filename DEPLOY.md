# CommuteSync Deployment Guide

This guide covers how to deploy CommuteSync to **Render** (backend/API) and **Cloudflare Pages** (frontend).

---

## Prerequisites

1. **GitHub Repository** - Push your code to GitHub
2. **Supabase Project** - Have your Supabase URL and keys ready
3. **Domain** (optional) - Custom domain for Cloudflare

---

## Part 1: Deploy Backend to Render

Render is ideal for the Node.js/Express backend.

### Step 1: Create a Web Service on Render

1. Go to [render.com](https://render.com) and sign in
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Configure the service:

```
Name: commutesync-api
Environment: Node
Build Command: npm install
Start Command: node server.js
```

### Step 2: Set Environment Variables

Add these environment variables in Render dashboard:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Your Supabase anon key |
| `PORT` | 10000 |

### Step 3: Deploy

Click **Create Web Service**. Wait for deployment to complete.

Your API will be available at: `https://your-service-name.onrender.com`

---

## Part 2: Deploy Frontend to Cloudflare Pages

Cloudflare Pages hosts static sites (HTML/CSS/JS) for free.

### Step 1: Prepare the Frontend

Before deploying, update the API_URL in `app.js` to point to your Render backend:

```javascript
// Change this:
const API_URL = 'http://localhost:3000/api';

// To this:
const API_URL = 'https://your-render-service.onrender.com/api';
```

### Step 2: Deploy to Cloudflare Pages

1. Go to [cloudflare.com](https://cloudflare.com) → **Pages**
2. Click **Create a project**
3. Connect your GitHub repository
4. Configure:

```
Production branch: main
Build command: (leave empty)
Output directory: .
```

5. Click **Save and Deploy**

### Step 3: Custom Domain (Optional)

1. In Cloudflare Pages, go to **Custom domains**
2. Add your domain (e.g., `commutesync.yourdomain.com`)
3. Update DNS as instructed

---

## Part 3: Update App Configuration

After deployment, update the `API_URL` in `app.js`:

```javascript
// For production:
const API_URL = 'https://your-render-service.onrender.com/api';
```

---

## Architecture Overview

```
┌─────────────────────┐         ┌─────────────────────┐
│   Cloudflare Pages │────────▶│     Render         │
│   (HTML/CSS/JS)    │  API    │   (Node.js API)    │
└─────────────────────┘         └─────────┬───────────┘
                                          │
                                          ▼
                                 ┌─────────────────────┐
                                 │     Supabase       │
                                 │   (Database)       │
                                 └─────────────────────┘
```

---

## Supabase Setup

Make sure your Supabase tables have the `user_id` column:

```sql
-- Run these in Supabase SQL Editor

-- Add user_id column to existing tables
ALTER TABLE routes ADD COLUMN user_id TEXT;
ALTER TABLE trip_logs ADD COLUMN user_id TEXT;
ALTER TABLE route_schedules ADD COLUMN user_id TEXT;
ALTER TABLE presets ADD COLUMN user_id TEXT;

-- Optional: Enable Row Level Security (RLS)
-- This adds extra security but is not required for basic use
```

---

## Troubleshooting

### CORS Issues
If you get CORS errors, make sure the server allows requests from your Cloudflare domain:

```javascript
// In server.js, update CORS configuration:
app.use(cors({
  origin: ['https://your-domain.pages.dev', 'http://localhost:3000']
}));
```

### API Not Working
1. Check Render logs for errors
2. Verify environment variables are set correctly
3. Make sure SUPABASE_KEY is the **anon key** (not service role key)

### Data Not Loading
1. Ensure user_id column exists in Supabase
2. Check that user is logged in (localStorage has user_id)
3. Verify the API URL is correct in app.js

---

## Environment Variables Summary

### Render (Backend)
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
PORT=10000
```

### Cloudflare (Frontend)
No environment variables needed - API URL is hardcoded in app.js

---

## Quick Commands for Local Development

```bash
# Install dependencies
npm install

# Run locally
node server.js

# Access at http://localhost:3000
```

---

## Notes

- **Free Tier Limits:**
  - Render: 750 hours/month, sleeps after 15 min inactivity
  - Cloudflare Pages: Unlimited bandwidth, unlimited sites
  
- **Custom Domains:** Free on both platforms

- **SSL:** Automatic on both platforms
