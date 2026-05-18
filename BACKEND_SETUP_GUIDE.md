re# Backend Setup Guide

Quick guide to get the PostgreSQL backend running.

## Prerequisites

- PostgreSQL installed and running
- Node.js installed
- Terminal/Command prompt

## Step 1: Install PostgreSQL

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### macOS
```bash
brew install postgresql
brew services start postgresql
```

### Windows
Download and install from: https://www.postgresql.org/download/windows/

## Step 2: Create Database

```bash
# Login to PostgreSQL
sudo -u postgres psql

# Or on Windows/macOS
psql -U postgres

# Create database and user
CREATE DATABASE e_learning_db;
CREATE USER eduaccess_user WITH PASSWORD 'postgresql';
GRANT ALL PRIVILEGES ON DATABASE e_learning_db TO eduaccess_user;

# Exit
\q
```

## Step 3: Install Backend Dependencies

```bash
cd backend
npm install
```

This will install:
- express - Web framework
- pg - PostgreSQL client
- bcryptjs - Password hashing
- jsonwebtoken - JWT authentication
- express-validator - Input validation
- cors - Cross-origin resource sharing
- dotenv - Environment variables

## Step 4: Configure Environment

The `.env` file is already configured with default values:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=e_learning_db
DB_USER=eduaccess_user
DB_PASSWORD=postgresql
PORT=5000
JWT_SECRET=your_jwt_secret_key_change_in_production
JWT_EXPIRES_IN=7d
```

If you used different credentials, update the `.env` file.

## Step 5: Initialize Database

```bash
npm run setup-db
```

This will:
- Create all database tables
- Set up indexes
- Create default admin user

Default admin credentials:
- Email: `admin@eduaccess.com`
- Password: `admin123`

## Step 6: Start the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

You should see:
```
Connected to PostgreSQL database
Server running on port 5000
```

## Step 7: Test the API

Open a new terminal and test the health check:

```bash
curl http://localhost:5000
```

Expected response:
```json
{
  "message": "E-learning API is running",
  "version": "1.0.0"
}
```

Test admin login:
```bash
curl -X POST http://localhost:5000/api/auth/login/admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@eduaccess.com","password":"admin123"}'
```

## Troubleshooting

### Database Connection Error

If you see "Connection refused":
1. Check PostgreSQL is running: `sudo systemctl status postgresql`
2. Verify credentials in `.env` match your PostgreSQL setup
3. Check PostgreSQL is listening on port 5432

### Permission Denied

If you see permission errors:
```bash
# Grant privileges again
sudo -u postgres psql
GRANT ALL PRIVILEGES ON DATABASE e_learning_db TO eduaccess_user;
\c e_learning_db
GRANT ALL ON ALL TABLES IN SCHEMA public TO eduaccess_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO eduaccess_user;
```

### Port Already in Use

If port 5000 is busy:
1. Change PORT in `.env` to another port (e.g., 5001)
2. Restart the server

### Module Not Found

If you see module errors:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

1. Review API documentation: `backend/README.md`
2. Test endpoints: `backend/API_TESTING.md`
3. Connect frontend to backend
4. Update frontend API calls to use `http://localhost:5000/api`

## API Endpoints Overview

All endpoints are prefixed with `/api`:

- `/api/auth/*` - Authentication (signup, login)
- `/api/users/*` - User management
- `/api/approvals/*` - Student approvals
- `/api/courses/*` - Course management
- `/api/lessons/*` - Lesson management
- `/api/enrollments/*` - Course enrollments
- `/api/progress/*` - Progress tracking
- `/api/quizzes/*` - Quiz system
- `/api/feedback/*` - Feedback system
- `/api/audit/*` - Audit logs

## Security Notes

For production deployment:
1. Change JWT_SECRET to a strong random string
2. Use environment variables for all sensitive data
3. Enable HTTPS
4. Set up proper CORS origins
5. Use strong database passwords
6. Enable PostgreSQL SSL connections
7. Set up database backups
8. Use a process manager (PM2)
9. Set up monitoring and logging

## Database Management

View data:
```bash
psql -U eduaccess_user -d e_learning_db

# List tables
\dt

# View users
SELECT * FROM users;

# View courses
SELECT * FROM courses;
```

Reset database:
```bash
npm run setup-db
```

This will drop and recreate all tables.