/**
 * Product CRUD routes with image upload, size management, stock toggling,
 * and quantity management.
 * Public routes: GET (list, single)
 * Protected routes: POST, PUT, PATCH, DELETE (require JWT)
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  toggleStock,
  updateQuantity,
  setQuantity,
  setStockStatus,
  deleteProductById,
  getCategories,
  addCategory,
  deleteCategory
} from '../db.js';
import { authenticateToken } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Multer Configuration ───────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) cb(null, true);
    else cb(new Error('Only image files (jpg, png, gif, webp) are allowed.'));
  }
});

// ── GET /api/categories — list all categories ──────────────────
router.get('/categories', (req, res) => {
  try {
    res.json(getCategories());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
});

// ── POST /api/categories — create category (admin only) ────────
router.post('/categories', authenticateToken, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name is required.' });
    res.status(201).json(addCategory(name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to add category.' });
  }
});

// ── DELETE /api/categories/:name — delete category (admin only) ──
router.delete('/categories/:name', authenticateToken, (req, res) => {
  try {
    res.json(deleteCategory(req.params.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete category.' });
  }
});

// ── GET /api/products — list all (public, filterable by category) ──
router.get('/', (req, res) => {
  try {
    const products = getAllProducts(req.query.category);
    res.json(products);
  } catch (err) {
    console.error('Fetch products error:', err);
    res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

// ── GET /api/products/:id — single product (public) ────────────
router.get('/:id', (req, res) => {
  try {
    const product = getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json(product);
  } catch (err) {
    console.error('Fetch product error:', err);
    res.status(500).json({ error: 'Failed to fetch product.' });
  }
});

// ── POST /api/products — create (admin only) ───────────────────
router.post('/', authenticateToken, upload.single('image'), (req, res) => {
  try {
    const { name, price, category, description, sizes, in_stock, quantity, discount_type, discount_percent } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ error: 'Name, price, and category are required.' });
    }

    const parsedSizes = sizes ? (typeof sizes === 'string' ? JSON.parse(sizes) : sizes) : [];
    const image = req.file ? req.file.filename : null;
    const parsedQuantity = quantity !== undefined ? parseInt(quantity, 10) : 10;
    const stock = in_stock === 'false' || in_stock === '0' ? false : (parsedQuantity > 0);

    const product = createProduct({
      name, price, description, category,
      sizes: parsedSizes, image, in_stock: stock, quantity: parsedQuantity,
      discount_type: discount_type === 'null' || !discount_type ? null : discount_type,
      discount_percent: discount_percent
    });

    res.status(201).json(product);
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

// ── PUT /api/products/:id — update (admin only) ────────────────
router.put('/:id', authenticateToken, upload.single('image'), (req, res) => {
  try {
    const existing = getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    const { name, price, description, category, sizes, in_stock, quantity, discount_type, discount_percent } = req.body;
    const parsedSizes = sizes ? (typeof sizes === 'string' ? JSON.parse(sizes) : sizes) : undefined;
    const image = req.file ? req.file.filename : undefined;
    const stock = in_stock !== undefined
      ? (in_stock === 'true' || in_stock === '1' ? true : false)
      : undefined;
    const parsedQuantity = quantity !== undefined ? parseInt(quantity, 10) : undefined;

    // Remove old image file if a new one is uploaded
    if (req.file && existing.image) {
      const oldPath = path.join(uploadsDir, existing.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const updated = updateProduct(req.params.id, {
      name, price, description, category,
      sizes: parsedSizes, image, in_stock: stock, quantity: parsedQuantity,
      discount_type: discount_type === 'null' || !discount_type ? null : discount_type,
      discount_percent: discount_percent
    });

    res.json(updated);
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

// ── PATCH /api/products/:id/stock — toggle stock status (admin only) ──
router.patch('/:id/stock', authenticateToken, (req, res) => {
  try {
    // If body has explicit in_stock value, use setStockStatus, else toggle
    if (req.body && req.body.in_stock !== undefined) {
      const inStock = req.body.in_stock === true || req.body.in_stock === 'true';
      const product = setStockStatus(req.params.id, inStock);
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      res.json({ id: product.id, in_stock: product.in_stock, quantity: product.quantity });
    } else {
      const product = toggleStock(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      res.json({ id: product.id, in_stock: product.in_stock, quantity: product.quantity });
    }
  } catch (err) {
    console.error('Toggle stock error:', err);
    res.status(500).json({ error: 'Failed to toggle stock status.' });
  }
});

// ── PATCH /api/products/:id/quantity — update quantity (admin only) ──
router.patch('/:id/quantity', authenticateToken, (req, res) => {
  try {
    const { delta, absolute } = req.body;

    let product;
    if (absolute !== undefined) {
      // Set absolute quantity
      product = setQuantity(req.params.id, absolute);
    } else if (delta !== undefined) {
      // Adjust quantity by delta
      product = updateQuantity(req.params.id, parseInt(delta, 10));
    } else {
      return res.status(400).json({ error: 'Provide either "delta" or "absolute" quantity.' });
    }

    if (!product) return res.status(404).json({ error: 'Product not found.' });

    res.json({
      id: product.id,
      quantity: product.quantity,
      in_stock: product.in_stock
    });
  } catch (err) {
    console.error('Update quantity error:', err);
    res.status(500).json({ error: 'Failed to update quantity.' });
  }
});

// ── DELETE /api/products/:id — remove product (admin only) ─────
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const existing = getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    // Clean up image file
    if (existing.image) {
      const imgPath = path.join(uploadsDir, existing.image);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    deleteProductById(req.params.id);
    res.json({ message: 'Product deleted successfully.' });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

export default router;
