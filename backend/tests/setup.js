import bcrypt from 'bcryptjs';

// Deterministic, secret-free test environment.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/cymor-test';
process.env.JWT_SECRET ||= 'test-jwt-secret-0123456789abcdef';
process.env.SESSION_ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.DASHBOARD_USERNAME ||= 'admin';
process.env.DASHBOARD_PASSWORD_HASH ||= bcrypt.hashSync('correct horse battery', 4);
process.env.OWNER_PHONE_NUMBER ||= '254700000001';
process.env.GEMINI_API_KEY ||= 'test-key';
