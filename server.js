// Simple Express backend for shared orders
// Endpoints:
//   GET  /orders  → return all orders
//   POST /orders  → add a new order

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const db = require('./server-db');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'orders.json');
const USE_MYSQL_ENV = String(process.env.USE_MYSQL || '').trim().toLowerCase();
const shouldAttemptMySql = USE_MYSQL_ENV === ''
  ? true
  : ['1','true','yes','on'].includes(USE_MYSQL_ENV);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static files so you can open http://localhost:3000/index.html
app.use(express.static(__dirname));

let useMySql = false;

async function readOrdersFromFile() {
  try {
    const txt = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(txt || '[]');
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(DATA_FILE, '[]', 'utf8');
      return [];
    }
    throw err;
  }
}

async function writeOrdersToFile(orders) {
  const pretty = JSON.stringify(orders, null, 2);
  await fs.writeFile(DATA_FILE, pretty, 'utf8');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

app.get('/orders', async (req, res) => {
  try {
    if (useMySql) {
      const orders = await db.getOrders();
      return res.json(orders);
    }
    const orders = await readOrdersFromFile();
    // Newest first
    orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read orders' });
  }
});

app.post('/orders', async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.customerName) {
      return res.status(400).json({ error: 'customerName is required' });
   }
    const nowIso = new Date().toISOString();
    const order = {
      id: generateId(),
      customerName: String(payload.customerName),
      orderDetails: String(payload.orderDetails || ''),
      orderDate: String(payload.orderDate || nowIso.split('T')[0]),
      orderAmount: String(payload.orderAmount || ''),
      paymentStatus: String(payload.paymentStatus || 'Pending'),
      deliveryStatus: String(payload.deliveryStatus || 'Pending'),
      paymentMode: String(payload.paymentMode || 'Cash'),
      items: Array.isArray(payload.items) ? payload.items : [],
      createdAt: payload.createdAt || nowIso,
    };

    if (useMySql) {
      const saved = await db.insertOrder(order);
      return res.status(201).json(saved);
    }

    const orders = await readOrdersFromFile();
    orders.unshift(order);
    await writeOrdersToFile(orders);

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// Update order fields (paymentStatus, deliveryStatus, paymentMode)
app.patch('/orders/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    const allowed = new Set(['paymentStatus', 'deliveryStatus', 'paymentMode']);
    const body = req.body || {};
    const updates = {};
    Object.keys(body).forEach((k) => { if (allowed.has(k)) updates[k] = String(body[k] ?? ''); });
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no updates' });

    if (useMySql && typeof db.updateOrder === 'function') {
      await db.updateOrder(id, updates);
      return res.json({ id, ...updates });
    }

    const orders = await readOrdersFromFile();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    orders[idx] = { ...orders[idx], ...updates };
    await writeOrdersToFile(orders);
    return res.json(orders[idx]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

async function start() {
  if (shouldAttemptMySql) {
    try {
      await db.initDatabase();
      useMySql = true;
      console.log('MySQL storage enabled (XAMPP).');
    } catch (e) {
      useMySql = false;
      console.warn('MySQL init failed; falling back to orders.json. Reason:', e && e.message ? e.message : e);
    }
  } else {
    useMySql = false;
    console.log('MySQL disabled via USE_MYSQL; using orders.json for storage.');
  }
  app.listen(PORT, () => {
    console.log(`Orders API listening on port ${PORT}`);
  });
}

start();



