import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8787;
const DATA_PATH = path.join(__dirname, 'data.json');

const app = express();

app.disable('x-powered-by');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Helpers
const nowMs = () => Date.now();

const addDays = (ms, days) => {
  return ms + days * 24 * 60 * 60 * 1000;
};

async function loadDb() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    const db = {
      users: []
    };

    await saveDb(db);

    return db;
  }
}

async function saveDb(db) {
  await fs.writeFile(DATA_PATH, JSON.stringify(db, null, 2));
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeAppId(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

function pickUserInfo(user) {
  const remainingMs = (user.expiredAt || 0) - nowMs();

  const remainingDays = Math.max(
    0,
    Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
  );

  return {
    id: user.id,
    email: user.email,
    fullname: user.fullname,
    phone: user.phone,
    address: user.address,
    license: user.license,
    license_type: user.license_type || 'trial',
    plan_id: user.plan_id || 6,
    expiredDate: new Date(user.expiredAt || 0).toISOString(),
    days_remaining:
      remainingDays > 5000 ? 'Vĩnh viễn' : String(remainingDays),
    giamgia: user.discountLabel || ''
  };
}

// Register
app.post('/api/register_new', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const fullname = String(req.body.fullname || '').trim();
  const phone = String(req.body.phone || '').trim();
  const address = String(req.body.address || '').trim();
  const appId = normalizeAppId(req.body.app_id);

  if (!email || !password) {
    return res.json({
      status: false,
      message: 'Missing required fields'
    });
  }

  const db = await loadDb();

  const exists = db.users.find(
    u =>
      normalizeEmail(u.email) === email &&
      u.app_id === appId
  );

  if (exists) {
    return res.json({
      status: false,
      message: 'Email already exists'
    });
  }

  const id =
    db.users.reduce((m, u) => Math.max(m, u.id), 0) + 1;

  const user = {
    id,
    email,
    password,
    fullname,
    phone,
    address,
    app_id: appId,
    license: 'TRIAL',
    license_type: 'trial',
    plan_id: 6,
    expiredAt: addDays(nowMs(), 1),
    discountLabel: null
  };

  db.users.push(user);

  await saveDb(db);

  res.json({
    status: true,
    message: 'OK',
    ...pickUserInfo(user)
  });
});

// Login
app.get('/api/auth_new', async (req, res) => {
  const email = normalizeEmail(req.query.email);
  const password = String(req.query.password || '');
  const appId = normalizeAppId(req.query.app_id);

  const db = await loadDb();

  const user = db.users.find(
    u =>
      normalizeEmail(u.email) === email &&
      u.password === password &&
      u.app_id === appId
  );

  if (!user) {
    return res.json({
      status: false,
      message: 'Invalid credentials'
    });
  }

  if (user.expiredAt < nowMs()) {
    return res.json({
      status: false,
      message: 'License expired'
    });
  }

  res.json({
    status: true,
    message: 'OK',
    ...pickUserInfo(user)
  });
});

// Get user info
app.get('/api/get_user_info_new', async (req, res) => {
  const email = normalizeEmail(req.query.email);
  const appId = normalizeAppId(req.query.app_id);

  const db = await loadDb();

  const user = db.users.find(
    u =>
      normalizeEmail(u.email) === email &&
      u.app_id === appId
  );

  if (!user) {
    return res.status(404).json({
      message: 'User not found'
    });
  }

  res.json(pickUserInfo(user));
});

// Admin
const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN || 'admin123';

function requireAdmin(req, res, next) {
  const token =
    req.headers['x-admin-token'] ||
    req.query.token;

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  next();
}

// Get users
app.get('/admin/users', requireAdmin, async (req, res) => {
  const db = await loadDb();

  const users = db.users.map(u => ({
    id: u.id,
    email: u.email,
    fullname: u.fullname,
    phone: u.phone,
    license: u.license,
    expiredAt: u.expiredAt,
    expiredDate: new Date(
      u.expiredAt || 0
    ).toISOString(),
    daysRemaining: Math.max(
      0,
      Math.ceil(
        ((u.expiredAt || 0) - nowMs()) /
          (24 * 60 * 60 * 1000)
      )
    )
  }));

  res.json({ users });
});

// Update license
app.post(
  '/admin/users/:id/license',
  requireAdmin,
  async (req, res) => {
    const userId = Number(req.params.id);

    const { plan, licenseKey, days } = req.body;

    const db = await loadDb();

    const user = db.users.find(
      u => u.id === userId
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    let addDaysCount = 30;
    let planId = 12;

    if (plan === '3') {
      addDaysCount = 90;
      planId = 3;
    } else if (plan === '6') {
      addDaysCount = 180;
      planId = 6;
    } else if (plan === '12') {
      addDaysCount = 365;
      planId = 12;
    } else if (plan === 'forever') {
      addDaysCount = 9999;
      planId = 99;
    } else if (days) {
      addDaysCount = Number(days);
    }

    user.expiredAt = addDays(
      Math.max(user.expiredAt || 0, nowMs()),
      addDaysCount
    );

    user.license =
      licenseKey || 'PRO';

    user.license_type =
      plan === 'forever'
        ? 'forever'
        : 'pro';

    user.plan_id = planId;

    await saveDb(db);

    res.json({
      status: true,
      user: pickUserInfo(user)
    });
  }
);

// Delete user
app.delete(
  '/admin/users/:id',
  requireAdmin,
  async (req, res) => {
    const userId = Number(req.params.id);

    const db = await loadDb();

    db.users = db.users.filter(
      u => u.id !== userId
    );

    await saveDb(db);

    res.json({
      status: true
    });
  }
);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `license-server running on port ${PORT}`
  );
});
