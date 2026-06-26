import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const defaultCategories = [
  { name: 'Food', budget: 0, color: '#0f766e', keywords: ['canteen', 'pizza', 'coffee', 'lunch', 'food', 'snack'] },
  { name: 'Clothing', budget: 0, color: '#7c3aed', keywords: ['shirt', 'jeans', 'shoe', 'clothing', 'fashion'] },
  { name: 'Cinema', budget: 0, color: '#db2777', keywords: ['movie', 'cinema', 'ticket', 'popcorn'] },
  { name: 'Medical', budget: 0, color: '#dc2626', keywords: ['medicine', 'doctor', 'clinic', 'medical', 'pharmacy'] },
  { name: 'Stationery', budget: 0, color: '#2563eb', keywords: ['notebook', 'pen', 'book', 'print', 'stationery'] },
  { name: 'Travel', budget: 0, color: '#ca8a04', keywords: ['bus', 'metro', 'auto', 'fuel', 'travel'] },
  { name: 'Other', budget: 0, color: '#475569', keywords: [] },
];

let provider = 'sqlite';
let sqliteDatabase = null;
let mongoDatabase = null;

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sqlitePublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    parentEmail: row.parent_email,
    role: row.role,
  };
}

function mongoPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    parentEmail: row.parentEmail,
    role: row.role,
  };
}

function emptyProfile(user) {
  return {
    user,
    transactions: [],
    ledger: [],
    categories: defaultCategories,
    notifications: [],
    hasBudgetSetup: false,
    budgetMonth: null,
  };
}

function setupSqlite() {
  const dataDirectory = process.env.DATA_DIR || join(__dirname, '..', 'data');
  const databasePath = join(dataDirectory, 'student-pocket.sqlite');
  mkdirSync(dirname(databasePath), { recursive: true });

  sqliteDatabase = new DatabaseSync(databasePath);
  sqliteDatabase.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      username TEXT NOT NULL,
      parent_email TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      email TEXT PRIMARY KEY,
      transactions TEXT NOT NULL,
      ledger TEXT NOT NULL,
      categories TEXT NOT NULL,
      notifications TEXT NOT NULL,
      has_budget_setup INTEGER NOT NULL DEFAULT 0,
      budget_month TEXT,
      FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
    );
  `);

  try {
    sqliteDatabase.exec('ALTER TABLE profiles ADD COLUMN budget_month TEXT');
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) {
      throw error;
    }
  }
}

async function setupMongo() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  mongoDatabase = client.db(process.env.MONGODB_DB || 'student-pocket');
  await mongoDatabase.collection('users').createIndex({ email: 1 }, { unique: true });
  await mongoDatabase.collection('profiles').createIndex({ email: 1 }, { unique: true });
}

export async function initDatabase() {
  if (process.env.MONGODB_URI) {
    provider = 'mongodb';
    await setupMongo();
    return;
  }

  provider = 'sqlite';
  setupSqlite();
}

export function databaseProvider() {
  return provider;
}

export async function findUser(email) {
  if (provider === 'mongodb') {
    return mongoDatabase.collection('users').findOne({ email });
  }

  return sqliteDatabase.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export async function createUser(user) {
  if (provider === 'mongodb') {
    const mongoUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      parentEmail: user.parentEmail,
      role: user.role,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
    };
    await mongoDatabase.collection('users').insertOne(mongoUser);
    await mongoDatabase.collection('profiles').insertOne(emptyProfile(mongoPublicUser(mongoUser)));
    return;
  }

  sqliteDatabase
    .prepare(
      `INSERT INTO users (email, id, username, parent_email, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(user.email, user.id, user.username, user.parentEmail, user.role, user.passwordHash, user.createdAt);

  sqliteDatabase
    .prepare(
      `INSERT INTO profiles (email, transactions, ledger, categories, notifications, has_budget_setup, budget_month)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(user.email, '[]', '[]', JSON.stringify(defaultCategories), '[]', 0, null);
}

export async function getProfile(email) {
  if (provider === 'mongodb') {
    const user = mongoPublicUser(await findUser(email));
    if (!user) return null;
    const profile = await mongoDatabase.collection('profiles').findOne({ email });
    return profile || emptyProfile(user);
  }

  const user = sqlitePublicUser(await findUser(email));
  if (!user) return null;

  const profile = sqliteDatabase.prepare('SELECT * FROM profiles WHERE email = ?').get(email);
  if (!profile) return emptyProfile(user);

  return {
    user,
    transactions: parseJson(profile.transactions, []),
    ledger: parseJson(profile.ledger, []),
    categories: parseJson(profile.categories, defaultCategories),
    notifications: parseJson(profile.notifications, []),
    hasBudgetSetup: Boolean(profile.has_budget_setup),
    budgetMonth: profile.budget_month,
  };
}

export async function saveProfile(email, profile) {
  if (provider === 'mongodb') {
    await mongoDatabase.collection('profiles').updateOne(
      { email },
      {
        $set: {
          user: profile.user,
          transactions: profile.transactions || [],
          ledger: profile.ledger || [],
          categories: profile.categories || defaultCategories,
          notifications: profile.notifications || [],
          hasBudgetSetup: Boolean(profile.hasBudgetSetup),
          budgetMonth: profile.budgetMonth || null,
        },
      },
      { upsert: true },
    );
    return getProfile(email);
  }

  sqliteDatabase
    .prepare(
      `UPDATE profiles
       SET transactions = ?,
           ledger = ?,
           categories = ?,
           notifications = ?,
           has_budget_setup = ?,
           budget_month = ?
       WHERE email = ?`,
    )
    .run(
      JSON.stringify(profile.transactions || []),
      JSON.stringify(profile.ledger || []),
      JSON.stringify(profile.categories || defaultCategories),
      JSON.stringify(profile.notifications || []),
      profile.hasBudgetSetup ? 1 : 0,
      profile.budgetMonth || null,
      email,
    );

  return getProfile(email);
}

export function toPublicUser(row) {
  return provider === 'mongodb' ? mongoPublicUser(row) : sqlitePublicUser(row);
}
