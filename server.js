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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(__dirname));

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ======================
// Helpers
// ======================

const nowMs = () => Date.now();

const addDays = (ms, days) => {
  return ms + days * 24 * 60 * 60 * 1000;
};

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeAppId(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

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
  await fs.writeFile(
    DATA_PATH,
    JSON.stringify(db, null, 2),
    'utf8'
  );
}

function pickUserInfo(user) {
  const remainingMs =
    (user.expiredAt || 0) - nowMs();

  const remainingDays = Math.max(
    0,
    Math.ceil(
      remainingMs /
        (24 * 60 * 60 * 1000)
    )
  );

  const isForever = remainingDays > 5000;

  return {
    id: user.id,
    email: user.email,
    fullname: user.fullname,
    phone: user.phone,
    address: user.address,
    license: user.license,
    license_type:
      user.license_type || 'trial',
    plan_id: user.plan_id || 6,
    expiredDate: new Date(
      user.expiredAt || 0
    ).toISOString(),
    days_remaining: isForever
      ? 'Vĩnh viễn'
      : String(remainingDays),
    giamgia: user.discountLabel || ''
  };
}

// ======================
// AUTH
// ======================

// LOGIN
app.get('/api/auth_new', async (req, res) => {
  const email = normalizeEmail(
    req.query.email
  );

  const password = String(
    req.query.password || ''
  );

  const appId = normalizeAppId(
    req.query.app_id
  );

  if (!email || !password) {
    return res.status(400).json({
      status: false,
      message: 'Missing credentials'
    });
  }

  const db = await loadDb();

  const user = db.users.find(
    u =>
      u.app_id === appId &&
      normalizeEmail(u.email) ===
        email
  );

  if (!user || user.password !== password) {
    return res.json({
      status: false,
      message: 'Invalid credentials'
    });
  }

  if (
    user.expiredAt &&
    user.expiredAt < nowMs()
  ) {
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

// GET USER INFO
app.get(
  '/api/get_user_info_new',
  async (req, res) => {
    const email = normalizeEmail(
      req.query.email
    );

    const appId = normalizeAppId(
      req.query.app_id
    );

    if (!email) {
      return res.status(400).json({
        message: 'Missing email'
      });
    }

    const db = await loadDb();

    const user = db.users.find(
      u =>
        u.app_id === appId &&
        normalizeEmail(u.email) ===
          email
    );

    if (!user) {
      return res.status(404).json({
        message: 'Not found'
      });
    }

    res.json(pickUserInfo(user));
  }
);

// Alias
app.get(
  '/api/get_user_info',
  async (req, res) => {
    const email = normalizeEmail(
      req.query.email
    );

    const appId = normalizeAppId(
      req.query.app_id
    );

    if (!email) {
      return res.status(400).json({
        message: 'Missing email'
      });
    }

    const db = await loadDb();

    const user = db.users.find(
      u =>
        u.app_id === appId &&
        normalizeEmail(u.email) ===
          email
    );

    if (!user) {
      return res.status(404).json({
        message: 'Not found'
      });
    }

    res.json(pickUserInfo(user));
  }
);

// ======================
// REGISTER
// ======================

// POST REGISTER
app.post(
  '/api/register_new',
  async (req, res) => {
    await handleRegister(req, res, req.body);
  }
);

// GET REGISTER
app.get(
  '/api/register_new',
  async (req, res) => {
    await handleRegister(
      req,
      res,
      req.query
    );
  }
);

async function handleRegister(
  req,
  res,
  body
) {
  const email = normalizeEmail(
    body.email
  );

  const password = String(
    body.password || ''
  );

  const fullname = String(
    body.fullname ||
      body.name ||
      ''
  ).trim();

  const phone = String(
    body.phone || ''
  ).trim();

  const address = String(
    body.address || ''
  ).trim();

  const appId = normalizeAppId(
    body.app_id
  );

  if (!email || !password) {
    return res.status(400).json({
      status: false,
      message:
        'Missing required fields'
    });
  }

  const db = await loadDb();

  const exists = db.users.some(
    u =>
      u.app_id === appId &&
      normalizeEmail(u.email) ===
        email
  );

  if (exists) {
    return res.json({
      status: false,
      message: 'Email already exists'
    });
  }

  const id =
    db.users.reduce(
      (max, u) =>
        Math.max(max, u.id),
      0
    ) + 1;

  const user = {
    id,
    email,
    password,
    fullname:
      fullname || email,
    phone,
    address,
    app_id: appId,
    license: 'TRIAL',
    license_type: 'trial',
    plan_id: 6,
    expiredAt: addDays(
      nowMs(),
      1
    ),
    discountLabel: null
  };

  db.users.push(user);

  await saveDb(db);

  res.json({
    status: true,
    message: 'OK',
    ...pickUserInfo(user)
  });
}

// ======================
// DISCOUNT
// ======================

app.post('/api/zkem', async (req, res) => {
  const id = Number(req.body.id);

  const giamgia = String(
    req.body.giamgia || ''
  ).trim();

  if (!Number.isFinite(id)) {
    return res.status(400).json({
      status: false,
      message: 'Invalid id'
    });
  }

  const db = await loadDb();

  const user = db.users.find(
    u => u.id === id
  );

  if (!user) {
    return res.status(404).json({
      status: false,
      message: 'Not found'
    });
  }

  user.discountLabel = giamgia;

  await saveDb(db);

  res.json({
    status: true,
    message: 'OK'
  });
});

// ======================
// ADMIN
// ======================

const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN ||
  'Lohoainam2008';

function requireAdmin(
  req,
  res,
  next
) {
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

// GET USERS
app.get(
  '/admin/users',
  requireAdmin,
  async (req, res) => {
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
      daysRemaining:
        u.expiredAt
          ? Math.max(
              0,
              Math.ceil(
                (u.expiredAt -
                  nowMs()) /
                  (24 *
                    60 *
                    60 *
                    1000)
              )
            )
          : 0,
      discountLabel:
        u.discountLabel
    }));

    res.json({ users });
  }
);

// UPDATE LICENSE
app.post(
  '/admin/users/:id/license',
  requireAdmin,
  async (req, res) => {
    const userId = Number(
      req.params.id
    );

    const {
      days,
      licenseKey,
      plan
    } = req.body;

    if (
      !Number.isFinite(userId)
    ) {
      return res.status(400).json({
        error: 'Invalid user id'
      });
    }

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
    } else if (
      plan === 'forever'
    ) {
      addDaysCount = 9999;
      planId = 99;
    } else if (
      Number.isFinite(
        Number(days)
      )
    ) {
      addDaysCount =
        Number(days);
    }

    if (
      addDaysCount === 9999
    ) {
      user.expiredAt =
        nowMs() +
        9999 *
          24 *
          60 *
          60 *
          1000;

      user.license =
        licenseKey?.trim() ||
        'FOREVER';

      user.license_type =
        'forever';

      user.plan_id = 99;
    } else {
      const currentExpiry =
        user.expiredAt &&
        user.expiredAt >
          nowMs()
          ? user.expiredAt
          : nowMs();

      user.expiredAt =
        addDays(
          currentExpiry,
          addDaysCount
        );

      user.license =
        licenseKey?.trim() ||
        'PRO';

      user.license_type =
        'pro';

      user.plan_id = planId;
    }

    await saveDb(db);

    res.json({
      status: true,
      user: pickUserInfo(user)
    });
  }
);

// DELETE USER
app.delete(
  '/admin/users/:id',
  requireAdmin,
  async (req, res) => {
    const userId = Number(
      req.params.id
    );

    const db = await loadDb();

    db.users =
      db.users.filter(
        u => u.id !== userId
      );

    await saveDb(db);

    res.json({
      status: true
    });
  }
);

// ======================
// START SERVER
// ======================

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `license-server running on port ${PORT}`
    );
  }
);
