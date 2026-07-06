# Web Dashboard & Backend API for Licensing & Key Management

A complete, production-ready full-stack application built to manage user licenses (keys/tokens) and authenticate hardware IDs (HWID) directly from a client application (e.g., C++ ImGui).

## 🚀 Features

- **Admin Dashboard**: Single-page web panel with premium glassmorphic styling, responsive layouts, search query filters, and a custom confirmation alert modal.
- **Key Generator**: Quick duration presets (1 day, 3 days, 7 days, 30 days, 90 days, Lifetime) and custom duration settings with automatic copy-to-clipboard functionality.
- **Key Management**: Dynamic list tracking Key string, Duration, Expiration date, Connected HWID device, Status, and Ghi chú (Note). Functions include resetting HWID and deleting keys.
- **Fraud Detection Alarm**: Real-time monitoring of invalid attempts. When active fraud logs are detected, the dashboard card glows and pulses in warning red to alert the administrator.
- **Client Auth API**: Custom endpoint with robust checks for key availability, banned status, binding HWID, counting expiration, and automatically registering fraud events.

---

## 🛠️ Installation & Setup

### Step 1: Database Setup (Supabase)
1. Go to your [Supabase Dashboard](https://supabase.com/) and create a new project.
2. Open the **SQL Editor** from the left-hand menu.
3. Click **New Query** and copy-paste the contents of [supabase.sql](file:///storage/emulated/0/ServerKey/supabase.sql).
4. Click **Run** to create the tables (`keys_management`, `fraud_logs`) and search indexes.

### Step 2: Deployment to Vercel
You can deploy this project to Vercel with a single click by importing it from GitHub:
1. Initialize a Git repository in the project folder and push the code to a new GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```
2. Log in to [Vercel](https://vercel.com/) and click **Add New** -> **Project**.
3. Import your GitHub repository.
4. Expand **Environment Variables** and enter the following settings from your `.env` configuration:
   - `SUPABASE_URL` : (Your Supabase Project URL)
   - `SUPABASE_SERVICE_ROLE_KEY` : (Your Supabase Service Role Key)
   - `ADMIN_PASSWORD` : (A strong password to protect the dashboard and APIs)
5. Click **Deploy**. Vercel will automatically set up the static files and API routing.

---

## 💻 Client Integration (cURL / ImGui C++)

To authenticate client devices running ImGui, make a `POST` request to the client login endpoint.

### Endpoint
`POST /api/client/login`

### Request Body
```json
{
  "key_string": "KEY_A1B2C3D4",
  "hwid": "DESKTOP-9FJ84H2-HWID-UUID-8888"
}
```

### JSON Responses

#### 1. First Activation (Successful)
Key is valid and has status `unactivated`. It maps the HWID to the key and starts the countdown timer.
```json
{
  "success": true,
  "message": "Activation successful",
  "token": "SESSION_J8X9H2K1L3M",
  "expires_at": "2026-07-13T14:25:00.000Z"
}
```

#### 2. Re-login Verification (Successful)
Key is activated, the HWID matches the database record, and the key has not expired.
```json
{
  "success": true,
  "message": "Login successful",
  "expires_at": "2026-07-13T14:25:00.000Z"
}
```

#### 3. HWID Mismatch (Fraud Log Created)
Key is valid, but the user is trying to log in from a different machine. This attempts to bypass the device lock and automatically registers an entry in `fraud_logs`.
```json
{
  "success": false,
  "message": "Key đã dùng cho máy khác"
}
```

#### 4. Invalid Key (Fraud Log Created)
Key string does not exist in the database. Registers a fraud alert log.
```json
{
  "success": false,
  "message": "Invalid Key"
}
```

#### 5. Expired / Banned
The license has either passed the expiration deadline or has been blacklisted by the owner.
```json
{
  "success": false,
  "message": "Key has expired" // Or "Key has been banned"
}
```

---

## ⚙️ Local Development (Optional)

To run the application locally on your machine:
1. Install Node.js on your computer.
2. In the root directory, create a `.env` file from the `.env.example` template:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and fill in your Supabase connection parameters and Admin password.
4. Install dependencies and start the local Node.js server:
   ```bash
   npm install
   npm run dev
   ```
5. Open your web browser and navigate to `http://localhost:3000` to access the Dashboard, or use `curl` to test `/api/client/login`.
