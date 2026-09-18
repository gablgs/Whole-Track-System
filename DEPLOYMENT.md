# Firebase Hosting Deployment Guide

This project is configured to deploy directly to Firebase Hosting under project **`database-2943b`**, which connects directly to your existing Firebase Realtime Database (`database-2943b-default-rtdb.firebaseio.com`).

---

## 🚀 Quick Deploy (3 Steps)

### Step 1: Install Firebase CLI (if not already installed)
```bash
npm install -g firebase-tools
```

### Step 2: Log in to Firebase
```bash
firebase login
```
*(Make sure to log in with the Google account that has access to project `database-2943b`)*

### Step 3: Deploy to Hosting
Run the pre-configured npm script:
```bash
npm run deploy:hosting
```
Or run the CLI commands directly:
```bash
npm run build
firebase deploy --only hosting
```

---

## 🌐 Live URLs After Deployment
Once deployed, your app is immediately available globally over secure HTTPS at:
- `https://database-2943b.web.app`
- `https://database-2943b.firebaseapp.com`

---

## 🔒 Geolocation / Field Clock-In
Firebase Hosting automatically provisions **free SSL/HTTPS** certificates for both default domains and custom domains. The `firebase.json` file is configured with the `Permissions-Policy: geolocation=(self)` header, ensuring workers' mobile phones (iOS Safari & Android Chrome) have full access to GPS for geofenced clock-ins.

---

## 🛠️ Deploying Realtime Database Security Rules
To deploy or update the database security rules defined in `database.rules.json`:
```bash
firebase deploy --only database
```
Or deploy everything (both hosting and database rules):
```bash
npm run deploy:all
```

---

## 🏷️ Adding a Custom Domain (Optional)
1. Open the [Firebase Console](https://console.firebase.google.com/project/database-2943b/hosting/sites).
2. Click **Add custom domain** (e.g., `schedule.yourcompany.com` or `events.yourcompany.com`).
3. Follow the DNS instructions to add the `A` or `CNAME` records to your domain provider.
4. Firebase will automatically verify and issue a free SSL certificate within a few hours.
