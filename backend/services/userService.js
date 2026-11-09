const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SLT_SECTIONS = [
  'Enterprise Large',
  'Enterprise Medium',
  'Government',
  'Carrier business',
  'REBM'
];

const MOBITEL_SECTIONS = [
  'Mobitel SME',
  'Mobitel LB',
  'Mobitel MB'
];

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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
        const defaultTemplate = path.join(__dirname, '..', 'data', 'users.default.json');
        if (fs.existsSync(defaultTemplate)) {
          try {
            this.users = JSON.parse(fs.readFileSync(defaultTemplate, 'utf8'));
          } catch (e) {
            this.users = [];
          }
        } else {
          this.users = [];
        }
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
    const adminEmails = [
      (process.env.ADMIN_EMAIL || 'lahirus@slt.com.lk').toLowerCase().trim(),
      'dineshpi@slt.com.lk',
      '020601@intranet.slt.com.lk'
    ];

    adminEmails.forEach(email => {
      const existing = this.users.find(u => u.email.toLowerCase() === email);
      if (!existing) {
        const adminUser = {
          id: 'admin-' + crypto.randomUUID(),
          name: email.includes('020601') ? 'Dinesh Shameera (Admin)' : 'System Administrator',
          email: email,
          department: 'Digital Labs / Enterprise IT',
          designation: 'Enterprise Administrator',
          status: 'approved',
          role: 'admin',
          createdAt: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
          approvedBy: 'System',
          lastLoginAt: null
        };
        this.users.push(adminUser);
        console.log(`[UserService] Admin account initialized: ${email}`);
      } else {
        existing.status = 'approved';
        existing.role = 'admin';
      }
    });

    this.saveUsers();
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
    return this.users.find(u => u.approvalToken === token || u.lastApprovalToken === token);
  }

  getUserByDeclineToken(token) {
    if (!token) return null;
    return this.users.find(u => u.declineToken === token || u.lastDeclineToken === token);
  }

  /**
   * Helper to format section, sub-section, and designation
   */
  formatUserHierarchy({ company, section, subSection, designation, userType, rebmArea }) {
    const validSections = [...SLT_SECTIONS, ...MOBITEL_SECTIONS];
    const isMobitel = company === 'Mobitel' || (section && MOBITEL_SECTIONS.includes(section));
    const resolvedSection = validSections.includes(section)
      ? section
      : (isMobitel ? 'Mobitel SME' : 'Enterprise Large');

    let resolvedSubSection = '';
    if (!isMobitel && resolvedSection === 'REBM') {
      resolvedSubSection = subSection || rebmArea || 'WPC1';
    }

    const resolvedDesignation = (designation && designation.toLowerCase().includes('section'))
      ? 'Section Manager'
      : (designation || 'Account Manager');

    let compositeUserType = '';
    let department = '';

    if (!isMobitel && resolvedSection === 'REBM') {
      compositeUserType = `REBM - ${resolvedSubSection} (${resolvedDesignation})`;
      department = `REBM - ${resolvedSubSection}`;
    } else {
      compositeUserType = `${resolvedSection} (${resolvedDesignation})`;
      department = resolvedSection;
    }

    return {
      company: isMobitel ? 'Mobitel' : 'SLT',
      section: resolvedSection,
      subSection: resolvedSubSection,
      designation: resolvedDesignation,
      userType: compositeUserType,
      department: department
    };
  }

  /**
   * Admin pre-authorizes / invites an SLT email address
   */
  inviteUser({
    email,
    name,
    company,
    section,
    subSection,
    designation,
    userType,
    rebmArea,
    serviceNumber = '',
    mobileNumber = '',
    role = 'user',
    invitedBy = 'Administrator'
  }) {
    const cleanEmail = email.trim().toLowerCase();
    
    if (!cleanEmail.includes('@')) {
      throw new Error('Please provide a valid email address.');
    }

    const detectedCompany = company || (cleanEmail.includes('@mobitel.lk') ? 'Mobitel' : 'SLT');

    const hierarchy = this.formatUserHierarchy({
      company: detectedCompany,
      section: section || (userType && userType.includes('REBM') ? 'REBM' : (detectedCompany === 'Mobitel' ? 'Mobitel SME' : 'Enterprise Large')),
      subSection: subSection || rebmArea,
      designation: designation || (userType && userType.includes('Section') ? 'Section Manager' : 'Account Manager'),
      userType,
      rebmArea
    });

    let user = this.getUserByEmail(cleanEmail);

    if (user) {
      // Re-activate or update existing user
      user.name = name?.trim() || user.name || cleanEmail.split('@')[0];
      user.company = hierarchy.company;
      user.section = hierarchy.section;
      user.subSection = hierarchy.subSection;
      user.designation = hierarchy.designation;
      user.userType = hierarchy.userType;
      user.department = hierarchy.department;
      user.rebmArea = hierarchy.subSection;
      user.serviceNumber = serviceNumber?.trim() || user.serviceNumber || '';
      user.mobileNumber = mobileNumber?.trim() || user.mobileNumber || '';
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
      company: hierarchy.company,
      section: hierarchy.section,
      subSection: hierarchy.subSection,
      designation: hierarchy.designation,
      userType: hierarchy.userType,
      department: hierarchy.department,
      rebmArea: hierarchy.subSection,
      serviceNumber: serviceNumber?.trim() || '',
      mobileNumber: mobileNumber?.trim() || '',
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
  requestAccess({
    name,
    email,
    company,
    section,
    subSection,
    designation,
    userType,
    rebmArea,
    serviceNumber = '',
    mobileNumber = '',
    note = ''
  }) {
    const cleanEmail = email.trim().toLowerCase();
    let user = this.getUserByEmail(cleanEmail);

    if (user && user.status === 'approved') {
      return { alreadyApproved: true, user };
    }

    const detectedCompany = company || (cleanEmail.includes('@mobitel.lk') ? 'Mobitel' : 'SLT');

    const hierarchy = this.formatUserHierarchy({
      company: detectedCompany,
      section: section || (userType && userType.includes('REBM') ? 'REBM' : (detectedCompany === 'Mobitel' ? 'Mobitel SME' : 'Enterprise Large')),
      subSection: subSection || rebmArea,
      designation: designation || (userType && userType.includes('Section') ? 'Section Manager' : 'Account Manager'),
      userType,
      rebmArea
    });

    const approvalToken = crypto.randomBytes(24).toString('hex');
    const declineToken = crypto.randomBytes(24).toString('hex');

    if (user) {
      // Update pending or re-request after decline
      user.name = name?.trim() || user.name || cleanEmail.split('@')[0];
      user.company = hierarchy.company;
      user.section = hierarchy.section;
      user.subSection = hierarchy.subSection;
      user.designation = hierarchy.designation;
      user.userType = hierarchy.userType;
      user.department = hierarchy.department;
      user.rebmArea = hierarchy.subSection;
      user.serviceNumber = serviceNumber?.trim() || user.serviceNumber || '';
      user.mobileNumber = mobileNumber?.trim() || user.mobileNumber || '';
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
      company: hierarchy.company,
      section: hierarchy.section,
      subSection: hierarchy.subSection,
      designation: hierarchy.designation,
      userType: hierarchy.userType,
      department: hierarchy.department,
      rebmArea: hierarchy.subSection,
      serviceNumber: serviceNumber?.trim() || '',
      mobileNumber: mobileNumber?.trim() || '',
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
    const adminEmails = [
      (process.env.ADMIN_EMAIL || 'lahirus@slt.com.lk').toLowerCase().trim(),
      'dineshpi@slt.com.lk',
      '020601@intranet.slt.com.lk'
    ];

    // Auto-approve Master Admins
    if (adminEmails.includes(cleanEmail) || cleanEmail.includes('dinesh')) {
      let admin = this.getUserByEmail(cleanEmail);
      if (!admin) {
        admin = {
          id: 'admin-' + crypto.randomUUID(),
          name: cleanEmail.includes('dinesh') || cleanEmail.includes('020601') ? 'Dinesh Shameera' : 'System Administrator',
          email: cleanEmail,
          status: 'approved',
          role: 'admin',
          createdAt: new Date().toISOString()
        };
        this.users.push(admin);
        this.saveUsers();
      } else {
        admin.status = 'approved';
        admin.role = 'admin';
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
          userType: user.userType,
          rebmArea: user.rebmArea,
          serviceNumber: user.serviceNumber,
          mobileNumber: user.mobileNumber,
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
    if (user.approvalToken) user.lastApprovalToken = user.approvalToken;
    if (user.declineToken) user.lastDeclineToken = user.declineToken;
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
    if (user.approvalToken) user.lastApprovalToken = user.approvalToken;
    if (user.declineToken) user.lastDeclineToken = user.declineToken;
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

  deleteUser(userOrId) {
    const user = typeof userOrId === 'string'
      ? (this.getUserById(userOrId) || this.getUserByEmail(userOrId))
      : userOrId;
    if (!user) return false;

    this.users = this.users.filter(u => u.id !== user.id && u.email !== user.email);
    this.saveUsers();
    return true;
  }

  generateLoginOtp(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.getUserByEmail(cleanEmail);
    if (!user) {
      return { success: false, error: 'No account found with this work email. Please request access first.' };
    }
    if (user.status !== 'approved' && user.role !== 'admin') {
      return {
        success: false,
        status: user.status,
        error: user.status === 'pending_approval'
          ? 'Your access request is currently pending administrator verification.'
          : 'Your access has been declined. Please contact your department administrator.'
      };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins
    user.loginOtp = { code: otp, expiresAt };
    this.saveUsers();

    return { success: true, user, otp };
  }

  verifyLoginOtp(email, otp) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otp || '').trim();
    const user = this.getUserByEmail(cleanEmail);

    if (!user) {
      return { success: false, error: 'User not found.' };
    }
    if (user.status !== 'approved' && user.role !== 'admin') {
      return { success: false, error: 'User account is not approved.' };
    }
    if (!user.loginOtp || !user.loginOtp.code) {
      return { success: false, error: 'No active verification code found. Please request a new code.' };
    }
    if (Date.now() > user.loginOtp.expiresAt) {
      user.loginOtp = null;
      this.saveUsers();
      return { success: false, error: 'Verification code has expired. Please request a new one.' };
    }
    if (user.loginOtp.code !== cleanOtp) {
      return { success: false, error: 'Incorrect verification code. Please check your email and try again.' };
    }

    user.loginOtp = null;
    user.lastLoginAt = new Date().toISOString();
    this.saveUsers();

    return {
      success: true,
      approved: true,
      role: user.role || 'user',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company || (user.email.endsWith('@mobitel.lk') ? 'Mobitel' : 'SLT'),
        section: user.section || user.department,
        designation: user.designation,
        serviceNumber: user.serviceNumber,
        mobileNumber: user.mobileNumber
      }
    };
  }

  generateLoginToken(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.getUserByEmail(cleanEmail);
    if (!user) return null;

    const token = crypto.randomBytes(24).toString('hex');
    user.magicLoginToken = {
      token,
      expiresAt: Date.now() + 48 * 60 * 60 * 1000 // 48 hours
    };
    this.saveUsers();
    return token;
  }

  verifyLoginToken(token) {
    if (!token) return { success: false, error: 'Missing token.' };
    const cleanToken = token.trim();
    const user = this.users.find(u => u.magicLoginToken?.token === cleanToken);

    if (!user) {
      return { success: false, error: 'Invalid or expired login link.' };
    }
    if (Date.now() > (user.magicLoginToken?.expiresAt || 0)) {
      user.magicLoginToken = null;
      this.saveUsers();
      return { success: false, error: 'Login link has expired. Please request a new verification code.' };
    }

    user.lastLoginAt = new Date().toISOString();
    this.saveUsers();

    return {
      success: true,
      approved: true,
      role: user.role || 'user',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company: user.company || (user.email.endsWith('@mobitel.lk') ? 'Mobitel' : 'SLT'),
        section: user.section || user.department,
        designation: user.designation,
        serviceNumber: user.serviceNumber,
        mobileNumber: user.mobileNumber
      }
    };
  }
}

module.exports = new UserService();
