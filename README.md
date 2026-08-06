# Facebook Page & Bot API Service (TypeScript)

A production-ready, modular Node.js + Express + TypeScript service built according to Meta's official **Facebook Pages API** and **Messenger API** specifications.

---

## Features

- **Page Info & Settings**: Retrieve Page details, cover photos, follower counts, and settings.
- **Feed Posting**: Publish posts, link updates, media, and scheduled posts to Page feeds.
- **Comment Management**: Read, reply to, and delete comments on Page posts.
- **Analytics & Insights**: Fetch metrics like `page_impressions`, `page_fans`, and post engagements.
- **Mentions & Tagged Content**: Track posts tagging or mentioning your Page.
- **Meta Webhooks**: Handle GET challenge verification and HMAC SHA-256 (`x-hub-signature-256`) payload validation for real-time `feed` and `messages` updates.
- **Automated Bot Service**: Automatic replies to incoming Messenger messages and Page comments.

---

## 🛠️ Step-by-Step Meta Developer Registration & Token Setup

Follow these official steps to register as a developer, obtain tokens, and configure Webhooks:

### Step 1: Register as a Meta Developer
1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Log in with your Facebook account and click **Get Started** or **Register**.
3. Accept the Meta Platform Terms and complete developer verification.

### Step 2: Create a Meta App
1. Go to **[My Apps](https://developers.facebook.com/apps)** and click **Create App**.
2. Select **Other** > **Business** app type (or **Business / Page Management** use case).
3. Enter your App Name and contact email, then click **Create App**.

### Step 3: Add Facebook Pages API & Messenger Products
1. In your App Dashboard, navigate to **Add Products**.
2. Add **Facebook Pages API** and **Messenger**.

### Step 4: Generate a Page Access Token
1. Go to **[Graph API Explorer](https://developers.facebook.com/tools/explorer/)**.
2. In the top-right **Meta App** dropdown, select your newly created App.
3. In User/Page dropdown, select **Get Page Access Token**.
4. Grant the following required permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_manage_engagement`
   - `pages_messaging`
   - `pages_manage_metadata`
5. Click **Generate Access Token** and grant access to your Facebook Page.
6. Copy the generated **Page Access Token** and **Page ID**.

> **Note (Token Longevity):** Short-lived tokens generated in Explorer expire in 1-2 hours. To generate a long-lived Page token, exchange it via:
> ```bash
> GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={SHORT_LIVED_TOKEN}
> ```

### Step 5: Configure Webhooks
1. In your App Dashboard, select **Webhooks** > **Page**.
2. Set Callback URL to your public URL (e.g. via ngrok: `https://your-ngrok-domain.ngrok-free.app/webhook`).
3. Set Verify Token to match `FACEBOOK_VERIFY_TOKEN` in your `.env`.
4. Subscribe to `feed` and `messages` fields.

---

## 🚀 Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```env
PORT=3000
NODE_ENV=development

FACEBOOK_GRAPH_VERSION=v21.0
FACEBOOK_PAGE_ACCESS_TOKEN=your_page_access_token
FACEBOOK_APP_SECRET=your_facebook_app_secret
FACEBOOK_VERIFY_TOKEN=your_custom_webhook_verify_token
FACEBOOK_PAGE_ID=your_page_id
```

---

## 🏃 Running the Service

### Install Dependencies
```bash
npm install
```

### Type Checking
```bash
npm run typecheck
```

### Development Mode (with hot-reload)
```bash
npm run dev
```

### Production Build & Start
```bash
npm run build
npm start
```

---

## 📡 API Endpoints Reference

### 1. Webhooks
- `GET /webhook` - Verification challenge endpoint (used by Meta App Dashboard).
- `POST /webhook` - Receives real-time updates (Feed posts, comments, Messenger messages). Protected by HMAC `x-hub-signature-256`.

### 2. Page Operations (`/api/page`)
- `GET /api/page/info` - Get basic information about the Page.
- `POST /api/page/posts` - Create post on feed (`{ "message": "Hello World!" }`).
- `GET /api/page/posts/:objectId/comments` - Retrieve comments on a post.
- `POST /api/page/posts/:objectId/comments` - Add a comment to a post (`{ "message": "Nice post!" }`).
- `DELETE /api/page/comments/:commentId` - Delete/moderate a comment.
- `GET /api/page/insights` - Retrieve Page analytics (`page_impressions`, `page_fans`).
- `GET /api/page/tagged` - Retrieve posts mentioning/tagging the Page.

### 3. Bot Operations (`/api/bot`)
- `POST /api/bot/send-message` - Send direct Messenger message to PSID (`{ "recipientId": "PSID", "message": "Hello!" }`).
