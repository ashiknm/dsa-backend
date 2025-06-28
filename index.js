"use client"

import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import pkg from "pg"
const { Pool } = pkg

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Database connection with optimized settings for Neon
const pool = new Pool({
  connectionString:
    "postgres://neondb_owner:npg_hx2bA3MZtcWB@ep-lively-sun-acqls4c2-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
  max: 10,
  min: 0,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  acquireTimeoutMillis: 5000,
  createTimeoutMillis: 5000,
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 200,
})

// Handle pool errors gracefully
pool.on("error", (err) => {
  console.error("Pool error:", err.message)
})

// Database helper function with better error handling
async function queryDatabase(text, params = []) {
  let client
  try {
    client = await pool.connect()
    const result = await client.query(text, params)
    return result
  } catch (error) {
    console.error("Database query error:", error.message)
    throw error
  } finally {
    if (client) {
      client.release()
    }
  }
}

// Helper function to get user bookmarks in frontend format
async function getUserBookmarks(userId = "admin") {
  try {
    const result = await queryDatabase("SELECT item_id, item_type FROM user_bookmarks WHERE user_id = $1", [userId])

    const bookmarks = {
      problems: [],
      notes: [],
      interviews: [],
    }

    result.rows.forEach((row) => {
      if (row.item_type === "problem") {
        bookmarks.problems.push(row.item_id)
      } else if (row.item_type === "note") {
        bookmarks.notes.push(row.item_id)
      } else if (row.item_type === "interview") {
        bookmarks.interviews.push(row.item_id)
      }
    })

    return bookmarks
  } catch (error) {
    console.error("Error getting user bookmarks:", error)
    return { problems: [], notes: [], interviews: [] }
  }
}

// Helper function to check if item is bookmarked
async function checkBookmarkStatus(itemId, itemType, userId = "admin") {
  try {
    const result = await queryDatabase(
      "SELECT id FROM user_bookmarks WHERE user_id = $1 AND item_id = $2 AND item_type = $3",
      [userId, itemId, itemType],
    )
    return result.rows.length > 0
  } catch (error) {
    console.error("Error checking bookmark status:", error)
    return false
  }
}

// Helper function to add bookmark status to items
async function addBookmarkStatus(items, itemType, userId = "admin") {
  if (!Array.isArray(items)) {
    const isBookmarked = await checkBookmarkStatus(items.id, itemType, userId)
    return { ...items, is_bookmarked: isBookmarked }
  }

  const itemsWithBookmarks = await Promise.all(
    items.map(async (item) => {
      const isBookmarked = await checkBookmarkStatus(item.id, itemType, userId)
      return { ...item, is_bookmarked: isBookmarked }
    }),
  )

  return itemsWithBookmarks
}

// Initialize tables on startup - Remove all foreign key constraints
async function initializeTables() {
  try {
    // Drop existing foreign key constraints if they exist
    await queryDatabase(`
      DO $$ 
      BEGIN
        -- Drop foreign key constraints if they exist
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'bookmarks_user_id_fkey') THEN
          ALTER TABLE bookmarks DROP CONSTRAINT bookmarks_user_id_fkey;
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'problems_author_id_fkey') THEN
          ALTER TABLE problems DROP CONSTRAINT problems_author_id_fkey;
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'notes_author_id_fkey') THEN
          ALTER TABLE notes DROP CONSTRAINT notes_author_id_fkey;
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'interviews_author_id_fkey') THEN
          ALTER TABLE interviews DROP CONSTRAINT interviews_author_id_fkey;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          NULL; -- Ignore errors if constraints don't exist
      END $$;
    `)

    // Create user_bookmarks table without foreign key constraints
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS user_bookmarks (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        item_id VARCHAR(255) NOT NULL,
        item_type VARCHAR(50) NOT NULL,
        item_title VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, item_id, item_type)
      )
    `)

    console.log("✅ Tables initialized successfully - All foreign key constraints removed")
  } catch (error) {
    console.error("❌ Error initializing tables:", error)
  }
}

// Simple connection test
async function testConnection() {
  try {
    const result = await queryDatabase("SELECT NOW() as current_time")
    console.log("✅ Database connection successful at:", result.rows[0].current_time)
    return true
  } catch (err) {
    console.error("❌ Database connection failed:", err.message)
    return false
  }
}

// Initialize on startup
testConnection()
initializeTables()

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://v0-react-dsa-website-ashiks-projects-9613a13b.vercel.app",
      "https://v0-react-dsa-website.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true }))

// Simple auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ success: false, error: "Invalid or missing token" })
  }

  if (token === "simple-admin-token-123") {
    req.user = { id: "admin" }
    return next()
  }

  if (token.startsWith("user-token-")) {
    const userId = token.replace("user-token-", "")
    req.user = { id: userId }
    return next()
  }

  return res.status(403).json({ success: false, error: "Invalid token format" })
}


// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "DSA Backend API is running!",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "GET /api/health",
      auth: {
        login: "POST /api/auth/login",
        me: "GET /api/auth/me",
      },
      problems: {
        getAll: "GET /api/problems",
        getOne: "GET /api/problems/:id",
        create: "POST /api/problems",
        update: "PUT /api/problems/:id",
        delete: "DELETE /api/problems/:id",
      },
      notes: {
        getAll: "GET /api/notes",
        getOne: "GET /api/notes/:id",
        create: "POST /api/notes",
        update: "PUT /api/notes/:id",
        delete: "DELETE /api/notes/:id",
      },
      interviews: {
        getAll: "GET /api/interviews",
        getOne: "GET /api/interviews/:id",
        create: "POST /api/interviews",
        update: "PUT /api/interviews/:id",
        delete: "DELETE /api/interviews/:id",
      },
      bookmarks: {
        getAll: "GET /api/bookmarks",
        toggle: "POST /api/bookmarks (toggle add/remove)",
        removeByItemId: "DELETE /api/bookmarks/:item_id?type=:item_type",
        removeById: "DELETE /api/bookmarks/id/:id",
      },
    },
  })
})

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    message: "DSA Backend is running!",
    database: "Neon PostgreSQL",
    version: "1.0.0",
  })
})

// Test database connection endpoint
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await queryDatabase("SELECT NOW() as current_time, version() as db_version")
    res.json({
      success: true,
      database_time: result.rows[0].current_time,
      database_version: result.rows[0].db_version.substring(0, 50) + "...",
      message: "Database connection successful!",
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Database connection failed",
      details: error.message,
    })
  }
})

// ==================== PROBLEMS CRUD WITH BOOKMARK STATUS ====================

// Get all problems with bookmark status
app.get("/api/problems", async (req, res) => {
  try {
    const { category, difficulty, search } = req.query
    let query = `
      SELECT id, title, difficulty, category, tags, description, explanation, code, test_cases, created_at
      FROM problems
      WHERE 1=1
    `
    const params = []

    if (category) {
      params.push(category)
      query += ` AND category = $${params.length}`
    }

    if (difficulty) {
      params.push(difficulty)
      query += ` AND difficulty = $${params.length}`
    }

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`
    }

    query += ` ORDER BY created_at DESC`

    const result = await queryDatabase(query, params)
    const problemsWithBookmarks = await addBookmarkStatus(result.rows, "problem")

    res.json({
      success: true,
      count: result.rows.length,
      problems: problemsWithBookmarks,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch problems",
      details: error.message,
    })
  }
})

// Get single problem with bookmark status
app.get("/api/problems/:id", async (req, res) => {
  try {
    const { id } = req.params
    const result = await queryDatabase(
      `SELECT id, title, difficulty, category, tags, description, explanation, code, test_cases, created_at
       FROM problems
       WHERE id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Problem not found",
      })
    }

    const problemWithBookmark = await addBookmarkStatus(result.rows[0], "problem")

    res.json({
      success: true,
      problem: problemWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch problem",
      details: error.message,
    })
  }
})

// Create new problem with bookmark status
app.post("/api/problems", authenticateToken, async (req, res) => {
  try {
    const { title, difficulty, category, tags, description, explanation, code, test_cases } = req.body

    if (!title || !difficulty || !category || !description) {
      return res.status(400).json({
        success: false,
        error: "Title, difficulty, category, and description are required",
      })
    }

    const result = await queryDatabase(
      `INSERT INTO problems (title, difficulty, category, tags, description, explanation, code, test_cases)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, difficulty, category, tags, description, explanation, code, test_cases, created_at`,
      [title, difficulty, category, tags || [], description, explanation, code, test_cases],
    )

    const problemWithBookmark = await addBookmarkStatus(result.rows[0], "problem")

    res.status(201).json({
      success: true,
      message: "Problem created successfully",
      problem: problemWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create problem",
      details: error.message,
    })
  }
})

// Update problem with bookmark status
app.put("/api/problems/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { title, difficulty, category, tags, description, explanation, code, test_cases } = req.body

    const result = await queryDatabase(
      `UPDATE problems 
       SET title = COALESCE($1, title),
           difficulty = COALESCE($2, difficulty),
           category = COALESCE($3, category),
           tags = COALESCE($4, tags),
           description = COALESCE($5, description),
           explanation = COALESCE($6, explanation),
           code = COALESCE($7, code),
           test_cases = COALESCE($8, test_cases),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING id, title, difficulty, category, tags, description, explanation, code, test_cases, created_at, updated_at`,
      [title, difficulty, category, tags, description, explanation, code, test_cases, id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Problem not found",
      })
    }

    const problemWithBookmark = await addBookmarkStatus(result.rows[0], "problem")

    res.json({
      success: true,
      message: "Problem updated successfully",
      problem: problemWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to update problem",
      details: error.message,
    })
  }
})

// Delete problem and its bookmarks
app.delete("/api/problems/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Delete associated bookmarks first
    await queryDatabase("DELETE FROM user_bookmarks WHERE item_id = $1 AND item_type = $2", [id, "problem"])

    const result = await queryDatabase(`DELETE FROM problems WHERE id = $1 RETURNING id, title`, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Problem not found",
      })
    }

    res.json({
      success: true,
      message: "Problem deleted successfully",
      deleted: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to delete problem",
      details: error.message,
    })
  }
})

// ==================== NOTES CRUD WITH BOOKMARK STATUS ====================

// Get all notes with bookmark status
app.get("/api/notes", async (req, res) => {
  try {
    const { category, search } = req.query
    let query = `
      SELECT id, title, category, tags, description, content, created_at
      FROM notes
      WHERE 1=1
    `
    const params = []

    if (category) {
      params.push(category)
      query += ` AND category = $${params.length}`
    }

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length} OR content ILIKE $${params.length})`
    }

    query += ` ORDER BY created_at DESC`

    const result = await queryDatabase(query, params)
    const notesWithBookmarks = await addBookmarkStatus(result.rows, "note")

    res.json({
      success: true,
      count: result.rows.length,
      notes: notesWithBookmarks,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch notes",
      details: error.message,
    })
  }
})

// Get single note with bookmark status
app.get("/api/notes/:id", async (req, res) => {
  try {
    const { id } = req.params
    const result = await queryDatabase(
      `SELECT id, title, category, tags, description, content, created_at
       FROM notes
       WHERE id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Note not found",
      })
    }

    const noteWithBookmark = await addBookmarkStatus(result.rows[0], "note")

    res.json({
      success: true,
      note: noteWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch note",
      details: error.message,
    })
  }
})

// Create new note with bookmark status
app.post("/api/notes", authenticateToken, async (req, res) => {
  try {
    const { title, category, tags, description, content } = req.body

    if (!title || !category || !content) {
      return res.status(400).json({
        success: false,
        error: "Title, category, and content are required",
      })
    }

    const result = await queryDatabase(
      `INSERT INTO notes (title, category, tags, description, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, category, tags, description, content, created_at`,
      [title, category, tags || [], description, content],
    )

    const noteWithBookmark = await addBookmarkStatus(result.rows[0], "note")

    res.status(201).json({
      success: true,
      message: "Note created successfully",
      note: noteWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create note",
      details: error.message,
    })
  }
})

// Update note with bookmark status
app.put("/api/notes/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { title, category, tags, description, content } = req.body

    const result = await queryDatabase(
      `UPDATE notes 
       SET title = COALESCE($1, title),
           category = COALESCE($2, category),
           tags = COALESCE($3, tags),
           description = COALESCE($4, description),
           content = COALESCE($5, content),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, title, category, tags, description, content, created_at, updated_at`,
      [title, category, tags, description, content, id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Note not found",
      })
    }

    const noteWithBookmark = await addBookmarkStatus(result.rows[0], "note")

    res.json({
      success: true,
      message: "Note updated successfully",
      note: noteWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to update note",
      details: error.message,
    })
  }
})

// Delete note and its bookmarks
app.delete("/api/notes/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Delete associated bookmarks first
    await queryDatabase("DELETE FROM user_bookmarks WHERE item_id = $1 AND item_type = $2", [id, "note"])

    const result = await queryDatabase(`DELETE FROM notes WHERE id = $1 RETURNING id, title`, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Note not found",
      })
    }

    res.json({
      success: true,
      message: "Note deleted successfully",
      deleted: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to delete note",
      details: error.message,
    })
  }
})

// ==================== INTERVIEWS CRUD WITH BOOKMARK STATUS ====================

// Get all interviews with bookmark status
app.get("/api/interviews", async (req, res) => {
  try {
    const { category, search } = req.query
    let query = `
      SELECT id, title, category, tags, description, content, created_at
      FROM interviews
      WHERE 1=1
    `
    const params = []

    if (category) {
      params.push(category)
      query += ` AND category = $${params.length}`
    }

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length} OR content ILIKE $${params.length})`
    }

    query += ` ORDER BY created_at DESC`

    const result = await queryDatabase(query, params)
    const interviewsWithBookmarks = await addBookmarkStatus(result.rows, "interview")

    res.json({
      success: true,
      count: result.rows.length,
      interviews: interviewsWithBookmarks,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch interviews",
      details: error.message,
    })
  }
})

// Get single interview with bookmark status
app.get("/api/interviews/:id", async (req, res) => {
  try {
    const { id } = req.params
    const result = await queryDatabase(
      `SELECT id, title, category, tags, description, content, created_at
       FROM interviews
       WHERE id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Interview not found",
      })
    }

    const interviewWithBookmark = await addBookmarkStatus(result.rows[0], "interview")

    res.json({
      success: true,
      interview: interviewWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch interview",
      details: error.message,
    })
  }
})

// Create new interview with bookmark status
app.post("/api/interviews", authenticateToken, async (req, res) => {
  try {
    const { title, category, tags, description, content } = req.body

    if (!title || !category || !content) {
      return res.status(400).json({
        success: false,
        error: "Title, category, and content are required",
      })
    }

    const result = await queryDatabase(
      `INSERT INTO interviews (title, category, tags, description, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, category, tags, description, content, created_at`,
      [title, category, tags || [], description, content],
    )

    const interviewWithBookmark = await addBookmarkStatus(result.rows[0], "interview")

    res.status(201).json({
      success: true,
      message: "Interview created successfully",
      interview: interviewWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create interview",
      details: error.message,
    })
  }
})

// Update interview with bookmark status
app.put("/api/interviews/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { title, category, tags, description, content } = req.body

    const result = await queryDatabase(
      `UPDATE interviews 
       SET title = COALESCE($1, title),
           category = COALESCE($2, category),
           tags = COALESCE($3, tags),
           description = COALESCE($4, description),
           content = COALESCE($5, content),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, title, category, tags, description, content, created_at, updated_at`,
      [title, category, tags, description, content, id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Interview not found",
      })
    }

    const interviewWithBookmark = await addBookmarkStatus(result.rows[0], "interview")

    res.json({
      success: true,
      message: "Interview updated successfully",
      interview: interviewWithBookmark,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to update interview",
      details: error.message,
    })
  }
})

// Delete interview and its bookmarks
app.delete("/api/interviews/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Delete associated bookmarks first
    await queryDatabase("DELETE FROM user_bookmarks WHERE item_id = $1 AND item_type = $2", [id, "interview"])

    const result = await queryDatabase(`DELETE FROM interviews WHERE id = $1 RETURNING id, title`, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Interview not found",
      })
    }

    res.json({
      success: true,
      message: "Interview deleted successfully",
      deleted: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to delete interview",
      details: error.message,
    })
  }
})

// ==================== AUTH ENDPOINTS ====================

// Login endpoint - Returns user with bookmarks in frontend format
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      })
    }

    // 1️⃣ Check for hardcoded admin credentials
    if (email === "admin@example.com" && password === "admin123") {
      const bookmarks = await getUserBookmarks("admin")

      return res.json({
        success: true,
        message: "Login successful",
        user: {
          id: "admin",
          email: "admin@example.com",
          name: "Admin User",
          role: "admin",
          bookmarks,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        token: "simple-admin-token-123",
      })
    }

    // 2️⃣ Check database for regular user
    const result = await queryDatabase(
      "SELECT id, email, name, role, password_hash, created_at, updated_at FROM users WHERE email = $1",
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      })
    }

    const user = result.rows[0]

    // (In production, use bcrypt.compare)
    if (user.password_hash !== password) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password",
      })
    }

    const token = `user-token-${user.id}`
    const bookmarks = await getUserBookmarks(user.id)

    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        bookmarks,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      token,
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({
      success: false,
      error: "Login failed",
      details: error.message,
    })
  }
})

// Get current user - Returns user with bookmarks in frontend format
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id

    // 1️⃣ If admin, return hardcoded user
    if (userId === "admin") {
      const bookmarks = await getUserBookmarks("admin")

      return res.json({
        success: true,
        user: {
          id: "admin",
          email: "admin@example.com",
          name: "Admin User",
          role: "admin",
          bookmarks,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
    }

    // 2️⃣ Else fetch user from database
    const result = await queryDatabase(
      "SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1",
      [userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      })
    }

    const user = result.rows[0]
    const bookmarks = await getUserBookmarks(user.id)

    res.json({
      success: true,
      user: {
        ...user,
        bookmarks,
      },
    })
  } catch (error) {
    console.error("Get user error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get current user",
      details: error.message,
    })
  }
})


app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: "Name, email, and password are required",
      })
    }

    // Check if user already exists
    const existing = await queryDatabase("SELECT id FROM users WHERE email = $1", [email])
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "User already exists",
      })
    }

    // (In production, hash the password using bcrypt)
    const result = await queryDatabase(
      `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, name, email, role, created_at, updated_at`,
      [name, email, password, "user"]
    )

    const user = result.rows[0]
    const token = `user-token-${user.id}`
    const bookmarks = await getUserBookmarks(user.id) // or [] if empty

    res.status(201).json({
      success: true,
      message: "Registration successful",
      user: {
        ...user,
        bookmarks,
      },
      token,
    })
  } catch (error) {
    console.error("Register error:", error)
    res.status(500).json({
      success: false,
      error: "Registration failed",
      details: error.message,
    })
  }
})


// ==================== BOOKMARKS ENDPOINTS - TOGGLE SYSTEM ====================

// Toggle bookmark (add if not exists, remove if exists)
app.post("/api/bookmarks", async (req, res) => {
  try {
    const { user_id, item_id, item_type } = req.body
    const actualUserId = user_id || "admin"

    if (!item_id || !item_type) {
      return res.status(400).json({
        success: false,
        error: "item_id and item_type are required",
      })
    }

    // Validate item_type
    if (!["problem", "note", "interview"].includes(item_type)) {
      return res.status(400).json({
        success: false,
        error: "item_type must be 'problem', 'note', or 'interview'",
      })
    }

    // Check if bookmark already exists
    const existingBookmark = await queryDatabase(
      "SELECT id FROM user_bookmarks WHERE user_id = $1 AND item_id = $2 AND item_type = $3",
      [actualUserId, item_id, item_type],
    )

    if (existingBookmark.rows.length > 0) {
      // Remove bookmark if it exists
      await queryDatabase("DELETE FROM user_bookmarks WHERE user_id = $1 AND item_id = $2 AND item_type = $3", [
        actualUserId,
        item_id,
        item_type,
      ])

      // Get updated user bookmarks
      const updatedBookmarks = await getUserBookmarks(actualUserId)

      res.json({
        success: true,
        action: "removed",
        message: "Bookmark removed successfully",
        user: {
          id: actualUserId,
          email: "admin@example.com",
          name: "Admin User",
          role: "admin",
          bookmarks: updatedBookmarks,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
    } else {
      // Get item title for better display
      let itemTitle = "Unknown Item"
      try {
        let titleQuery
        if (item_type === "problem") {
          titleQuery = await queryDatabase("SELECT title FROM problems WHERE id = $1", [item_id])
        } else if (item_type === "note") {
          titleQuery = await queryDatabase("SELECT title FROM notes WHERE id = $1", [item_id])
        } else if (item_type === "interview") {
          titleQuery = await queryDatabase("SELECT title FROM interviews WHERE id = $1", [item_id])
        }

        if (titleQuery && titleQuery.rows.length > 0) {
          itemTitle = titleQuery.rows[0].title
        }
      } catch (titleError) {
        console.error("Error fetching item title:", titleError)
      }

      // Add new bookmark
      await queryDatabase(
        `INSERT INTO user_bookmarks (user_id, item_id, item_type, item_title)
         VALUES ($1, $2, $3, $4)`,
        [actualUserId, item_id, item_type, itemTitle],
      )

      // Get updated user bookmarks
      const updatedBookmarks = await getUserBookmarks(actualUserId)

      res.status(201).json({
        success: true,
        action: "added",
        message: "Bookmark added successfully",
        user: {
          id: actualUserId,
          email: "admin@example.com",
          name: "Admin User",
          role: "admin",
          bookmarks: updatedBookmarks,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
    }
  } catch (error) {
    console.error("Bookmarks POST error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to toggle bookmark",
      details: error.message,
    })
  }
})

// Get user bookmarks
app.get("/api/bookmarks", async (req, res) => {
  try {
    const { item_type, user_id = "admin" } = req.query

    let query = `
      SELECT id, user_id, item_id, item_type, item_title, created_at
      FROM user_bookmarks
      WHERE user_id = $1
    `
    const params = [user_id]

    if (item_type) {
      params.push(item_type)
      query += ` AND item_type = $${params.length}`
    }

    query += ` ORDER BY created_at DESC`

    const result = await queryDatabase(query, params)

    res.json({
      success: true,
      count: result.rows.length,
      bookmarks: result.rows,
    })
  } catch (error) {
    console.error("Bookmarks GET error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch bookmarks",
      details: error.message,
    })
  }
})

// Remove bookmark by item_id with query parameter type
// This handles: DELETE /api/bookmarks/:item_id?type=:item_type
app.delete("/api/bookmarks/:item_id", async (req, res) => {
  try {
    const { item_id } = req.params
    const { type } = req.query
    const userId = "admin"

    if (!type) {
      return res.status(400).json({
        success: false,
        error: "Query parameter 'type' is required (e.g., ?type=interview)",
      })
    }

    // Map frontend type to backend type
    let item_type = type
    if (type === "interviews") item_type = "interview"
    if (type === "problems") item_type = "problem"
    if (type === "notes") item_type = "note"

    console.log(`Attempting to remove bookmark: user_id=${userId}, item_id=${item_id}, item_type=${item_type}`)

    const result = await queryDatabase(
      `DELETE FROM user_bookmarks WHERE user_id = $1 AND item_id = $2 AND item_type = $3 RETURNING id, item_id, item_type`,
      [userId, item_id, item_type],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Bookmark not found",
        debug: {
          user_id: userId,
          item_id: item_id,
          item_type: item_type,
          original_type: type,
        },
      })
    }

    // Get updated user bookmarks
    const updatedBookmarks = await getUserBookmarks(userId)

    res.json({
      success: true,
      message: "Bookmark removed successfully",
      user: {
        id: userId,
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        bookmarks: updatedBookmarks,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      deleted: result.rows[0],
    })
  } catch (error) {
    console.error("Bookmarks DELETE error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to remove bookmark",
      details: error.message,
    })
  }
})

// Remove bookmark by bookmark database ID
// This handles: DELETE /api/bookmarks/id/:id
app.delete("/api/bookmarks/id/:id", async (req, res) => {
  try {
    const { id } = req.params

    const result = await queryDatabase(
      `DELETE FROM user_bookmarks WHERE id = $1 AND user_id = $2 RETURNING id, item_id, item_type`,
      [id, "admin"],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Bookmark not found",
      })
    }

    // Get updated user bookmarks
    const updatedBookmarks = await getUserBookmarks("admin")

    res.json({
      success: true,
      message: "Bookmark removed successfully",
      user: {
        id: "admin",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        bookmarks: updatedBookmarks,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      deleted: result.rows[0],
    })
  } catch (error) {
    console.error("Bookmarks DELETE error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to remove bookmark",
      details: error.message,
    })
  }
})

// ==================== ADMIN STATS ====================

// Get admin statistics
app.get("/api/admin/stats", authenticateToken, async (req, res) => {
  try {
    const [problemsCount, notesCount, interviewsCount] = await Promise.all([
      queryDatabase("SELECT COUNT(*) as count FROM problems"),
      queryDatabase("SELECT COUNT(*) as count FROM notes"),
      queryDatabase("SELECT COUNT(*) as count FROM interviews"),
    ])

    // Try to get bookmarks count
    let bookmarksCount = 0
    try {
      const bookmarksResult = await queryDatabase("SELECT COUNT(*) as count FROM user_bookmarks")
      bookmarksCount = Number.parseInt(bookmarksResult.rows[0].count)
    } catch (error) {
      console.log("Bookmarks table doesn't exist yet, count = 0")
    }

    res.json({
      success: true,
      stats: {
        problems: Number.parseInt(problemsCount.rows[0].count),
        notes: Number.parseInt(notesCount.rows[0].count),
        interviews: Number.parseInt(interviewsCount.rows[0].count),
        bookmarks: bookmarksCount,
      },
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch admin stats",
      details: error.message,
    })
  }
})

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
  })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err)
  res.status(500).json({
    success: false,
    error: "Internal server error",
    details: process.env.NODE_ENV === "development" ? err.message : "Something went wrong",
  })
})

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...")
  try {
    await pool.end()
    console.log("✅ Database pool closed")
  } catch (err) {
    console.error("❌ Error closing database pool:", err.message)
  }
  process.exit(0)
})

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...")
  try {
    await pool.end()
    console.log("✅ Database pool closed")
  } catch (err) {
    console.error("❌ Error closing database pool:", err.message)
  }
  process.exit(0)
})

app.listen(PORT, () => {
  console.log(`🚀 DSA Backend running on port ${PORT}`)
  console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`)
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`)
  console.log(`🗄️  Database: Neon PostgreSQL`)
  console.log(`📝 API Documentation: http://localhost:${PORT}/`)
})
