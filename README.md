# DSA Backend Clean

A clean, simple backend for the DSA Problems App using Neon PostgreSQL.

## Setup

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Environment variables are already configured for your Neon database

3. Run locally:
\`\`\`bash
npm run dev
\`\`\`

4. Deploy to Vercel:
\`\`\`bash
vercel --prod
\`\`\`

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/test-db` - Test database connection
- `GET /api/check-tables` - Check what tables exist
- `GET /api/problems` - Get all problems
- `GET /api/notes` - Get all notes
- `GET /api/interviews` - Get all interviews
- `POST /api/auth/login` - Simple login (temporary)

## Testing Locally

\`\`\`bash
# Health check
curl http://localhost:3001/api/health

# Test database
curl http://localhost:3001/api/test-db

# Check tables
curl http://localhost:3001/api/check-tables

# Get problems
curl http://localhost:3001/api/problems

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
\`\`\`

## Next Steps

1. Test database connection
2. Create tables if they don't exist
3. Add proper JWT authentication
4. Add CRUD operations
5. Add user management
