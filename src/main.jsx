import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { recognize } from 'tesseract.js';
import {
  AlertTriangle,
  BadgeIndianRupee,
  Bell,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  LogOut,
  Mic,
  Moon,
  Plus,
  ReceiptText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  Upload,
  UserRound,
  WalletCards,
} from 'lucide-react';
import './styles.css';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const demoUser = {
  username: 'Aarav Student',
  name: 'Aarav Student',
  email: 'student@studentpocket.app',
  password: 'student123',
  parentEmail: 'parent@example.com',
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const defaultCategories = [
  {
    name: 'Food',
    budget: 4500,
    color: '#0f766e',
    keywords: [
      'canteen',
      'pizza',
      'coffee',
      'lunch',
      'food',
      'snack',
      'restaurant',
      'dine',
      'cashier',
      'biryani',
      'chicken',
      'mutton',
      'pulao',
      'soft drinks',
      'water bottle',
    ],
  },
  { name: 'Clothing', budget: 2500, color: '#7c3aed', keywords: ['shirt', 'jeans', 'shoe', 'clothing', 'fashion'] },
  { name: 'Cinema', budget: 1200, color: '#db2777', keywords: ['movie', 'cinema', 'ticket', 'popcorn'] },
  { name: 'Medical', budget: 1800, color: '#dc2626', keywords: ['medicine', 'doctor', 'clinic', 'medical', 'pharmacy'] },
  { name: 'Stationery', budget: 1500, color: '#2563eb', keywords: ['notebook', 'pen', 'book', 'print', 'stationery'] },
  { name: 'Travel', budget: 2200, color: '#ca8a04', keywords: ['bus', 'metro', 'auto', 'fuel', 'travel'] },
  { name: 'Other', budget: 2000, color: '#475569', keywords: [] },
];

const blankCategories = defaultCategories.map((category) => ({ ...category, budget: 0 }));

function createBlankProfile() {
  return {
    user: null,
    transactions: [],
    ledger: [],
    categories: blankCategories,
    notifications: [],
    hasBudgetSetup: false,
    budgetMonth: null,
  };
}

function classifyExpense(text) {
  const lower = text.toLowerCase();
  return defaultCategories.find((category) => category.keywords.some((keyword) => lower.includes(keyword)))?.name || 'Other';
}

function parseAmount(text) {
  const match = text.replace(/,/g, '').match(/(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1]) : 0;
}

function normalizeMoneyValue(rawValue, context = '') {
  const cleaned = String(rawValue).replace(/[,\s]/g, '').replace(/[oO]/g, '0');
  if (!cleaned) return 0;

  if (cleaned.includes('.')) {
    return Number(cleaned);
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return 0;

  const looksLikeMissingDecimal = value >= 1000 && value <= 99999 && cleaned.endsWith('00');
  if (looksLikeMissingDecimal) {
    return value / 100;
  }

  return value;
}

function extractMoneyValues(segment) {
  const context = segment.toLowerCase();
  return [...segment.matchAll(/(?:rs\.?|inr|₹)?\s*(\d+(?:[.,]\d{1,2})?)/gi)]
    .map((match) => normalizeMoneyValue(match[1], context))
    .filter((value) => value > 0 && value < 100000);
}

function parseLineItemTotal(lines) {
  const ignoredLine = /\b(date|time|bill no|invoice|contact|phone|email|name|cashier|dine in|persons|table|total|subtotal|sub total|qty)\b/i;
  const itemAmounts = lines
    .filter((line) => !ignoredLine.test(line))
    .map((line) => {
      const values = extractMoneyValues(`${line} price amount`);
      if (values.length < 2) return 0;
      const lastValue = values[values.length - 1];
      const firstValue = values[0];
      if (firstValue > 50) return 0;
      return lastValue;
    })
    .filter((value) => value > 0);

  if (itemAmounts.length < 2) return 0;
  const total = itemAmounts.reduce((sum, value) => sum + value, 0);
  return total > 0 && total < 100000 ? Math.round(total) : 0;
}

function parseReceiptAmount(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const labelledTotals = [];
  lines.forEach((line, index) => {
    const lowerLine = line.toLowerCase();
    const previousLine = lines[index - 1]?.toLowerCase() || '';
    const nextLine = lines[index + 1] || '';
    const hasTotalLabel =
      /\b(grand total|net amount|amount due|balance due|total amount|bill total|sub total|subtotal)\b/.test(lowerLine) ||
      (/\bsub\b/.test(previousLine) && /\btotal\b/.test(lowerLine)) ||
      (/\bsub\b/.test(lowerLine) && /\btotal\b/.test(nextLine.toLowerCase())) ||
      (/\btotal\b/.test(lowerLine) && !/\b(total qty|qty|quantity|items?)\b/.test(lowerLine));

    if (!hasTotalLabel) return;

    const values = extractMoneyValues(`${line} ${nextLine}`);
    labelledTotals.push(...values);
  });

  if (labelledTotals.length > 0) {
    return Math.round(Math.max(...labelledTotals));
  }

  const lineItemTotal = parseLineItemTotal(lines);
  if (lineItemTotal > 0) {
    return lineItemTotal;
  }

  const normalizedText = text
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  const candidates = [...normalizedText.matchAll(/\d+(?:\.\d{1,2})?/g)]
    .map((match) => {
      const contextStart = Math.max(0, match.index - 55);
      const contextEnd = Math.min(normalizedText.length, match.index + match[0].length + 18);
      const context = normalizedText.slice(contextStart, contextEnd);
      const value = normalizeMoneyValue(match[0], context);
      let score = value;

      if (/\b(grand total|net amount|amount due|balance due|total amount|bill total)\b/.test(context)) score += 10000;
      if (/\b(sub total|subtotal|total)\b/.test(context)) score += 8000;
      if (/\b(amount)\b/.test(context)) score += 1500;
      if (/\b(bill no|invoice|contact|phone|date|time|qty|quantity|no\.item|item|table|persons|cashier)\b/.test(context)) {
        score -= 5000;
      }
      if (value > 100000 || value <= 0) score -= 10000;
      if (value > 5000 && !/\b(total|amount due|balance due)\b/.test(context)) score -= 7000;
      if (!match[0].includes('.') && value < 10) score -= 2000;

      return { value, score };
    })
    .filter((candidate) => candidate.value > 0 && candidate.value < 100000);

  if (candidates.length === 0) return 0;
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  return Math.round(candidates[0].value);
}

function receiptTitleFor(category, fileName, text) {
  const lowerText = `${fileName} ${text}`.toLowerCase();
  if (category !== 'Other') return `${category} bill`;
  if (/\b(receipt|invoice|bill)\b/.test(lowerText)) return 'Uploaded bill';
  return fileName.replace(/\.[^.]+$/, '') || 'Uploaded bill';
}

function receiptPreviewFor(title, amount, category, date) {
  const amountText = amount ? currency.format(amount) : 'Amount not found';
  return `Parsed bill: ${title} | ${category} | ${amountText} | ${date}`;
}

function parseReceiptDate(text) {
  const match = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!match) return today();

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return today();
  }

  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthKey() {
  return today().slice(0, 7);
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

function isTransactionInMonth(transaction, monthKey) {
  return String(transaction.date || '').startsWith(monthKey);
}

function nameFromEmail(email) {
  const localPart = email.split('@')[0] || 'student';
  return localPart
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'New Student';
}

function normalizeUser(user) {
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  const isDemoEmail = email === demoUser.email;
  const incomingUsername = user.username || user.name;
  const hasDemoNameOnOtherEmail = incomingUsername === demoUser.username && !isDemoEmail;
  const username = hasDemoNameOnOtherEmail ? nameFromEmail(email) : incomingUsername || nameFromEmail(email);
  return {
    ...user,
    email,
    username,
    name: username,
    parentEmail: user.parentEmail || demoUser.parentEmail,
  };
}

async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  } catch {
    throw new Error('Cannot reach the backend API. In VS Code terminal, run: npm.cmd run dev');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }
  return data;
}

function LoginScreen({ onLogin }) {
  const [form, setForm] = useState({
    username: demoUser.username,
    email: demoUser.email,
    password: demoUser.password,
    parentEmail: demoUser.parentEmail,
    remember: true,
  });
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!form.username.trim() || !form.email.trim() || !form.password.trim()) {
      setError('Enter username, email, and password to continue.');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    const normalizedEmail = form.email.trim().toLowerCase();
    setError('');
    try {
      await onLogin({
        username: form.username.trim(),
        email: normalizedEmail,
        password: form.password,
        parentEmail: form.parentEmail.trim() || 'parent@example.com',
        role: 'student',
      });
    } catch (error) {
      setError(error.message);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-visual">
        <div className="brand-mark">
          <WalletCards size={30} />
          <span>Student Pocket</span>
        </div>
        <div className="login-copy">
          <p className="eyebrow">Budget discipline for campus life</p>
          <h1>Track spending before the month starts fighting back.</h1>
          <p>
            Manage category budgets, auto-sort expenses, record borrowing and lending, and notify parents when a monthly
            limit is crossed.
          </p>
        </div>
        <div className="security-strip">
          <ShieldCheck size={20} />
          <span>Your profile and records are stored in the local Student Pocket database.</span>
        </div>
      </section>

      <section className="login-panel" aria-label="Login form">
        <div>
          <p className="eyebrow">Welcome</p>
          <h2>Sign in</h2>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            Username
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="Student name"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="student@email.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="Minimum 6 characters"
            />
          </label>
          <label>
            Parent email
            <input
              type="email"
              value={form.parentEmail}
              onChange={(event) => setForm({ ...form, parentEmail: event.target.value })}
              placeholder="parent@email.com"
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.remember}
              onChange={(event) => setForm({ ...form, remember: event.target.checked })}
            />
            Keep me signed in
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" type="submit">
            <UserRound size={18} />
            Enter dashboard
          </button>
        </form>
      </section>
    </main>
  );
}

function BudgetSetup({ categories, onBudgetChange, onComplete, onLogout }) {
  const total = categories.reduce((sum, category) => sum + Number(category.budget), 0);
  const canContinue = total > 0 && categories.every((category) => Number(category.budget) >= 0);

  return (
    <main className="setup-shell">
      <section className="setup-panel">
        <div className="brand-mark compact">
          <WalletCards size={28} />
          <span>Student Pocket</span>
        </div>
        <div>
          <p className="eyebrow">First-time setup</p>
          <h1>Set your monthly pocket budget</h1>
          <p className="setup-copy">
            Choose how much you are allowed to spend in each category this month. Your records will start empty, and
            warnings will trigger only after you add real expenses.
          </p>
        </div>

        <div className="setup-budget-list">
          {categories.map((category) => (
            <label className="budget-input-row" key={category.name}>
              <span>{category.name}</span>
              <input
                type="text"
                inputMode="numeric"
                value={category.budget}
                onFocus={(event) => event.target.select()}
                onChange={(event) => onBudgetChange(category.name, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="setup-footer">
          <strong>Total monthly budget: {currency.format(total)}</strong>
          <div className="setup-actions">
            <button className="ghost-button" type="button" onClick={onLogout}>
              <LogOut size={17} />
              Logout
            </button>
            <button className="primary-action" type="button" disabled={!canContinue} onClick={onComplete}>
              <CheckCircle2 size={18} />
              Start tracking
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [categories, setCategories] = useState(blankCategories);
  const [notifications, setNotifications] = useState([]);
  const [hasBudgetSetup, setHasBudgetSetup] = useState(false);
  const [budgetMonth, setBudgetMonth] = useState(currentMonthKey());
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    amount: '',
    category: 'Food',
    date: today(),
    method: 'Manual',
  });
  const [ledgerForm, setLedgerForm] = useState({
    type: 'Borrowed',
    person: '',
    amount: '',
    date: today(),
    note: '',
  });
  const [billText, setBillText] = useState('');
  const [speechStatus, setSpeechStatus] = useState('Idle');
  const [speechFallbackVisible, setSpeechFallbackVisible] = useState(false);
  const [speechDraft, setSpeechDraft] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const recognitionRef = useRef(null);

  const activeMonth = budgetMonth || currentMonthKey();
  const currentMonthTransactions = useMemo(
    () => transactions.filter((transaction) => isTransactionInMonth(transaction, activeMonth)),
    [transactions, activeMonth],
  );
  const previousTransactions = useMemo(
    () =>
      transactions
        .filter((transaction) => !isTransactionInMonth(transaction, activeMonth))
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date)),
    [transactions, activeMonth],
  );

  const spentByCategory = useMemo(() => {
    return categories.map((category) => {
      const spent = currentMonthTransactions
        .filter((transaction) => transaction.category === category.name)
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
      const percent = category.budget > 0 ? Math.min(100, Math.round((spent / category.budget) * 100)) : 0;
      return { ...category, spent, percent };
    });
  }, [categories, currentMonthTransactions]);

  const totalBudget = categories.reduce((sum, category) => sum + Number(category.budget), 0);
  const totalSpent = currentMonthTransactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const netLedger = ledger.reduce(
    (sum, item) => item.status === 'Settled' ? sum : sum + (item.type === 'Lent' ? Number(item.amount) : -Number(item.amount)),
    0,
  );

  const filteredTransactions = currentMonthTransactions
    .filter((transaction) => `${transaction.title} ${transaction.category}`.toLowerCase().includes(query.toLowerCase()))
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  useEffect(() => {
    if (!user || !profileLoaded) return;

    requestJson(`/profile/${encodeURIComponent(user.email)}`, {
      method: 'PUT',
      body: JSON.stringify({ user, transactions, ledger, categories, notifications, hasBudgetSetup, budgetMonth }),
    }).catch((error) => {
      console.error('Could not save profile', error);
    });
  }, [user, transactions, ledger, categories, notifications, hasBudgetSetup, budgetMonth, profileLoaded]);

  async function handleLogin(loginDetails) {
    const data = await requestJson('/login', {
      method: 'POST',
      body: JSON.stringify(loginDetails),
    });
    const profile = data.profile || createBlankProfile();
    setUser(normalizeUser(data.user || profile.user || loginDetails));
    setTransactions(profile.transactions || []);
    setLedger(profile.ledger || []);
    setNotifications(profile.notifications || []);
    const savedBudgetMonth = profile.budgetMonth || currentMonthKey();
    const shouldResetForNewMonth = Boolean(profile.hasBudgetSetup && profile.budgetMonth && profile.budgetMonth !== currentMonthKey());
    setBudgetMonth(currentMonthKey());
    setCategories(shouldResetForNewMonth ? blankCategories : profile.categories || blankCategories);
    setHasBudgetSetup(shouldResetForNewMonth ? false : Boolean(profile.hasBudgetSetup));
    if (shouldResetForNewMonth) {
      setNotifications((current) => [
        {
          id: Date.now(),
          title: 'New monthly budget cycle',
          message: `${monthLabel(savedBudgetMonth)} records were kept under Previous records. Set fresh limits for ${monthLabel(currentMonthKey())}.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        ...current,
      ]);
    }
    setProfileLoaded(true);
  }

  function logout() {
    setUser(null);
    setTransactions([]);
    setLedger([]);
    setCategories(blankCategories);
    setNotifications([]);
    setHasBudgetSetup(false);
    setBudgetMonth(currentMonthKey());
    setProfileLoaded(false);
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (!hasBudgetSetup) {
    return (
      <BudgetSetup
        categories={categories}
        onBudgetChange={updateBudget}
        onComplete={() => {
          setBudgetMonth(currentMonthKey());
          setHasBudgetSetup(true);
        }}
        onLogout={logout}
      />
    );
  }

  function addNotification(category, spent, budget, expenseTitle) {
    const message = `${category} budget crossed: ${currency.format(spent)} spent from ${currency.format(budget)}. Sending parent email to ${user.parentEmail}.`;
    setNotifications((current) => [
      { id: Date.now(), title: 'Budget warning sent', message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ...current,
    ]);

    requestJson('/notify-parent', {
      method: 'POST',
      body: JSON.stringify({
        parentEmail: user.parentEmail,
        studentName: user.username,
        category,
        spent,
        budget,
        expenseTitle,
      }),
    })
      .then((result) => {
        setNotifications((current) => [
          {
            id: Date.now() + 1,
            title: result.sent ? 'Parent email sent' : 'Parent email not sent',
            message: result.message,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
          ...current,
        ]);
      })
      .catch((error) => {
        setNotifications((current) => [
          {
            id: Date.now() + 1,
            title: 'Parent email not sent',
            message: error.message,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
          ...current,
        ]);
      });

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Student Pocket budget alert', { body: message });
    }
  }

  function addExpense(event) {
    event.preventDefault();
    const title = expenseForm.title.trim();
    const amount = Number(expenseForm.amount) || parseAmount(title);

    if (!title) {
      setExpenseError('Enter an expense detail first, for example “canteen lunch 120”.');
      return;
    }

    if (amount <= 0) {
      setExpenseError('Enter a valid amount or include it in the detail, for example “food bill 840”.');
      return;
    }

    const category = expenseForm.category || classifyExpense(expenseForm.title);
    const transaction = { ...expenseForm, id: Date.now(), title, amount, category };
    const categoryBudget = categories.find((item) => item.name === category);
    const currentSpent = currentMonthTransactions
      .filter((item) => item.category === category)
      .reduce((sum, item) => sum + Number(item.amount), 0);

    setTransactions((current) => [transaction, ...current]);
    setExpenseError('');
    setExpenseForm({ title: '', amount: '', category: 'Food', date: today(), method: 'Manual' });

    if (categoryBudget && currentSpent + amount > categoryBudget.budget) {
      addNotification(category, currentSpent + amount, categoryBudget.budget, title);
    }
  }

  function deleteTransaction(id) {
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
  }

  function addLedger(event) {
    event.preventDefault();
    if (!ledgerForm.person.trim() || Number(ledgerForm.amount) <= 0) return;
    setLedger((current) => [
      {
        ...ledgerForm,
        id: Date.now(),
        amount: Number(ledgerForm.amount),
        status: 'Open',
        settledDate: '',
        settledNote: '',
      },
      ...current,
    ]);
    setLedgerForm({ type: 'Borrowed', person: '', amount: '', date: today(), note: '' });
  }

  function settleLedgerItem(id) {
    setLedger((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'Settled',
              settledDate: today(),
              settledNote: item.type === 'Borrowed' ? 'Money repaid' : 'Money received',
            }
          : item,
      ),
    );
  }

  function updateBudget(name, value) {
    const cleanValue = String(value).replace(/[^\d]/g, '');
    const nextBudget = cleanValue === '' ? 0 : Number(cleanValue);
    setCategories((current) =>
      current.map((category) => (category.name === name ? { ...category, budget: nextBudget } : category)),
    );
  }

  async function requestNotifications() {
    if (!('Notification' in window)) return;
    await Notification.requestPermission();
  }

  function applySpeechTranscript(transcript) {
    const amount = parseAmount(transcript);
    setExpenseForm({
      title: transcript,
      amount: amount || '',
      category: classifyExpense(transcript),
      date: today(),
      method: 'Speech',
    });
    setSpeechDraft(transcript);
    setSpeechStatus(`Captured: ${transcript}`);
  }

  async function startSpeechInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechFallbackVisible(true);
      setSpeechStatus('This browser does not support speech recognition. Use the speech text fallback below.');
      return;
    }

    if (!window.isSecureContext) {
      setSpeechFallbackVisible(true);
      setSpeechStatus('Voice input needs localhost or HTTPS. Use http://127.0.0.1:5173/ or the fallback below.');
      return;
    }

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        setSpeechFallbackVisible(true);
        setSpeechStatus('Microphone permission was blocked. Allow microphone access or use the fallback below.');
        return;
      }
    }

    const recognition = new SpeechRecognition();
    let captured = false;
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setSpeechFallbackVisible(false);
      setSpeechStatus('Listening... speak now');
    };
    recognition.onerror = (event) => {
      setSpeechFallbackVisible(true);
      const messages = {
        'not-allowed': 'Microphone permission was blocked. Allow microphone access or use the fallback below.',
        'no-speech': 'No speech was detected. Try again or use the fallback below.',
        network: 'Speech service is unavailable. Use the fallback below.',
        'audio-capture': 'No microphone was found. Use the fallback below.',
      };
      setSpeechStatus(messages[event.error] || 'Could not capture speech. Try again or use the fallback below.');
    };
    recognition.onnomatch = () => {
      setSpeechFallbackVisible(true);
      setSpeechStatus('Speech was unclear. Try saying “canteen lunch 120” or use the fallback below.');
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      captured = true;
      applySpeechTranscript(transcript);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!captured) {
        setSpeechFallbackVisible(true);
        setSpeechStatus((current) => current === 'Listening... speak now' ? 'No speech was captured. Use the fallback below.' : current);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setSpeechFallbackVisible(true);
      setSpeechStatus('Voice input could not start. Use the fallback below.');
    }
  }

  function applyBillText(fileName, text, method = 'Bill upload') {
    const amount = parseReceiptAmount(text);
    const category = classifyExpense(`${fileName} ${text}`);
    const billDate = parseReceiptDate(text);
    const title = receiptTitleFor(category, fileName, text);

    setBillText(text ? receiptPreviewFor(title, amount, category, billDate) : 'No readable text was found. You can type the amount manually.');
    setExpenseForm({
      title,
      amount: amount || '',
      category,
      date: billDate,
      method,
    });
  }

  async function handleBillUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      setBillText('Reading image bill...');
      try {
        const result = await recognize(file, 'eng');
        applyBillText(file.name, result.data.text, 'Image OCR');
      } catch {
        setBillText('Could not read this image. Try a clearer JPG/JPEG bill or enter the amount manually.');
      }
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      applyBillText(file.name, text);
      event.target.value = '';
    };
    reader.readAsText(file);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark compact">
          <WalletCards size={26} />
          <span>Student Pocket</span>
        </div>
        <nav>
          <a href="#dashboard">Dashboard</a>
          <a href="#expense">Add expense</a>
          <a href="#budgets">Budgets</a>
          <a href="#previous">Previous records</a>
          <a href="#ledger">Lending</a>
        </nav>
        <button className="ghost-button" onClick={logout}>
          <LogOut size={17} />
          Logout
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Hello, {user.username}</p>
            <h1>{monthLabel(activeMonth)} money control</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" title="Enable browser notifications" onClick={requestNotifications}>
              <Bell size={18} />
            </button>
            <button className="icon-button" title="Focus mode">
              <Moon size={18} />
            </button>
          </div>
        </header>

        <section id="dashboard" className="metric-grid">
          <article className="metric-card">
            <BadgeIndianRupee size={22} />
            <span>Total spent</span>
            <strong>{currency.format(totalSpent)}</strong>
          </article>
          <article className="metric-card">
            <CircleDollarSign size={22} />
            <span>Monthly budget</span>
            <strong>{currency.format(totalBudget)}</strong>
          </article>
          <article className="metric-card">
            <TrendingDown size={22} />
            <span>Remaining</span>
            <strong>{currency.format(Math.max(0, totalBudget - totalSpent))}</strong>
          </article>
          <article className="metric-card">
            <Send size={22} />
            <span>Lending balance</span>
            <strong>{currency.format(netLedger)}</strong>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel" id="expense">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Three input modes</p>
                <h2>Add expense</h2>
              </div>
              <button className="tool-button" type="button" onClick={startSpeechInput}>
                <Mic size={17} />
                Speak
              </button>
            </div>
            <form className="stack-form" onSubmit={addExpense}>
              <label>
                Expense detail
                <input
                  value={expenseForm.title}
                  onChange={(event) => setExpenseForm({ ...expenseForm, title: event.target.value, category: classifyExpense(event.target.value) })}
                  placeholder="Example: canteen coffee 80"
                />
              </label>
              <div className="form-row">
                <label>
                  Amount
                  <input
                    type="number"
                    min="1"
                    value={expenseForm.amount}
                    onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })}
                    placeholder="₹"
                  />
                </label>
                <label>
                  Category
                  <select
                    value={expenseForm.category}
                    onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}
                  >
                    {categories.map((category) => <option key={category.name}>{category.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label>
                  Date
                  <input
                    type="date"
                    value={expenseForm.date}
                    onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })}
                  />
                </label>
                <label>
                  Bill upload
                  <span className="file-input">
                    <Upload size={17} />
                    <input type="file" accept=".jpg,.jpeg,.png,.txt,.csv,.json,.md" onChange={handleBillUpload} />
                  </span>
                </label>
              </div>
              <p className="helper-line">{speechStatus}</p>
              {speechFallbackVisible && (
                <div className="speech-fallback">
                  <label>
                    Speech text fallback
                    <input
                      value={speechDraft}
                      onChange={(event) => setSpeechDraft(event.target.value)}
                      placeholder="Example: canteen lunch 120"
                    />
                  </label>
                  <button
                    className="tool-button"
                    type="button"
      onClick={() => applySpeechTranscript(speechDraft)}
                    disabled={!speechDraft.trim()}
                  >
                    <Mic size={17} />
                    Use text
                  </button>
                </div>
              )}
              {expenseError && <p className="form-error">{expenseError}</p>}
              {billText && <p className="bill-preview"><FileText size={16} /> {billText}</p>}
              <button className="primary-action" type="submit">
                <Plus size={18} />
                Save expense
              </button>
            </form>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Live feed</p>
                <h2>This month transactions</h2>
              </div>
              <div className="search-box">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
              </div>
            </div>
            <div className="transaction-list">
              {filteredTransactions.slice(0, 7).map((transaction) => (
                <div className="transaction-item" key={transaction.id}>
                  <div className="transaction-icon"><ReceiptText size={18} /></div>
                  <div>
                    <strong>{transaction.title}</strong>
                    <span>{transaction.category} · {transaction.method} · {transaction.date}</span>
                  </div>
                  <b>{currency.format(transaction.amount)}</b>
                  <button
                    className="row-icon-button"
                    type="button"
                    title="Delete transaction"
                    onClick={() => deleteTransaction(transaction.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="panel" id="previous">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">History</p>
              <h2>Previous records</h2>
            </div>
            <ReceiptText size={20} />
          </div>
          <div className="transaction-list">
            {previousTransactions.length === 0 ? (
              <p className="empty-state"><CheckCircle2 size={18} /> No previous month records yet.</p>
            ) : (
              previousTransactions.map((transaction) => (
                <div className="transaction-item" key={transaction.id}>
                  <div className="transaction-icon"><ReceiptText size={18} /></div>
                  <div>
                    <strong>{transaction.title}</strong>
                    <span>{transaction.category} · {transaction.method} · {transaction.date}</span>
                  </div>
                  <b>{currency.format(transaction.amount)}</b>
                  <button
                    className="row-icon-button"
                    type="button"
                    title="Delete transaction"
                    onClick={() => deleteTransaction(transaction.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="content-grid" id="budgets">
          <article className="panel wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Category thresholds</p>
                <h2>Monthly budget limits</h2>
              </div>
              <Sparkles size={20} />
            </div>
            <div className="budget-list">
              {spentByCategory.map((category) => (
                <div className="budget-row" key={category.name}>
                  <div className="budget-top">
                    <strong>{category.name}</strong>
                    <span>{currency.format(category.spent)} / {currency.format(category.budget)}</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${category.percent}%`, background: category.spent > category.budget ? '#dc2626' : category.color }} />
                  </div>
                  <label className="budget-limit-input">
                    Limit
                    <input
                      type="text"
                      inputMode="numeric"
                      value={category.budget}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => updateBudget(category.name, event.target.value)}
                      aria-label={`${category.name} budget`}
                    />
                  </label>
                  {category.spent > category.budget && (
                    <p className="warning-line"><AlertTriangle size={16} /> Limit crossed. Parent alert is queued.</p>
                  )}
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Alerts</p>
                <h2>Notifications</h2>
              </div>
              <Bell size={19} />
            </div>
            <div className="notice-list">
              {notifications.length === 0 ? (
                <p className="empty-state"><CheckCircle2 size={18} /> No budget warnings yet.</p>
              ) : (
                notifications.map((notice) => (
                  <div className="notice" key={notice.id}>
                    <strong>{notice.title}</strong>
                    <span>{notice.message}</span>
                    <small>{notice.time}</small>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        <section className="content-grid" id="ledger">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">People and dates</p>
                <h2>Lending & borrowing</h2>
              </div>
              <Camera size={19} />
            </div>
            <form className="stack-form" onSubmit={addLedger}>
              <div className="form-row">
                <label>
                  Type
                  <select value={ledgerForm.type} onChange={(event) => setLedgerForm({ ...ledgerForm, type: event.target.value })}>
                    <option>Lent</option>
                    <option>Borrowed</option>
                  </select>
                </label>
                <label>
                  Amount
                  <input type="number" min="1" value={ledgerForm.amount} onChange={(event) => setLedgerForm({ ...ledgerForm, amount: event.target.value })} />
                </label>
              </div>
              <label>
                Person
                <input value={ledgerForm.person} onChange={(event) => setLedgerForm({ ...ledgerForm, person: event.target.value })} placeholder="Friend name" />
              </label>
              <div className="form-row">
                <label>
                  Date
                  <input type="date" value={ledgerForm.date} onChange={(event) => setLedgerForm({ ...ledgerForm, date: event.target.value })} />
                </label>
                <label>
                  Note
                  <input value={ledgerForm.note} onChange={(event) => setLedgerForm({ ...ledgerForm, note: event.target.value })} placeholder="Reason" />
                </label>
              </div>
              <button className="primary-action" type="submit">
                <Plus size={18} />
                Add record
              </button>
            </form>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Ledger</p>
                <h2>Money records</h2>
              </div>
            </div>
            <div className="transaction-list">
              {ledger.map((item) => (
                <div className={`transaction-item ledger-item ${item.status === 'Settled' ? 'settled' : ''}`} key={item.id}>
                  <div className={`pill ${item.status === 'Settled' ? 'settled' : item.type.toLowerCase()}`}>
                    {item.status === 'Settled' ? 'Settled' : item.type}
                  </div>
                  <div>
                    <strong>{item.person}</strong>
                    <span>{item.note || 'No note'} · {item.date}</span>
                    {item.status === 'Settled' && (
                      <span>
                        {item.settledNote || (item.type === 'Borrowed' ? 'Money repaid' : 'Money received')} · {item.settledDate}
                      </span>
                    )}
                  </div>
                  <b>{currency.format(item.amount)}</b>
                  {item.status !== 'Settled' && (
                    <button className="tool-button compact" type="button" onClick={() => settleLedgerItem(item.id)}>
                      {item.type === 'Borrowed' ? 'Mark repaid' : 'Mark received'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
