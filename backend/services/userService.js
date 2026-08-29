const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const KYC_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'kyc');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(KYC_UPLOADS_DIR)) {
  fs.mkdirSync(KYC_UPLOADS_DIR, { recursive: true });
}

// Password hashing utility using crypto PBKDF2
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return checkHash === hash;
}

class UserService {
  constructor() {
    this.users = [];
    this.loadUsers();
    this.initDefaultAdmin();
  }

  loadUsers() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        this.users = JSON.parse(raw);
      } else {
        this.users = [];
        this.saveUsers();
      }
    } catch (err) {
      console.error('[UserService] Error loading users.json:', err.message);
      this.users = [];
    }
  }

  saveUsers() {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2), 'utf8');
    } catch (err) {
      console.error('[UserService] Error saving users.json:', err.message);
    }
  }

  initDefaultAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || 'shalikahathurusinghe3584@gmail.com';
    const existingAdmin = this.users.find(u => u.email.toLowerCase() === adminEmail.toLowerCase() || u.role === 'admin');
    
    if (!existingAdmin) {
      const { salt, hash } = hashPassword('Admin@Mobitel2026!');
      const adminUser = {
        id: 'admin-' + crypto.randomUUID(),
        name: 'System Administrator',
        email: adminEmail,
        nicNumber: '199000000000',
        regNumber: 'ADMIN-001',
        nicPhotoUrl: '',
        facePhotoUrl: '',
        status: 'approved',
        role: 'admin',
        salt,
        passwordHash: hash,
        passwordSet: true,
        createdAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
        approvedBy: 'System'
      };
      this.users.push(adminUser);
      this.saveUsers();
      console.log(`[UserService] Default Admin account initialized: ${adminEmail}`);
    }
  }

  getAllUsers() {
    return this.users.map(({ salt, passwordHash, ...safeUser }) => safeUser);
  }

  getUserById(id) {
    return this.users.find(u => u.id === id);
  }

  getUserByEmail(email) {
    if (!email) return null;
    return this.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  getUserByApprovalToken(token) {
    if (!token) return null;
    return this.users.find(u => u.approvalToken === token);
  }

  getUserByDeclineToken(token) {
    if (!token) return null;
    return this.users.find(u => u.declineToken === token);
  }

  getUserBySetPasswordToken(token) {
    if (!token) return null;
    return this.users.find(u => u.setPasswordToken === token && u.status === 'approved');
  }

  registerUser({ name, email, nicNumber, regNumber, nicPhotoUrl, facePhotoUrl }) {
    const cleanEmail = email.trim().toLowerCase();
    const existing = this.getUserByEmail(cleanEmail);

    if (existing) {
      if (existing.status === 'approved') {
        throw new Error('An approved account already exists with this email address. Please sign in.');
      } else if (existing.status === 'pending_approval') {
        throw new Error('A registration request with this email is already pending admin approval.');
      } else {
        // If previously declined, allow re-registration by replacing tokens
        existing.name = name.trim();
        existing.nicNumber = nicNumber.trim();
        existing.regNumber = regNumber.trim();
        existing.nicPhotoUrl = nicPhotoUrl || existing.nicPhotoUrl;
        existing.facePhotoUrl = facePhotoUrl || existing.facePhotoUrl;
        existing.status = 'pending_approval';
        existing.approvalToken = crypto.randomBytes(24).toString('hex');
        existing.declineToken = crypto.randomBytes(24).toString('hex');
        existing.setPasswordToken = null;
        existing.createdAt = new Date().toISOString();
        this.saveUsers();
        return existing;
      }
    }

    const newUser = {
      id: 'usr-' + crypto.randomUUID(),
      name: name.trim(),
      email: cleanEmail,
      nicNumber: nicNumber.trim(),
      regNumber: regNumber.trim(),
      nicPhotoUrl: nicPhotoUrl || '',
      facePhotoUrl: facePhotoUrl || '',
      status: 'pending_approval',
      role: 'user',
      approvalToken: crypto.randomBytes(24).toString('hex'),
      declineToken: crypto.randomBytes(24).toString('hex'),
      setPasswordToken: null,
      salt: null,
      passwordHash: null,
      passwordSet: false,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null
    };

    this.users.push(newUser);
    this.saveUsers();
    return newUser;
  }

  approveUser(userOrId, approvedBy = 'Admin') {
    const user = typeof userOrId === 'string' ? this.getUserById(userOrId) : userOrId;
    if (!user) throw new Error('User not found.');

    user.status = 'approved';
    user.approvedAt = new Date().toISOString();
    user.approvedBy = approvedBy;
    user.approvalToken = null;
    user.declineToken = null;
    user.setPasswordToken = crypto.randomBytes(32).toString('hex');

    this.saveUsers();
    return user;
  }

  declineUser(userOrId, reason = 'Registration declined by administrator') {
    const user = typeof userOrId === 'string' ? this.getUserById(userOrId) : userOrId;
    if (!user) throw new Error('User not found.');

    user.status = 'declined';
    user.declineReason = reason;
    user.declinedAt = new Date().toISOString();
    user.approvalToken = null;
    user.declineToken = null;
    user.setPasswordToken = null;

    this.saveUsers();
    return user;
  }

  setUserPassword(token, newPassword) {
    const user = this.getUserBySetPasswordToken(token);
    if (!user) {
      throw new Error('Invalid or expired password reset token.');
    }

    if (!newPassword || newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.passwordHash = hash;
    user.passwordSet = true;
    user.setPasswordToken = null; // Invalidate token once used
    user.lastPasswordUpdate = new Date().toISOString();

    this.saveUsers();
    return user;
  }

  authenticate(email, password) {
    const user = this.getUserByEmail(email);
    if (!user) {
      return { success: false, error: 'No account found with this email address.' };
    }

    if (user.status === 'pending_approval') {
      return {
        success: false,
        error: 'Your registration is currently pending administrator verification. Please check your email for updates.'
      };
    }

    if (user.status === 'declined') {
      return {
        success: false,
        error: 'Your registration request was declined. Please contact the administrator for assistance.'
      };
    }

    if (!user.passwordSet || !user.passwordHash) {
      return {
        success: false,
        error: 'Your password has not been set yet. Please use the activation link sent to your email.'
      };
    }

    const isValid = verifyPassword(password, user.salt, user.passwordHash);
    if (!isValid) {
      return { success: false, error: 'Invalid password. Please try again.' };
    }

    const { salt, passwordHash, ...safeUser } = user;
    return { success: true, user: safeUser };
  }
}

module.exports = new UserService();
