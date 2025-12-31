import cors from "cors"
import mysql from "mysql"
import express from "express"
import dotenv from "dotenv"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization; // "Bearer <token>"
  if (!authHeader) return res.status(401).json({ message: "No token provided" });

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer")
    return res.status(401).json({ message: "Invalid token format" });

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};


// Database connection
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
});

// Books Route 
app.get("/books", (req, res) => {
  const q = "SELECT * FROM books";

  db.query(q, (err, data) => {
    if (err) {
      return res.status(500).json({ message: "Database error" });
    }
    return res.status(200).json(data);
  });
});

// Signup route
app.post("/signup", (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const checkQ = "SELECT id FROM users WHERE email = ?";
  db.query(checkQ, [email], async (err, data) => {
    if (err) return res.status(500).json({ message: err.message, code:err.code });
    if (data.length > 0) return res.status(409).json({ message: "Email already exists" });

    try {
      const password_hash = await bcrypt.hash(password, 10);

      const insertQ =
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)";
      db.query(insertQ, [name, email, password_hash], (err2, result) => {
        if (err2) return res.status(500).json({ message: "Database error" });

        return res.status(201).json({ message: "Signup successful", id: result.insertId });
      });
    } catch (e) {
      return res.status(500).json({ message: "Password hashing failed" });
    }
  });
});

// Login route
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Missing email or password" });
  }

  const q = "SELECT id, name, email, role, password_hash FROM users WHERE email = ?";
  db.query(q, [email], async (err, data) => {
    if (err) return res.status(500).json({ message: err.message, code:err.code });
    if (data.length === 0) return res.status(401).json({ message: "Invalid credentials" });

    const user = data[0];

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });
});

// Orders
app.post("/orders", verifyToken, (req, res) => {
  const userId = req.user.id;
  const items = req.body.items; // [{ book_id, quantity }]

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Order items are required" });
  }

  // 1) Load current prices for the requested books
  const bookIds = items.map((it) => it.book_id);
  const qBooks = `SELECT id, price FROM books WHERE id IN (${bookIds.map(() => "?").join(",")})`;

  db.query(qBooks, bookIds, (err, books) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    if (books.length !== bookIds.length) {
      return res.status(400).json({ message: "One or more books not found" });
    }

    const priceMap = new Map(books.map((b) => [b.id, Number(b.price)]));

    // compute total
    let total = 0;
    for (const it of items) {
      const qty = Number(it.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ message: "Invalid quantity" });
      }
      total += priceMap.get(it.book_id) * qty;
    }

    // 2) Create order row
    const qOrder = "INSERT INTO orders (user_id, total, status) VALUES (?, ?, 'pending')";
    db.query(qOrder, [userId, total], (err2, orderResult) => {
      if (err2) {
        console.error(err2);
        return res.status(500).json({ message: "Database error" });
      }

      const orderId = orderResult.insertId;

      // 3) Insert order_items
      const qItem = "INSERT INTO order_items (order_id, book_id, quantity, price) VALUES ?";
      const values = items.map((it) => [
        orderId,
        it.book_id,
        Number(it.quantity),
        priceMap.get(it.book_id),
      ]);

      db.query(qItem, [values], (err3) => {
        if (err3) {
          console.error(err3);
          return res.status(500).json({ message: "Database error" });
        }

        return res.status(201).json({ message: "Order created", orderId, total });
      });
    });
  });
});

// My orders
app.get("/orders/my", verifyToken, (req, res) => {
  const userId = req.user.id;

  const q = `
    SELECT o.id AS order_id, o.total, o.status, o.created_at,
           oi.book_id, oi.quantity, oi.price,
           b.title, b.author, b.isbn13
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN books b ON b.id = oi.book_id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC, o.id DESC
  `;

  db.query(q, [userId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    return res.json(rows);
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT , () => {
  console.log(`Server running on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("API is running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});


// Add a new book
app.post("/books", verifyToken, (req, res) => {
  const { title, author, isbn13, price, stock } = req.body;

  // Basic validation (simple and instructor-friendly)
  if (!title || !author || !isbn13 || price === undefined || stock === undefined) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Extra sanity checks
  if (String(isbn13).length !== 13) {
    return res.status(400).json({ message: "isbn13 must be 13 digits" });
  }

  const q =
    "INSERT INTO books (title, author, isbn13, price, stock) VALUES (?, ?, ?, ?, ?)";

  const values = [title, author, String(isbn13), Number(price), Number(stock)];

  db.query(q, values, (err, result) => {
    if (err) {
      // Duplicate ISBN
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "This ISBN already exists" });
      }
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    return res.status(201).json({
      message: "Book added successfully",
      id: result.insertId,
    });
  });
});

// Update a book
app.put("/books/:id", verifyToken, (req, res) => {
  const bookId = req.params.id;
  const { title, author, isbn13, price, stock } = req.body;

  if (!title || !author || !isbn13 || price === undefined || stock === undefined) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const q = `
    UPDATE books
    SET title = ?, author = ?, isbn13 = ?, price = ?, stock = ?
    WHERE id = ?
  `;

  const values = [
    title,
    author,
    String(isbn13),
    Number(price),
    Number(stock),
    bookId,
  ];

  db.query(q, values, (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "ISBN already exists" });
      }
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Book not found" });
    }

    return res.json({ message: "Book updated successfully" });
  });
});

// Delete a book
app.delete("/books/:id", verifyToken, (req, res) => {
  const bookId = req.params.id;

  const q = "DELETE FROM books WHERE id = ?";

  db.query(q, [bookId], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Book not found" });
    }

    return res.json({ message: "Book deleted successfully" });
  });
});
