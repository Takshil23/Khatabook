// MySQL (MariaDB) data layer for orders using XAMPP's MySQL
// Falls back handled by server.js if init fails

const mysql = require('mysql2/promise');

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || '';
const DB_NAME = process.env.DB_NAME || 'khata_book';

let pool = null;

function generateId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

function toMysqlDatetime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function ensureDatabase() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    multipleStatements: true,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  } finally {
    try { await connection.end(); } catch (e) {}
  }
}

async function ensureTables() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(36) PRIMARY KEY,
      customerName VARCHAR(128) NOT NULL,
      orderDetails TEXT,
      orderDate VARCHAR(32),
      orderAmount VARCHAR(32),
      paymentStatus VARCHAR(16),
      deliveryStatus VARCHAR(16),
      paymentMode VARCHAR(16),
      items LONGTEXT,
      createdAt DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  const conn = await pool.getConnection();
  try {
    await conn.query(ddl);
  } finally {
    conn.release();
  }
}

async function initDatabase() {
  await ensureDatabase();
  pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });
  await ensureTables();
  return pool;
}

async function getOrders() {
  if (!pool) throw new Error('DB not initialized');
  const [rows] = await pool.query('SELECT * FROM orders ORDER BY createdAt DESC');
  return rows.map((r) => ({
    id: r.id,
    customerName: r.customerName || '',
    orderDetails: r.orderDetails || '',
    orderDate: r.orderDate || '',
    orderAmount: r.orderAmount || '',
    paymentStatus: r.paymentStatus || 'Pending',
    deliveryStatus: r.deliveryStatus || 'Pending',
    paymentMode: r.paymentMode || 'Cash',
    items: (() => { try { return JSON.parse(r.items || '[]'); } catch { return []; } })(),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date(0).toISOString(),
  }));
}

async function insertOrder(order) {
  if (!pool) throw new Error('DB not initialized');
  const id = order.id || generateId();
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const payload = {
    id,
    customerName: String(order.customerName || ''),
    orderDetails: String(order.orderDetails || ''),
    orderDate: String(order.orderDate || ''),
    orderAmount: String(order.orderAmount || ''),
    paymentStatus: String(order.paymentStatus || 'Pending'),
    deliveryStatus: String(order.deliveryStatus || 'Pending'),
    paymentMode: String(order.paymentMode || 'Cash'),
    items: JSON.stringify(Array.isArray(order.items) ? order.items : []),
    createdAt: toMysqlDatetime(createdAt),
  };
  await pool.query(
    `INSERT INTO orders (id, customerName, orderDetails, orderDate, orderAmount, paymentStatus, deliveryStatus, paymentMode, items, createdAt)
     VALUES (:id, :customerName, :orderDetails, :orderDate, :orderAmount, :paymentStatus, :deliveryStatus, :paymentMode, :items, :createdAt)`,
    payload
  );
  return { id, ...order, createdAt: createdAt.toISOString() };
}

async function updateOrder(id, updates) {
  if (!pool) throw new Error('DB not initialized');
  const allowed = ['paymentStatus', 'deliveryStatus', 'paymentMode'];
  const keys = Object.keys(updates || {}).filter(k => allowed.includes(k));
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = :${k}`).join(', ');
  const payload = { id, ...Object.fromEntries(keys.map(k => [k, String(updates[k] ?? '')])) };
  await pool.query(`UPDATE orders SET ${sets} WHERE id = :id`, payload);
}

module.exports = {
  initDatabase,
  getOrders,
  insertOrder,
  updateOrder,
};


