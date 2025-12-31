import cors from "cors"
import mysql from "mysql"
import express from "express"

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

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

app.listen(5000, () => {
  console.log("Server running on port 5000");
});

// Add a new book
app.post("/books", (req, res) => {
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

