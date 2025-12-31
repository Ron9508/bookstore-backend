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
