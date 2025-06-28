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

// Helper function to check if string is valid UUID
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

// Helper function to find item by string ID and get its UUID
async function findItemUUID(itemId, itemType) {
  try {
    // If it's already a UUID, return it
    if (isValidUUID(itemId)) {
      return itemId
    }

    // Otherwise, try to find the item by title or other identifier
    let query
    let tableName

    switch (itemType) {
      case "problem":
        tableName = "problems"
        break
      case "note":
        tableName = "notes"
        break
      case "interview":
        tableName = "interviews"
        break
      default:
        throw new Error("Invalid item type")
    }

    // Try to find by title first (case insensitive)
    query = `SELECT id FROM ${tableName} WHERE LOWER(title) = LOWER($1) LIMIT 1`
    let result = await queryDatabase(query, [itemId])

    if (result.rows.length > 0) {
      return result.rows[0].id
    }

    // If not found by title, try to find by ID if it looks like a slug
    // For now, we'll create a mapping table or use a different approach
    // Let's try to find by any text field that might match
    query = `SELECT id FROM ${tableName} WHERE 
             LOWER(title) LIKE LOWER($1) OR 
             LOWER(category) LIKE LOWER($1) OR
             $1 = ANY(tags)
             LIMIT 1`
    result = await queryDatabase(query, [`%${itemId}%`])

    if (result.rows.length > 0) {
      return result.rows[0].id
    }

    // If still not found, return null
    return null
  } catch (error) {
    console.error("Error finding item UUID:", error)
    return null
  }
}

// Simple connection test without keeping connection open
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

// Test connection on startup
testConnection()

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://v0-react-dsa-website-ashiks-projects-9613a13b.vercel.app",
      "https://your-frontend-domain.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true }))

// Simple auth middleware - Updated to use proper UUID
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "")

  if (token === "simple-admin-token-123") {
    req.user = {
      id: "550e8400-e29b-41d4-a716-446655440000", // Valid UUID format
      email: "admin@example.com",
      name: "Admin User",
      role: "admin",
    }
    next()
  } else {
    res.status(401).json({
      success: false,
      error: "Invalid or missing token",
    })
  }
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
        add: "POST /api/bookmarks",
        remove: "DELETE /api/bookmarks/:id",
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

// Check existing tables
app.get("/api/check-tables", async (req, res) => {
  try {
    const result = await queryDatabase(`
      SELECT table_name, 
             (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)

    res.json({
      success: true,
      tables: result.rows,
      count: result.rows.length,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to check tables",
      details: error.message,
    })
  }
})

// Create all required tables - Updated to match your exact schema
app.post("/api/create-tables", async (req, res) => {
  try {
    // Enable uuid-ossp extension if not already enabled
    await queryDatabase(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)

    // Create users table - matching your schema exactly
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create problems table - matching your schema exactly
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS problems (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(255) NOT NULL,
        difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
        category VARCHAR(100) NOT NULL,
        tags TEXT[] DEFAULT '{}',
        description TEXT NOT NULL,
        explanation TEXT,
        code TEXT,
        test_cases TEXT,
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create notes table - matching your schema exactly
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        tags TEXT[] DEFAULT '{}',
        description TEXT,
        content TEXT NOT NULL,
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create interviews table - matching your schema exactly
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS interviews (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        tags TEXT[] DEFAULT '{}',
        description TEXT,
        content TEXT NOT NULL,
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create bookmarks table - matching your schema exactly
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id UUID NOT NULL,
        item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('problem', 'note', 'interview')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, item_id, item_type)
      )
    `)

    // Create indexes for better performance
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_problems_category ON problems(category)`)
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty)`)
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_problems_author ON problems(author_id)`)
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category)`)
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_notes_author ON notes(author_id)`)
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_interviews_category ON interviews(category)`)
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_interviews_author ON interviews(author_id)`)
    await queryDatabase(`CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id)`)

    res.json({
      success: true,
      message: "All tables and indexes created successfully!",
      tables: ["users", "problems", "notes", "interviews", "bookmarks"],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create tables",
      details: error.message,
    })
  }
})

// Insert sample data - Updated to work with your schema
app.post("/api/seed-data", async (req, res) => {
  try {
    // First, insert a sample admin user
    await queryDatabase(`
      INSERT INTO users (id, email, name, password_hash, role)
      VALUES ('550e8400-e29b-41d4-a716-446655440000', 'admin@example.com', 'Admin User', 'hashed_password_here', 'admin')
      ON CONFLICT (email) DO NOTHING
    `)

    // Insert sample problems with author_id
    await queryDatabase(`
      INSERT INTO problems (title, difficulty, category, tags, description, explanation, code, test_cases, author_id)
      VALUES 
      ('Two Sum', 'Easy', 'Array', ARRAY['array', 'hash-table'], 
       'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
       'Use a hash map to store the complement of each number as you iterate through the array.',
       'function twoSum(nums, target) {\n  const map = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (map.has(complement)) {\n      return [map.get(complement), i];\n    }\n    map.set(nums[i], i);\n  }\n  return [];\n}',
       '[{"input": {"nums": [2,7,11,15], "target": 9}, "output": [0,1]}, {"input": {"nums": [3,2,4], "target": 6}, "output": [1,2]}]',
       '550e8400-e29b-41d4-a716-446655440000'),
      ('Reverse String', 'Easy', 'String', ARRAY['string', 'two-pointers'], 
       'Write a function that reverses a string. The input string is given as an array of characters s.',
       'Use two pointers approach - one at the beginning and one at the end, swap characters and move towards center.',
       'function reverseString(s) {\n  let left = 0;\n  let right = s.length - 1;\n  while (left < right) {\n    [s[left], s[right]] = [s[right], s[left]];\n    left++;\n    right--;\n  }\n  return s;\n}',
       '[{"input": {"s": ["h","e","l","l","o"]}, "output": ["o","l","l","e","h"]}, {"input": {"s": ["H","a","n","n","a","h"]}, "output": ["h","a","n","n","a","H"]}]',
       '550e8400-e29b-41d4-a716-446655440000')
      ON CONFLICT DO NOTHING
    `)

    // Insert sample notes with author_id
    await queryDatabase(`
      INSERT INTO notes (title, category, tags, description, content, author_id)
      VALUES 
      ('JavaScript Closures', 'JavaScript', ARRAY['javascript', 'closures', 'scope'], 
       'Understanding closures in JavaScript',
       '# JavaScript Closures\n\nA closure is a function that has access to variables in its outer (enclosing) scope even after the outer function has returned.\n\n## Example\n\n\`\`\`javascript\nfunction outerFunction(x) {\n  return function innerFunction(y) {\n    return x + y;\n  };\n}\n\nconst addFive = outerFunction(5);\nconsole.log(addFive(3)); // 8\n\`\`\`',
       '550e8400-e29b-41d4-a716-446655440000'),
      ('Big O Notation', 'Algorithms', ARRAY['algorithms', 'complexity', 'big-o'], 
       'Understanding time and space complexity',
       '# Big O Notation\n\nBig O notation describes the performance or complexity of an algorithm.\n\n## Common Complexities\n\n- O(1) - Constant time\n- O(log n) - Logarithmic time\n- O(n) - Linear time\n- O(n log n) - Linearithmic time\n- O(n²) - Quadratic time',
       '550e8400-e29b-41d4-a716-446655440000')
      ON CONFLICT DO NOTHING
    `)

    // Insert sample interviews with author_id
    await queryDatabase(`
      INSERT INTO interviews (title, category, tags, description, content, author_id)
      VALUES 
      ('React Hooks Interview Questions', 'React', ARRAY['react', 'hooks', 'interview'], 
       'Common React Hooks interview questions and answers',
       '# React Hooks Interview Questions\n\n## 1. What are React Hooks?\n\nReact Hooks are functions that let you use state and other React features in functional components.\n\n## 2. What is useState?\n\nuseState is a Hook that lets you add state to functional components.\n\n\`\`\`javascript\nconst [count, setCount] = useState(0);\n\`\`\`',
       '550e8400-e29b-41d4-a716-446655440000'),
      ('JavaScript Interview Questions', 'JavaScript', ARRAY['javascript', 'interview', 'fundamentals'], 
       'Essential JavaScript interview questions',
       '# JavaScript Interview Questions\n\n## 1. What is hoisting?\n\nHoisting is JavaScript''s default behavior of moving declarations to the top of their scope.\n\n## 2. What is the difference between let, const, and var?\n\n- var: function-scoped, can be redeclared\n- let: block-scoped, cannot be reassigned',
       '550e8400-e29b-41d4-a716-446655440000')
      ON CONFLICT DO NOTHING
    `)

    res.json({
      success: true,
      message: "Sample data inserted successfully!",
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to insert sample data",
      details: error.message,
    })
  }
})

// ==================== PROBLEMS CRUD ====================

// Get all problems
app.get("/api/problems", async (req, res) => {
  try {
    const { category, difficulty, search } = req.query
    let query = `
      SELECT p.id, p.title, p.difficulty, p.category, p.tags, p.description, p.explanation, p.code, p.test_cases, p.created_at,
             u.name as author_name
      FROM problems p
      LEFT JOIN users u ON p.author_id = u.id
      WHERE 1=1
    `
    const params = []

    if (category) {
      params.push(category)
      query += ` AND p.category = $${params.length}`
    }

    if (difficulty) {
      params.push(difficulty)
      query += ` AND p.difficulty = $${params.length}`
    }

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`
    }

    query += ` ORDER BY p.created_at DESC`

    const result = await queryDatabase(query, params)

    res.json({
      success: true,
      count: result.rows.length,
      problems: result.rows,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch problems",
      details: error.message,
    })
  }
})

// Get single problem
app.get("/api/problems/:id", async (req, res) => {
  try {
    const { id } = req.params
    const result = await queryDatabase(
      `SELECT p.id, p.title, p.difficulty, p.category, p.tags, p.description, p.explanation, p.code, p.test_cases, p.created_at,
              u.name as author_name
       FROM problems p
       LEFT JOIN users u ON p.author_id = u.id
       WHERE p.id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Problem not found",
      })
    }

    res.json({
      success: true,
      problem: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch problem",
      details: error.message,
    })
  }
})

// Create new problem
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
      `INSERT INTO problems (title, difficulty, category, tags, description, explanation, code, test_cases, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, difficulty, category, tags, description, explanation, code, test_cases, created_at`,
      [title, difficulty, category, tags || [], description, explanation, code, test_cases, req.user.id],
    )

    res.status(201).json({
      success: true,
      message: "Problem created successfully",
      problem: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create problem",
      details: error.message,
    })
  }
})

// Update problem
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

    res.json({
      success: true,
      message: "Problem updated successfully",
      problem: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to update problem",
      details: error.message,
    })
  }
})

// Delete problem
app.delete("/api/problems/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

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

// ==================== NOTES CRUD ====================

// Get all notes
app.get("/api/notes", async (req, res) => {
  try {
    const { category, search } = req.query
    let query = `
      SELECT n.id, n.title, n.category, n.tags, n.description, n.content, n.created_at,
             u.name as author_name
      FROM notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE 1=1
    `
    const params = []

    if (category) {
      params.push(category)
      query += ` AND n.category = $${params.length}`
    }

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (n.title ILIKE $${params.length} OR n.description ILIKE $${params.length} OR n.content ILIKE $${params.length})`
    }

    query += ` ORDER BY n.created_at DESC`

    const result = await queryDatabase(query, params)

    res.json({
      success: true,
      count: result.rows.length,
      notes: result.rows,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch notes",
      details: error.message,
    })
  }
})

// Get single note
app.get("/api/notes/:id", async (req, res) => {
  try {
    const { id } = req.params
    const result = await queryDatabase(
      `SELECT n.id, n.title, n.category, n.tags, n.description, n.content, n.created_at,
              u.name as author_name
       FROM notes n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE n.id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Note not found",
      })
    }

    res.json({
      success: true,
      note: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch note",
      details: error.message,
    })
  }
})

// Create new note
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
      `INSERT INTO notes (title, category, tags, description, content, author_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, category, tags, description, content, created_at`,
      [title, category, tags || [], description, content, req.user.id],
    )

    res.status(201).json({
      success: true,
      message: "Note created successfully",
      note: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create note",
      details: error.message,
    })
  }
})

// Update note
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

    res.json({
      success: true,
      message: "Note updated successfully",
      note: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to update note",
      details: error.message,
    })
  }
})

// Delete note
app.delete("/api/notes/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

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

// ==================== INTERVIEWS CRUD ====================

// Get all interviews
app.get("/api/interviews", async (req, res) => {
  try {
    const { category, search } = req.query
    let query = `
      SELECT i.id, i.title, i.category, i.tags, i.description, i.content, i.created_at,
             u.name as author_name
      FROM interviews i
      LEFT JOIN users u ON i.author_id = u.id
      WHERE 1=1
    `
    const params = []

    if (category) {
      params.push(category)
      query += ` AND i.category = $${params.length}`
    }

    if (search) {
      params.push(`%${search}%`)
      query += ` AND (i.title ILIKE $${params.length} OR i.description ILIKE $${params.length} OR i.content ILIKE $${params.length})`
    }

    query += ` ORDER BY i.created_at DESC`

    const result = await queryDatabase(query, params)

    res.json({
      success: true,
      count: result.rows.length,
      interviews: result.rows,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch interviews",
      details: error.message,
    })
  }
})

// Get single interview
app.get("/api/interviews/:id", async (req, res) => {
  try {
    const { id } = req.params
    const result = await queryDatabase(
      `SELECT i.id, i.title, i.category, i.tags, i.description, i.content, i.created_at,
              u.name as author_name
       FROM interviews i
       LEFT JOIN users u ON i.author_id = u.id
       WHERE i.id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Interview not found",
      })
    }

    res.json({
      success: true,
      interview: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch interview",
      details: error.message,
    })
  }
})

// Create new interview
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
      `INSERT INTO interviews (title, category, tags, description, content, author_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, category, tags, description, content, created_at`,
      [title, category, tags || [], description, content, req.user.id],
    )

    res.status(201).json({
      success: true,
      message: "Interview created successfully",
      interview: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create interview",
      details: error.message,
    })
  }
})

// Update interview
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

    res.json({
      success: true,
      message: "Interview updated successfully",
      interview: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to update interview",
      details: error.message,
    })
  }
})

// Delete interview
app.delete("/api/interviews/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

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

// Login endpoint
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      })
    }

    // Hardcoded admin credentials for testing
    if (email === "admin@example.com" && password === "admin123") {
      res.json({
        success: true,
        message: "Login successful",
        user: {
          id: "550e8400-e29b-41d4-a716-446655440000", // Valid UUID format
          email: "admin@example.com",
          name: "Admin User",
          role: "admin",
        },
        token: "simple-admin-token-123",
      })
    } else {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      })
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Login failed",
      details: error.message,
    })
  }
})

// Get current user
app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user,
  })
})

// ==================== BOOKMARKS ENDPOINTS ====================

// Get user bookmarks - Updated to work with your schema
app.get("/api/bookmarks", authenticateToken, async (req, res) => {
  try {
    const { item_type } = req.query
    let query = `
      SELECT b.id, b.item_id, b.item_type, b.created_at,
             CASE 
               WHEN b.item_type = 'problem' THEN p.title
               WHEN b.item_type = 'note' THEN n.title
               WHEN b.item_type = 'interview' THEN i.title
             END as title
      FROM bookmarks b
      LEFT JOIN problems p ON b.item_id = p.id AND b.item_type = 'problem'
      LEFT JOIN notes n ON b.item_id = n.id AND b.item_type = 'note'
      LEFT JOIN interviews i ON b.item_id = i.id AND b.item_type = 'interview'
      WHERE b.user_id = $1
    `
    const params = [req.user.id]

    if (item_type) {
      params.push(item_type)
      query += ` AND b.item_type = $${params.length}`
    }

    query += ` ORDER BY b.created_at DESC`

    const result = await queryDatabase(query, params)

    res.json({
      success: true,
      count: result.rows.length,
      bookmarks: result.rows,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch bookmarks",
      details: error.message,
    })
  }
})

// Add bookmark - Updated to handle string IDs by finding the actual UUID
app.post("/api/bookmarks", authenticateToken, async (req, res) => {
  try {
    const { item_id, item_type } = req.body

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

    // Try to find the actual UUID for the item
    const actualItemId = await findItemUUID(item_id, item_type)

    if (!actualItemId) {
      return res.status(404).json({
        success: false,
        error: `${item_type} with identifier '${item_id}' not found`,
      })
    }

    const result = await queryDatabase(
      `INSERT INTO bookmarks (user_id, item_id, item_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_id, item_type) DO NOTHING
       RETURNING id, item_id, item_type, created_at`,
      [req.user.id, actualItemId, item_type],
    )

    if (result.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: "Bookmark already exists",
      })
    }

    res.status(201).json({
      success: true,
      message: "Bookmark added successfully",
      bookmark: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to add bookmark",
      details: error.message,
    })
  }
})

// Remove bookmark
app.delete("/api/bookmarks/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await queryDatabase(
      `DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING id, item_id, item_type`,
      [id, req.user.id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Bookmark not found",
      })
    }

    res.json({
      success: true,
      message: "Bookmark removed successfully",
      deleted: result.rows[0],
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to remove bookmark",
      details: error.message,
    })
  }
})

// Remove bookmark by item - Alternative endpoint for easier frontend integration
app.delete("/api/bookmarks/item/:item_id/:item_type", authenticateToken, async (req, res) => {
  try {
    const { item_id, item_type } = req.params

    // Try to find the actual UUID for the item
    const actualItemId = await findItemUUID(item_id, item_type)

    if (!actualItemId) {
      return res.status(404).json({
        success: false,
        error: `${item_type} with identifier '${item_id}' not found`,
      })
    }

    const result = await queryDatabase(
      `DELETE FROM bookmarks WHERE user_id = $1 AND item_id = $2 AND item_type = $3 RETURNING id, item_id, item_type`,
      [req.user.id, actualItemId, item_type],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Bookmark not found",
      })
    }

    res.json({
      success: true,
      message: "Bookmark removed successfully",
      deleted: result.rows[0],
    })
  } catch (error) {
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
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Admin access required",
      })
    }

    const [problemsCount, notesCount, interviewsCount, usersCount, bookmarksCount] = await Promise.all([
      queryDatabase("SELECT COUNT(*) as count FROM problems"),
      queryDatabase("SELECT COUNT(*) as count FROM notes"),
      queryDatabase("SELECT COUNT(*) as count FROM interviews"),
      queryDatabase("SELECT COUNT(*) as count FROM users"),
      queryDatabase("SELECT COUNT(*) as count FROM bookmarks"),
    ])

    res.json({
      success: true,
      stats: {
        problems: Number.parseInt(problemsCount.rows[0].count),
        notes: Number.parseInt(notesCount.rows[0].count),
        interviews: Number.parseInt(interviewsCount.rows[0].count),
        users: Number.parseInt(usersCount.rows[0].count),
        bookmarks: Number.parseInt(bookmarksCount.rows[0].count),
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
