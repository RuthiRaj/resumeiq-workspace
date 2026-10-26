# Deployment Guide

## Render (Backend API)

### Prerequisites
- GitHub repository connected to Render
- Supabase project (production)
- Groq API key (for AI features)
- NVIDIA API key (for AI features)

### Setup Steps

1. **Create Web Service**
   - Go to Render Dashboard → New → Web Service
   - Connect your GitHub repository
   - Render will auto-detect `render.yaml` (or configure manually):
     - **Runtime**: Docker
     - **Dockerfile Path**: `./backend/Dockerfile`
     - **Root Directory**: `./backend`
     - **Plan**: Free
     - **Health Check Path**: `/health`

2. **Environment Variables** (all required, no defaults)
   | Variable | Description |
   |----------|-------------|
   | `ENVIRONMENT` | Set to `production` |
   | `SUPABASE_URL` | Production Supabase project URL (e.g., `https://xxx.supabase.co`) |
   | `SUPABASE_PUBLISHABLE_KEY` | Production anon/publishable key |
   | `CORS_ORIGINS` | Comma-separated list of allowed origins (e.g., `https://your-app.vercel.app,https://your-custom-domain.com`) |
   | `GROQ_API_KEY` | Groq API key for LLM inference |
   | `NVIDIA_API_KEY` | NVIDIA API key for LLM inference |

3. **Deploy**
   - Click "Create Web Service"
   - Wait for build and health check to pass
   - Note the service URL (e.g., `https://resumeiq-api.onrender.com`)

### Free Tier Limits
- **Build minutes**: 500/month
- **Request timeout**: 30s (free), 120s (paid)
- **Spin-down**: Service spins down after 15 min inactivity; cold start ~30-60s
- **Concurrent connections**: Limited
- **Bandwidth**: 100 GB/month

---

## Vercel (Frontend)

### Prerequisites
- GitHub repository connected to Vercel
- Backend API deployed and accessible

### Setup Steps

1. **Import Project**
   - Go to Vercel Dashboard → Add New → Project
   - Import from GitHub
   - Framework preset: Next.js (auto-detected)
   - Root Directory: `frontend`

2. **Environment Variables**
   | Variable | Description |
   |----------|-------------|
   | `NEXT_PUBLIC_API_URL` | Backend API URL (e.g., `https://resumeiq-api.onrender.com`) |
   | `NEXT_PUBLIC_API_MODE` | Set to `live` for production |

3. **Deploy**
   - Click "Deploy"
   - Wait for build to complete
   - Note the deployment URL

### Free Tier Limits
- **Build minutes**: 6,000/month
- **Function execution**: 100 GB-hours/month (Hobby)
- **Bandwidth**: 1 TB/month
- **Serverless function timeout**: 10s (Hobby), 60s (Pro)

---

## Supabase Production Setup

1. **Create Production Project**
   - New organization/project in Supabase Dashboard
   - Choose region close to users
   - Save `Project URL` and `anon public` key

2. **Run Migrations**
   ```bash
   # From backend directory
   uv run alembic upgrade head
   # Or apply SQL files manually via Supabase SQL Editor
   ```

3. **Configure Auth**
   - Authentication → Providers → Enable Email
   - Set Site URL to your Vercel domain
   - Add Redirect URLs for auth callbacks

4. **Configure CORS/Storage** (if needed)
   - API Settings → CORS: Add Vercel domain
   - Storage buckets for file uploads (if implemented)

---

## Post-Deploy Verification

Run the post-deploy check script:
```powershell
./scripts/post-deploy-check.ps1 -ApiBaseUrl https://your-api.onrender.com
```

Expected results:
- `/health` returns 200 with `{"status": "ok"}`
- `/docs`, `/redoc`, `/openapi.json` return 404 in production
- CORS headers allow your Vercel domain
- Security headers present (CSP, HSTS, etc.)

---

## Known Issues & Workarounds

### Render Cold Starts
- Free tier spins down after 15 min inactivity
- First request after spin-down takes 30-60s
- Frontend handles this with "server waking up" retry logic (75s)

### CORS
- Must include both `https://*.vercel.app` and custom domains
- No trailing slashes in origins

### Environment Variables
- Never commit real values to git
- Use Render/Vercel dashboard to set secrets
- `sync: false` in render.yaml prevents accidental sync