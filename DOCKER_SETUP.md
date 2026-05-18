# EduAccess — Docker Setup Guide

Step-by-step instructions to run the full stack (database, backend, frontend, AI microservice) starting from a fresh Docker install.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the repo](#2-clone-the-repo)
3. [Start PostgreSQL](#3-start-postgresql)
4. [Set up the backend](#4-set-up-the-backend)
5. [Set up the frontend](#5-set-up-the-frontend)
6. [Set up the accessibility microservice](#6-set-up-the-accessibility-microservice)
7. [Verify everything is running](#7-verify-everything-is-running)
8. [Default accounts](#8-default-accounts)
9. [How AI accessibility works](#9-how-ai-accessibility-works)
10. [Stopping everything](#10-stopping-everything)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

| Tool | Minimum version | Check |
|------|----------------|-------|
| **Docker** | 20+ | `docker --version` |
| **Docker Compose** | v2 (bundled with Docker Desktop) | `docker compose version` |
| **Node.js** | 18+ | `node --version` |
| **npm** | 9+ | `npm --version` |
| **Git** | any | `git --version` |

> **Linux only — add your user to the docker group** (so you don't need `sudo` every time):
> ```bash
> sudo usermod -aG docker $USER
> # log out and back in for the change to take effect
> ```

> **If you use nvm for Node.js**, run this in every new terminal before using `node` or `npm`:
> ```bash
> source ~/.nvm/nvm.sh
> ```

---

## 2. Clone the repo

```bash
git clone <your-repo-url>
cd e-learning
```

---

## 3. Start PostgreSQL

The database runs in Docker — no local PostgreSQL installation needed.

```bash
# From the project root (where docker-compose.yml is)
docker compose up -d
```

Wait about 10 seconds, then confirm it is healthy:

```bash
docker ps
# Expected: e_learning_db   Up (healthy)
```

> PostgreSQL 16 runs on **port 5432**.
> All data is stored in a Docker volume (`postgres_data`) and survives container restarts.

---

## 4. Set up the backend

Open a terminal inside the `backend/` folder.

### 4a. Create `.env`

Create `backend/.env` with the following content (copy-paste as-is — the defaults work locally):

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=e_learning_db
DB_USER=eduaccess_user
DB_PASSWORD=postgresql
PORT=5000
FRONTEND_URL=http://localhost:3000
JWT_SECRET=change_this_to_a_long_random_secret_in_production
JWT_EXPIRES_IN=7d
ACCESSIBILITY_SERVICE_URL=http://localhost:8000
BACKEND_URL=http://host.docker.internal:5000
```

> **Important:** `BACKEND_URL` must be `http://host.docker.internal:5000` (not `localhost`). The AI worker runs inside Docker and uses this URL to download lesson files from your machine.

### 4b. Install dependencies

```bash
cd backend
npm install
```

### 4c. Initialize the database

This creates all tables and inserts the default admin account:

```bash
npm run setup-db
```

### 4d. Run the audio migration

This adds the `audio_url` column and creates the `accessibility_jobs` table:

```bash
node -e "
const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
pool.query(fs.readFileSync('migrate-add-audio-url.sql', 'utf8'))
  .then(() => { console.log('Migration done'); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
"
```

### 4e. Start the backend

```bash
npm run dev
```

The backend runs on **http://localhost:5000**. Keep this terminal open.

---

## 5. Set up the frontend

Open a **new terminal**.

### 5a. Create `.env.local`

```bash
cd frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:5000" > .env.local
```

### 5b. Install dependencies

```bash
npm install
```

### 5c. Start the frontend

```bash
npm run dev
```

The frontend runs on **http://localhost:3000**. Keep this terminal open.

---

## 6. Set up the accessibility microservice

This service runs Whisper (speech-to-text) and Piper TTS (text-to-speech) inside Docker. Open a **new terminal**.

### 6a. Create `.env`

```bash
cd accessibility-service
cp .env.example .env
```

The defaults work on any CPU machine. Edit `accessibility-service/.env` only if you want to change the voice or model size:

```env
USE_GPU=false                    # true only with an NVIDIA GPU + nvidia-docker
WHISPER_MODEL_SIZE=base          # tiny/base/small = CPU-safe; medium/large = GPU
PIPER_VOICE_NAME=en_US-amy-medium
REDIS_URL=redis://redis:6379
JOB_TTL_SECONDS=604800
```

### 6b. Download AI models (first time only)

The model files are not in the repo (they are large binaries). Download them once:

```bash
# Inside accessibility-service/
pip3 install huggingface_hub requests
python3 scripts/download_models.py
```

This saves ~215 MB to `accessibility-service/models/` and is reused on every subsequent start.

### 6c. Build and start

```bash
docker compose up --build -d
```

The first build takes 5–10 minutes (downloads Python packages). After that, subsequent starts take a few seconds.

Confirm all three containers are up:

```bash
docker compose ps
```

Expected output:
```
NAME                              STATUS
accessibility-service-api-1       Up
accessibility-service-worker-1    Up
accessibility-service-redis-1     Up
```

---

## 7. Verify everything is running

Run all three checks — each should return `"status":"healthy"`:

```bash
# Backend
curl http://localhost:5000/health

# Accessibility microservice
curl http://localhost:8000/health

# Worker → backend network (critical check)
docker exec accessibility-service-worker-1 python3 -c \
  "import urllib.request; print(urllib.request.urlopen('http://host.docker.internal:5000/health').read().decode())"
```

Then open **http://localhost:3000** — you should see the EduAccess login page.

---

## 8. Default accounts

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Admin | `admin@eduaccess.com` | `admin123` | Created by `setup-db` |
| Teacher | any email starting with `edu` | your choice | e.g. `edu.john@school.com` |
| Student | any valid email | your choice | School ID must start with `BDU`; needs admin approval |

> Students cannot log in until an admin approves them. Log in as admin → Users → Pending Approvals.

---

## 9. How AI accessibility works

Once all services are running:

1. A teacher uploads a lesson (video and/or document) on the **Upload** page
2. AI jobs are submitted **automatically** — no extra click needed
3. The backend receives a **real-time WebSocket notification** when the job finishes
4. The lesson is updated with:
   - `.vtt` subtitle file — generated from the video using Whisper (STT)
   - `.mp3` audio narration — generated from the document using Piper (TTS)
5. Students watching the lesson see the subtitle track and audio player automatically

To view job status or re-run jobs for existing lessons: **Teacher → Courses → [Course name]** → click any lesson row to expand it.

---

## 10. Stopping everything

```bash
# Stop the accessibility microservice (from accessibility-service/)
cd accessibility-service && docker compose down

# Stop PostgreSQL (from project root)
cd .. && docker compose down

# Stop backend and frontend: press Ctrl+C in their terminals
```

To delete the database and start completely fresh:

```bash
docker compose down -v   # -v removes the postgres_data volume
```

---

## 11. Troubleshooting

### Cannot connect to database (`ECONNREFUSED 127.0.0.1:5432`)
The PostgreSQL container may still be starting. Wait 10 seconds and try again.
```bash
docker ps   # check that e_learning_db shows (healthy)
```

### Port 5432 already in use
A local PostgreSQL is already running on that port. Either stop it:
```bash
sudo systemctl stop postgresql
```
Or change the host port in `docker-compose.yml` from `"5432:5432"` to `"5433:5432"` and set `DB_PORT=5433` in `backend/.env`.

### Worker can't download video files (`httpx.ConnectError`)
`BACKEND_URL` in `backend/.env` must be `http://host.docker.internal:5000`, not `http://localhost:5000`. Verify:
```bash
grep BACKEND_URL backend/.env
```
Also confirm the docker-compose has `extra_hosts`:
```bash
grep -A2 extra_hosts accessibility-service/docker-compose.yml
```

### Models not found / STT or TTS fails on first job
The model files were not downloaded. Run:
```bash
cd accessibility-service
python3 scripts/download_models.py
docker compose up --build -d
```

### `node: command not found` after opening a new terminal
Node.js is managed by nvm. Activate it:
```bash
source ~/.nvm/nvm.sh
```

### Frontend shows a blank page or hydration warning
Clear your browser cache or open an incognito window. Some browser extensions (VPN, ad-blockers) inject attributes that cause React hydration warnings — these are harmless and do not affect functionality.
