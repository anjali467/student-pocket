# Student Pocket

Student Pocket is a React web application for students to manage monthly expenses, category budgets, parent alerts, and lending or borrowing records.

## Features

- Student login interface with parent email for alerts
- Username field so each dashboard shows the student's chosen profile name
- First-time budget setup for new users
- Dashboard with total spent, monthly budget, remaining balance, and lending balance
- Expense categories such as Food, Clothing, Cinema, Medical, Stationery, Travel, and Other
- Editable monthly threshold budgets for every category
- Monthly budget cycles reset automatically for a new month without deleting old expenses
- Previous month expenses are preserved under Previous records
- Warning notification when a category budget is crossed
- Real parent email alerts through SMTP when configured
- Recent transactions feed with search
- Lending and borrowing ledger with person, amount, date, and note
- Repayment tracking for borrowed money and received tracking for lent money
- Three expense input modes:
  - Manual typing
  - Speech input through the browser SpeechRecognition API
  - Bill upload for text-based receipts such as `.txt`, `.csv`, `.json`, or `.md`
- Image bill upload with OCR for `.jpg`, `.jpeg`, and `.png`
- Receipt parsing prefers final totals such as `Grand Total`, `Total`, `Sub Total`, or `Amount Due` instead of item numbers
- Bill dates are used when OCR can detect a valid receipt date
- Automatic category suggestion using keyword matching
- Local Express API with SQLite for local development
- MongoDB Atlas support for cloud deployment
- Separate database profile data by login email

## Run locally

```bash
npm.cmd install
npm.cmd run dev
```

Open the local frontend URL printed by Vite, usually:

```text
http://127.0.0.1:5173/
```

The backend API runs at:

```text
http://127.0.0.1:4174/
```

The sign-in form is pre-filled with generic example values:

- Username: `username`
- Email: `email@gmail.com`
- Password: `password`
- Parent email: `parent@gmail.com`

Passwords must be 6-16 characters.

New login emails start with empty transaction and lending records. The user must enter a username and set their monthly category budgets before entering the dashboard.

## Local SQLite database

The backend stores data locally in:

```text
data/student-pocket.sqlite
```

That SQLite file is created automatically when the first user logs in. It contains:

- users
- password hashes
- budgets
- expenses
- lending and borrowing records
- notifications

For hosted deployment on a free tier, use MongoDB Atlas by setting `MONGODB_URI`. If `MONGODB_URI` is not set, the backend falls back to local SQLite.

## Parent email alerts

The app can send a real email when a student crosses a budget, but SMTP must be configured first. SendGrid is recommended for Render deployment.

1. Create a `.env` file in the project root.
2. Copy the values from `.env.example`.
3. Replace `SMTP_PASS` and `MAIL_FROM` with your SendGrid settings.

For SendGrid, create an API key and verify your sender email:

```text
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
MAIL_FROM=Student Pocket <your-verified-sender-email>
```

`SMTP_USER` must be exactly `apikey`. `SMTP_PASS` is the SendGrid API key, not your email password.

Restart the app after changing `.env`:

```bash
npm.cmd run dev
```

If SMTP is not configured, the dashboard will show `Parent email not sent` with a setup message.

## Build for deployment

```bash
npm.cmd run build
npm.cmd start
```

In production, Express serves both:

- React frontend from `dist`
- Backend API from `/api`

So deploy this as a Node web service, not as a static-only site.

## Deploy on Render

This repo includes `render.yaml`.

1. Push the project to GitHub.
2. Create a new Render Blueprint from the repo.
3. Render will use:

```text
Build command: npm install && npm run build
Start command: npm start
```

4. Add these environment variables in Render:

```text
HOST=0.0.0.0
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/student-pocket
MONGODB_DB=student-pocket
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
MAIL_FROM=Student Pocket <your-verified-sender-email>
```

5. Use MongoDB Atlas free tier for permanent hosted data. Render free tier does not support persistent disks, so SQLite should be used locally only.

For a paid Render service, SQLite can also be used with a persistent disk.

If using a paid Render service, configure a persistent disk at:

```text
/var/data
```

SQLite will be stored at:

```text
/var/data/student-pocket.sqlite
```

## Future backend scope

For a larger public production version, use a hosted database such as PostgreSQL and a transactional email provider such as SendGrid, Mailgun, Amazon SES, or Resend.
