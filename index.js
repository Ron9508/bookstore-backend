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
  host: "localhost",
  user: "root",
  password: "",
  database: "bookstore",
  port: 3307
}
)

// Test database connection
db.getConnection((err) => {
  if (err) {
    console.error("Database connection failed:", err)
  } else {
    console.log("Connected to MySQL database");
  }
});

// Heath check
app.get("/health", (req, res) => {
  res.status(200).json({ok: true, message: "API is running"});
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
    if (err) return res.status(500).json({ message: "Database error" });
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

  const q = "SELECT id, email, role, password_hash FROM users WHERE email = ?";
  db.query(q, [email], async (err, data) => {
    if (err) return res.status(500).json({ message: "Database error" });
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
      user: { id: user.id, email: user.email, role: user.role },
    });
  });
});


app.listen(5000, () => {
  console.log("Server running on port 5000");
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
