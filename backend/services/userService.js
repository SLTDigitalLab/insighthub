const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
    const adminEmail = (process.env.ADMIN_EMAIL || 'shalikahathurusinghe3584@gmail.com').toLowerCase().trim();
    const existingAdmin = this.users.find(u => u.email.toLowerCase() === adminEmail || u.role === 'admin');
    
    if (!existingAdmin) {
      const adminUser = {
        id: 'admin-' + crypto.randomUUID(),
        name: 'System Administrator',
        email: adminEmail,
        department: 'Digital Labs / IT',
        designation: 'Enterprise Administrator',
        status: 'approved',
        role: 'admin',
        createdAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
        approvedBy: 'System',
        lastLoginAt: null
      };
      this.users.push(adminUser);
      this.saveUsers();
      console.log(`[UserService] Default Admin account initialized: ${adminEmail}`);
    }
  }

  getAllUsers() {
    return this.users.map(({ approvalToken, declineToken, ...safeUser }) => safeUser);
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

  /**
   * Admin pre-authorizes / invites an SLT email address
   */
  inviteUser({ email, name, department, designation, role, invitedBy = 'Administrator' }) {
    const cleanEmail = email.trim().toLowerCase();
    
    if (!cleanEmail.includes('@')) {
      throw new Error('Please provide a valid email address.');
    }

    let user = this.getUserByEmail(cleanEmail);

    if (user) {
      // Re-activate or update existing user
      user.name = name?.trim() || user.name || cleanEmail.split('@')[0];
      user.department = department?.trim() || user.department || 'SLT Enterprise';
      user.designation = designation?.trim() || user.designation || 'Sales Executive';
      user.role = role || user.role || 'user';
      user.status = 'approved';
      user.invitedAt = new Date().toISOString();
      user.invitedBy = invitedBy;
      user.approvedAt = new Date().toISOString();
      user.approvedBy = invitedBy;
      this.saveUsers();
      return { user, isNew: false };
    }

    const newUser = {
      id: 'usr-' + crypto.randomUUID(),
      name: name?.trim() || cleanEmail.split('@')[0],
      email: cleanEmail,
      department: department?.trim() || 'SLT Enterprise',
      designation: designation?.trim() || 'Sales Executive',
      status: 'approved',
      role: role || 'user',
      createdAt: new Date().toISOString(),
      invitedAt: new Date().toISOString(),
      invitedBy: invitedBy,
      approvedAt: new Date().toISOString(),
      approvedBy: invitedBy,
      lastLoginAt: null
    };

    this.users.push(newUser);
    this.saveUsers();
    return { user: newUser, isNew: true };
  }

  /**
   * User self-requests access after authenticating with Microsoft Entra ID
   */
  requestAccess({ name, email, department, designation, note }) {
    const cleanEmail = email.trim().toLowerCase();
    let user = this.getUserByEmail(cleanEmail);

    if (user && user.status === 'approved') {
      return { alreadyApproved: true, user };
    }

    const approvalToken = crypto.randomBytes(24).toString('hex');
    const declineToken = crypto.randomBytes(24).toString('hex');

    if (user) {
      // Update pending or re-request after decline
      user.name = name?.trim() || user.name || cleanEmail.split('@')[0];
      user.department = department?.trim() || user.department || 'SLT Enterprise';
      user.designation = designation?.trim() || user.designation || 'Staff';
      user.note = note?.trim() || '';
      user.status = 'pending_approval';
      user.approvalToken = approvalToken;
      user.declineToken = declineToken;
      user.requestedAt = new Date().toISOString();
      this.saveUsers();
      return { user, isNew: false };
    }

    const newUser = {
      id: 'usr-' + crypto.randomUUID(),
      name: name?.trim() || cleanEmail.split('@')[0],
      email: cleanEmail,
      department: department?.trim() || 'SLT Enterprise',
      designation: designation?.trim() || 'Staff',
      note: note?.trim() || '',
      status: 'pending_approval',
      role: 'user',
      approvalToken: approvalToken,
      declineToken: declineToken,
      createdAt: new Date().toISOString(),
      requestedAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
      lastLoginAt: null
    };

    this.users.push(newUser);
    this.saveUsers();
    return { user: newUser, isNew: true };
  }

  /**
   * Verify if a Microsoft authenticated user has approved access
   */
  verifyAccess(email) {
    if (!email) {
      return { approved: false, status: 'missing_email', message: 'No email provided.' };
    }

    const cleanEmail = email.trim().toLowerCase();
    const adminEmail = (process.env.ADMIN_EMAIL || 'shalikahathurusinghe3584@gmail.com').toLowerCase().trim();

    // Auto-approve Master Admin
    if (cleanEmail === adminEmail) {
      let admin = this.getUserByEmail(cleanEmail);
      if (!admin) {
        admin = {
          id: 'admin-' + crypto.randomUUID(),
          name: 'System Administrator',
          email: cleanEmail,
          status: 'approved',
          role: 'admin',
          createdAt: new Date().toISOString()
        };
        this.users.push(admin);
        this.saveUsers();
      }
      return { approved: true, status: 'approved', role: 'admin', user: admin };
    }

    const user = this.getUserByEmail(cleanEmail);

    if (!user) {
      return {
        approved: false,
        status: 'not_found',
        message: 'No pre-authorization found for this work account.'
      };
    }

    if (user.status === 'approved') {
      user.lastLoginAt = new Date().toISOString();
      this.saveUsers();
      return {
        approved: true,
        status: 'approved',
        role: user.role || 'user',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          designation: user.designation
        }
      };
    }

    if (user.status === 'pending_approval') {
      return {
        approved: false,
        status: 'pending_approval',
        message: 'Your access request is currently pending administrator verification.'
      };
    }

    if (user.status === 'declined') {
      return {
        approved: false,
        status: 'declined',
        message: 'Your access request was declined by the administrator.'
      };
    }

    return { approved: false, status: user.status, message: 'Access not approved.' };
  }

  approveUser(userOrId, approvedBy = 'Administrator') {
    const user = typeof userOrId === 'string' ? this.getUserById(userOrId) : userOrId;
    if (!user) throw new Error('User not found.');

    user.status = 'approved';
    user.approvedAt = new Date().toISOString();
    user.approvedBy = approvedBy;
    user.approvalToken = null;
    user.declineToken = null;

    this.saveUsers();
    return user;
  }

  declineUser(userOrId, reason = 'Registration declined by administrator', declinedBy = 'Administrator') {
    const user = typeof userOrId === 'string' ? this.getUserById(userOrId) : userOrId;
    if (!user) throw new Error('User not found.');

    user.status = 'declined';
    user.declineReason = reason;
    user.declinedAt = new Date().toISOString();
    user.declinedBy = declinedBy;
    user.approvalToken = null;
    user.declineToken = null;

    this.saveUsers();
    return user;
  }

  revokeAccess(userOrId, revokedBy = 'Administrator') {
    const user = typeof userOrId === 'string' ? this.getUserById(userOrId) : userOrId;
    if (!user) throw new Error('User not found.');

    user.status = 'declined';
    user.declineReason = 'Access revoked by administrator';
    user.revokedAt = new Date().toISOString();
    user.revokedBy = revokedBy;

    this.saveUsers();
    return user;
  }
}

module.exports = new UserService();
