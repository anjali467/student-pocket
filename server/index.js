import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import { createUser, databaseProvider, findUser, getProfile, initDatabase, saveProfile, toPublicUser } from './database.js';

await initDatabase();

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';
const distPath = join(__dirname, '..', 'dist');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function emailTransportConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function brevoApiConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

function emailConfigured() {
  return brevoApiConfigured() || emailTransportConfigured();
}

function smtpPort() {
  return Number(process.env.SMTP_PORT || 587);
}

function smtpSecure() {
  if (process.env.SMTP_SECURE) {
    return process.env.SMTP_SECURE === 'true';
  }

  return smtpPort() === 465;
}

function createMailTransport() {
  if (!emailTransportConfigured()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort(),
    secure: smtpSecure(),
    family: 4,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

function parseSender(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);

  if (!match) {
    return { email: raw, name: 'Student Pocket' };
  }

  return {
    name: match[1].trim() || 'Student Pocket',
    email: match[2].trim(),
  };
}

function budgetAlertMessage({ studentName, category, spent, budget, expenseTitle }) {
  return [
    `Hello,`,
    ``,
    `${studentName} crossed the ${category} monthly budget.`,
    `Expense: ${expenseTitle}`,
    `Spent: Rs ${spent}`,
    `Budget: Rs ${budget}`,
    ``,
    `This alert was sent by Student Pocket.`,
  ].join('\n');
}

async function sendBrevoEmail({ to, subject, text }) {
  const sender = parseSender(process.env.MAIL_FROM);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API failed with status ${response.status}: ${body.slice(0, 200)}`);
  }
}

async function sendSmtpEmail({ to, subject, text }) {
  const transport = createMailTransport();
  if (!transport) return false;

  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });

  return true;
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'student-pocket-api',
    database: databaseProvider(),
    emailConfigured: emailConfigured(),
    emailProvider: brevoApiConfigured() ? 'brevo-api' : emailTransportConfigured() ? 'smtp' : null,
    brevoApiConfigured: brevoApiConfigured(),
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: emailTransportConfigured() ? smtpPort() : null,
    smtpSecure: emailTransportConfigured() ? smtpSecure() : null,
  });
});

app.post('/api/login', async (request, response) => {
  const email = normalizeEmail(request.body.email);
  const username = String(request.body.username || '').trim();
  const password = String(request.body.password || '');
  const parentEmail = normalizeEmail(request.body.parentEmail);
  const role = request.body.role === 'parent' ? 'parent' : 'student';

  if (!email || !username || password.length < 6) {
    response.status(400).json({ message: 'Username, email, and a 6 character password are required.' });
    return;
  }

  const existingUser = await findUser(email);
  const passwordHash = hashPassword(password);

  const existingPasswordHash = existingUser?.password_hash || existingUser?.passwordHash;
  if (existingUser && existingPasswordHash !== passwordHash) {
    response.status(401).json({ message: 'Incorrect password for this email.' });
    return;
  }

  if (!existingUser) {
    await createUser({
      id: crypto.randomUUID(),
      username,
      email,
      parentEmail: parentEmail || 'parent@example.com',
      role,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
  }

  const user = toPublicUser(await findUser(email));
  response.json({
    user,
    profile: await getProfile(email),
  });
});

app.put('/api/profile/:email', async (request, response) => {
  const email = normalizeEmail(request.params.email);

  if (!(await findUser(email))) {
    response.status(404).json({ message: 'User profile was not found.' });
    return;
  }

  response.json({
    profile: await saveProfile(email, request.body),
  });
});

app.post('/api/notify-parent', async (request, response) => {
  const parentEmail = normalizeEmail(request.body.parentEmail);
  const studentName = String(request.body.studentName || 'Student').trim();
  const category = String(request.body.category || 'Budget').trim();
  const spent = Number(request.body.spent || 0);
  const budget = Number(request.body.budget || 0);
  const expenseTitle = String(request.body.expenseTitle || 'Expense').trim();

  if (!parentEmail) {
    response.status(400).json({ sent: false, message: 'Parent email is required.' });
    return;
  }

  if (!emailConfigured()) {
    response.status(503).json({
      sent: false,
      message: 'Email is not configured. Add BREVO_API_KEY and MAIL_FROM in Render, then redeploy.',
    });
    return;
  }

  try {
    const message = {
      to: parentEmail,
      subject: `Student Pocket alert: ${category} budget crossed`,
      text: budgetAlertMessage({ studentName, category, spent, budget, expenseTitle }),
    };

    if (brevoApiConfigured()) {
      await sendBrevoEmail(message);
    } else {
      await sendSmtpEmail(message);
    }

    response.json({ sent: true, message: `Email sent to ${parentEmail}.` });
  } catch (error) {
    const message = error.code === 'ETIMEDOUT' || error.code === 'ENETUNREACH'
      ? 'SMTP network connection failed. Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, and redeploy the latest settings.'
      : error.message;
    response.status(500).json({ sent: false, message });
  }
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(join(distPath, 'index.html'));
  });
}

app.listen(port, host, () => {
  console.log(`Student Pocket running at http://${host}:${port}`);
});
