import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import db from "../config/db.js";

const router = Router();
const googleClient = new OAuth2Client();
const HOST_GENDERS = ["M", "F", "Other"];
const HOST_SIZES = ["XS", "S", "M", "L", "XL"];
const GOOGLE_PROFILE_STORAGE_TTL_MS = 10 * 60 * 1000;

const ACCOUNT_CONFIG = {
  user: {
    roleLabel: "host",
    table: "USERS",
    idField: "userId",
    linkField: "userId",
    selectFields:
      "userId, fName, lName, email, phoneNb, age, gender, address, clothingSize, profilePic, description, eligibility, isActive, codeOfConductAccepted, createdAt, updatedAt",
    requiredFields: ["fName", "lName", "email", "phoneNb", "age", "gender", "address", "clothingSize"],
  },
  client: {
    roleLabel: "client",
    table: "CLIENTS",
    idField: "clientId",
    linkField: "clientId",
    selectFields: "clientId, fName, lName, email, phoneNb, age, gender, address, profilePic",
    requiredFields: ["fName", "lName", "email", "phoneNb", "age", "gender", "address"],
  },
};

let googleAuthTableReady = false;

const normalizeGoogleRole = (role) => {
  if (role === "host" || role === "user") return "user";
  if (role === "client") return "client";
  return null;
};

const signAuthToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

const getGoogleClientIds = () =>
  (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === "";

const getMissingRequiredFields = (role, profile = {}) => {
  const config = ACCOUNT_CONFIG[role];
  if (!config) return [];
  return config.requiredFields.filter((field) => isBlank(profile[field]));
};

const omitPassword = (account = {}) => {
  const { password, ...safeAccount } = account;
  return safeAccount;
};

const splitGoogleName = (payload = {}) => {
  const fullName = String(payload.name || "").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  let fName = String(payload.given_name || "").trim();
  let lName = String(payload.family_name || "").trim();

  if (!fName && parts.length) {
    fName = parts[0];
  }
  if (!lName && parts.length > 1) {
    lName = parts.slice(1).join(" ");
  }

  return { fullName, fName, lName };
};

const verifyGoogleCredential = async (credential) => {
  if (!credential) {
    const error = new Error("Missing Google credential.");
    error.status = 400;
    throw error;
  }

  const clientIds = getGoogleClientIds();
  if (!clientIds.length) {
    const error = new Error(
      "Google login is not configured. Set GOOGLE_CLIENT_ID in backend/.env and restart the backend server."
    );
    error.status = 500;
    throw error;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientIds.length === 1 ? clientIds[0] : clientIds,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload?.email) {
      const error = new Error("Google did not return the required account information.");
      error.status = 401;
      throw error;
    }

    if (payload.email_verified !== true && payload.email_verified !== "true") {
      const error = new Error("Google email must be verified.");
      error.status = 401;
      throw error;
    }

    const { fullName, fName, lName } = splitGoogleName(payload);
    return {
      googleSub: payload.sub,
      fullName,
      fName,
      lName,
      email: String(payload.email).trim().toLowerCase(),
      profilePic: payload.picture || null,
    };
  } catch (err) {
    if (err.status) throw err;
    console.warn("Google ID token verification failed:", err.message);
    const error = new Error(
      "Failed Google login. Please verify that the frontend and backend Google client IDs match."
    );
    error.status = 401;
    throw error;
  }
};

const ensureGoogleAuthTable = async () => {
  if (googleAuthTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS GOOGLE_AUTH (
      googleAuthId INT UNSIGNED NOT NULL AUTO_INCREMENT,
      googleSub VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL,
      userId INT UNSIGNED NULL,
      clientId INT UNSIGNED NULL,
      email VARCHAR(100) NOT NULL,
      googleName VARCHAR(255) NULL,
      googlePicture LONGTEXT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (googleAuthId),
      UNIQUE KEY uq_google_auth_sub_role (googleSub, role),
      UNIQUE KEY uq_google_auth_email_role (email, role),
      INDEX idx_google_auth_user (userId),
      INDEX idx_google_auth_client (clientId)
    )
  `);
  googleAuthTableReady = true;
};

const fetchGoogleAuthMapping = async (googleSub, role) => {
  await ensureGoogleAuthTable();
  const [rows] = await db.query(
    "SELECT * FROM GOOGLE_AUTH WHERE googleSub = ? AND role = ?",
    [googleSub, role]
  );
  return rows[0];
};

const saveGoogleAuthMapping = async (role, accountId, googleProfile) => {
  await ensureGoogleAuthTable();
  const userId = role === "user" ? accountId : null;
  const clientId = role === "client" ? accountId : null;

  await db.query(
    `INSERT INTO GOOGLE_AUTH
      (googleSub, role, userId, clientId, email, googleName, googlePicture)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      googleSub = VALUES(googleSub),
      userId = VALUES(userId),
      clientId = VALUES(clientId),
      email = VALUES(email),
      googleName = VALUES(googleName),
      googlePicture = VALUES(googlePicture),
      updatedAt = NOW()`,
    [
      googleProfile.googleSub,
      role,
      userId,
      clientId,
      googleProfile.email,
      googleProfile.fullName || null,
      googleProfile.profilePic || null,
    ]
  );
};

const fetchAccountById = async (role, accountId) => {
  const config = ACCOUNT_CONFIG[role];
  const [rows] = await db.query(
    `SELECT ${config.selectFields} FROM ${config.table} WHERE ${config.idField} = ?`,
    [accountId]
  );
  return rows[0];
};

const fetchAccountByEmail = async (role, email) => {
  const config = ACCOUNT_CONFIG[role];
  const [rows] = await db.query(
    `SELECT ${config.selectFields} FROM ${config.table} WHERE email = ?`,
    [email]
  );
  return rows[0];
};

const syncGoogleProfilePicture = async (role, account, googleProfile) => {
  if (!account || account.profilePic || !googleProfile.profilePic) return account;

  const config = ACCOUNT_CONFIG[role];
  await db.query(
    `UPDATE ${config.table} SET profilePic = ? WHERE ${config.idField} = ?`,
    [googleProfile.profilePic, account[config.idField]]
  );
  return { ...account, profilePic: googleProfile.profilePic };
};

const buildAuthResponse = (role, account) => {
  const config = ACCOUNT_CONFIG[role];
  const safeAccount = { ...omitPassword(account), role };
  return {
    token: signAuthToken(account[config.idField], role),
    user: safeAccount,
    role,
    userRole: config.roleLabel,
  };
};

const buildRequiresProfileResponse = (role, googleProfile, account = {}) => {
  const draft = {
    ...account,
    fName: account.fName || googleProfile.fName,
    lName: account.lName || googleProfile.lName,
    email: account.email || googleProfile.email,
    profilePic: account.profilePic || googleProfile.profilePic,
  };

  return {
    requiresProfile: true,
    message: "Please complete the missing required profile information.",
    role,
    userRole: ACCOUNT_CONFIG[role].roleLabel,
    missingFields: getMissingRequiredFields(role, draft),
    expiresAt: Date.now() + GOOGLE_PROFILE_STORAGE_TTL_MS,
    googleProfile: {
      fName: draft.fName || "",
      lName: draft.lName || "",
      fullName: googleProfile.fullName || "",
      email: googleProfile.email,
      profilePic: draft.profilePic || null,
    },
  };
};

const sendGoogleError = (res, err, fallbackMessage) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(fallbackMessage, err);
  }
  res.status(status).json({ message: err.message || fallbackMessage });
};

const validateHostSignup = (body = {}, { requirePassword = true } = {}) => {
  const errors = [];
  const requiredFields = [
    { key: "fName", label: "First name" },
    { key: "lName", label: "Last name" },
    { key: "email", label: "Email" },
    { key: "phoneNb", label: "Phone number" },
    { key: "age", label: "Age" },
    { key: "gender", label: "Gender" },
    { key: "address", label: "Address" },
    { key: "clothingSize", label: "Clothing size" },
  ];

  if (requirePassword) {
    requiredFields.splice(3, 0, { key: "password", label: "Password" });
  }

  requiredFields.forEach(({ key, label }) => {
    if (body[key] === undefined || body[key] === null || String(body[key]).trim() === "") {
      errors.push(`${label} is required.`);
    }
  });

  if ((requirePassword || body.password) && body.password && String(body.password).length < 6) {
    errors.push("Password must be at least 6 characters.");
  }

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) {
    errors.push("Valid email is required.");
  }

  if (body.age !== undefined) {
    const ageValue = Number(body.age);
    if (Number.isNaN(ageValue) || ageValue < 18 || ageValue > 100) {
      errors.push("Age must be between 18 and 100.");
    }
  }

  if (body.gender && !HOST_GENDERS.includes(String(body.gender).trim())) {
    errors.push("Gender must be M, F, or Other.");
  }

  if (body.clothingSize && !HOST_SIZES.includes(String(body.clothingSize).trim())) {
    errors.push("Clothing size must be one of XS, S, M, L, XL.");
  }

  return errors;
};

const validateClientSignup = (body = {}, { requirePassword = true } = {}) => {
  const errors = [];
  const requiredFields = [
    { key: "fName", label: "First name" },
    { key: "lName", label: "Last name" },
    { key: "email", label: "Email" },
    { key: "phoneNb", label: "Phone number" },
    { key: "age", label: "Age" },
    { key: "gender", label: "Gender" },
    { key: "address", label: "Address" },
  ];

  if (requirePassword) {
    requiredFields.splice(3, 0, { key: "password", label: "Password" });
  }

  requiredFields.forEach(({ key, label }) => {
    if (body[key] === undefined || body[key] === null || String(body[key]).trim() === "") {
      errors.push(`${label} is required.`);
    }
  });

  if ((requirePassword || body.password) && body.password && String(body.password).length < 6) {
    errors.push("Password must be at least 6 characters.");
  }

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) {
    errors.push("Valid email is required.");
  }

  if (body.age !== undefined) {
    const ageValue = Number(body.age);
    if (Number.isNaN(ageValue) || ageValue < 18 || ageValue > 80) {
      errors.push("Age must be between 18 and 80.");
    }
  }

  if (body.gender && !HOST_GENDERS.includes(String(body.gender).trim())) {
    errors.push("Gender must be M, F, or Other.");
  }

  return errors;
};

router.post("/google", async (req, res) => {
  const role = normalizeGoogleRole(req.body.role);
  if (!role) {
    return res.status(400).json({ message: "Missing role. Please choose Host or Client." });
  }

  try {
    const googleProfile = await verifyGoogleCredential(req.body.credential);
    let account = null;

    const mapping = await fetchGoogleAuthMapping(googleProfile.googleSub, role);
    const mappedAccountId = mapping?.[ACCOUNT_CONFIG[role].linkField];
    if (mappedAccountId) {
      account = await fetchAccountById(role, mappedAccountId);
    }

    if (!account) {
      account = await fetchAccountByEmail(role, googleProfile.email);
    }

    if (account) {
      account = await syncGoogleProfilePicture(role, account, googleProfile);
      await saveGoogleAuthMapping(role, account[ACCOUNT_CONFIG[role].idField], googleProfile);

      const missingFields = getMissingRequiredFields(role, account);
      if (missingFields.length) {
        return res.json(buildRequiresProfileResponse(role, googleProfile, account));
      }

      return res.json(buildAuthResponse(role, account));
    }

    return res.json(buildRequiresProfileResponse(role, googleProfile));
  } catch (err) {
    sendGoogleError(res, err, "Failed to process Google login.");
  }
});

router.post("/google/complete", async (req, res) => {
  const role = normalizeGoogleRole(req.body.role);
  if (!role) {
    return res.status(400).json({ message: "Missing role. Please choose Host or Client." });
  }

  try {
    const googleProfile = await verifyGoogleCredential(req.body.credential);
    const profile = req.body.profile || {};
    const config = ACCOUNT_CONFIG[role];

    let account = null;
    const mapping = await fetchGoogleAuthMapping(googleProfile.googleSub, role);
    const mappedAccountId = mapping?.[config.linkField];
    if (mappedAccountId) {
      account = await fetchAccountById(role, mappedAccountId);
    }
    if (!account) {
      account = await fetchAccountByEmail(role, googleProfile.email);
    }

    const payload = {
      fName: profile.fName ?? account?.fName ?? googleProfile.fName,
      lName: profile.lName ?? account?.lName ?? googleProfile.lName,
      email: account?.email ?? googleProfile.email,
      phoneNb: profile.phoneNb ?? account?.phoneNb,
      age: profile.age ?? account?.age,
      gender: profile.gender ?? account?.gender,
      address: profile.address ?? account?.address,
      clothingSize: profile.clothingSize ?? account?.clothingSize,
      profilePic: account?.profilePic || googleProfile.profilePic || null,
      description: account?.description ?? profile.description ?? "",
    };

    const validationErrors =
      role === "user"
        ? validateHostSignup(payload, { requirePassword: false })
        : validateClientSignup(payload, { requirePassword: false });

    if (validationErrors.length) {
      return res.status(400).json({
        message: "Missing required information.",
        errors: validationErrors,
        missingFields: getMissingRequiredFields(role, payload),
      });
    }

    let accountId = account?.[config.idField];

    if (accountId) {
      if (role === "user") {
        await db.query(
          `UPDATE USERS
              SET fName = ?, lName = ?, email = ?, phoneNb = ?, age = ?, gender = ?,
                  address = ?, clothingSize = ?, profilePic = ?, description = ?
            WHERE userId = ?`,
          [
            payload.fName.trim(),
            payload.lName.trim(),
            payload.email.trim(),
            payload.phoneNb.trim(),
            Number(payload.age),
            payload.gender.trim(),
            payload.address.trim(),
            payload.clothingSize.trim(),
            payload.profilePic?.trim() || null,
            payload.description?.trim() || "",
            accountId,
          ]
        );
      } else {
        await db.query(
          `UPDATE CLIENTS
              SET fName = ?, lName = ?, email = ?, phoneNb = ?, age = ?, gender = ?,
                  address = ?, profilePic = ?
            WHERE clientId = ?`,
          [
            payload.fName.trim(),
            payload.lName.trim(),
            payload.email.trim(),
            payload.phoneNb.trim(),
            Number(payload.age),
            payload.gender.trim(),
            payload.address.trim(),
            payload.profilePic?.trim() || null,
            accountId,
          ]
        );
      }
    } else {
      const generatedPassword = crypto.randomBytes(32).toString("hex");
      const hashedPass = await bcrypt.hash(generatedPassword, 10);

      if (role === "user") {
        const [result] = await db.query(
          `INSERT INTO USERS
            (fName, lName, email, password, phoneNb, age, gender, address,
             clothingSize, profilePic, description, eligibility, isActive, codeOfConductAccepted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0)`,
          [
            payload.fName.trim(),
            payload.lName.trim(),
            payload.email.trim(),
            hashedPass,
            payload.phoneNb.trim(),
            Number(payload.age),
            payload.gender.trim(),
            payload.address.trim(),
            payload.clothingSize.trim(),
            payload.profilePic?.trim() || null,
            payload.description?.trim() || "",
          ]
        );
        accountId = result.insertId;
      } else {
        const [result] = await db.query(
          `INSERT INTO CLIENTS
            (fName, lName, email, password, phoneNb, age, gender, address, profilePic)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payload.fName.trim(),
            payload.lName.trim(),
            payload.email.trim(),
            hashedPass,
            payload.phoneNb.trim(),
            Number(payload.age),
            payload.gender.trim(),
            payload.address.trim(),
            payload.profilePic?.trim() || null,
          ]
        );
        accountId = result.insertId;
      }
    }

    await saveGoogleAuthMapping(role, accountId, googleProfile);
    const savedAccount = await fetchAccountById(role, accountId);
    res.status(account ? 200 : 201).json(buildAuthResponse(role, savedAccount));
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Email already exists for this role." });
    }
    sendGoogleError(res, err, "Failed to complete Google profile.");
  }
});

router.post("/logout", (_req, res) => {
  res.json({ message: "Logged out successfully." });
});

router.post("/login", async (req, res) => {
  const email = req.body.email?.trim();
  const password = req.body.password;
  const role = req.body.role;
  const validationErrors = [];

  if (!email) {
    validationErrors.push("Email is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    validationErrors.push("Valid email is required.");
  }
  if (!password) {
    validationErrors.push("Password is required.");
  }
  if (!role || !["user", "admin", "client"].includes(role)) {
    validationErrors.push("Valid role is required.");
  }

  if (validationErrors.length) {
    return res.status(400).json({
      message: "Validation failed",
      errors: validationErrors,
    });
  }

  try {
    let table, idField;
    if (role === 'user') { table = 'USERS'; idField = 'userId'; }
    else if (role === 'admin') { table = 'ADMINS'; idField = 'adminId'; }
    else if (role === 'client') { table = 'CLIENTS'; idField = 'clientId'; }
    else return res.status(400).json({ message: 'Invalid role' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE email = ?`, [email]);
    if (!rows.length) return res.status(404).json({ message: 'User not found' });

    const user = rows[0];
    const validPass = await bcrypt.compare(password, user.password);
    // ONLY FOR TESTING PURPOSES
    // const validPass = password === user.password; // Temporary for testing

    if (!validPass) return res.status(400).json({ message: 'Invalid password' });

    const token = signAuthToken(user[idField], role);
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ message: 'Login failed' });
  }
});

router.post("/signup/host", async (req, res) => {
  const errors = validateHostSignup(req.body);
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  const {
    fName,
    lName,
    email,
    password,
    phoneNb,
    age,
    gender,
    address,
    clothingSize,
    profilePic,
    description,
  } = req.body;

  try {
    const [existing] = await db.query("SELECT userId FROM USERS WHERE email = ?", [email.trim()]);
    if (existing.length) {
      return res.status(409).json({ message: "Email already exists.", field: "email" });
    }

    const hashedPass = await bcrypt.hash(password, 10);
    const normalizedDescription = description?.trim();

    const [result] = await db.query(
      `INSERT INTO USERS
        (fName, lName, email, password, phoneNb, age, gender, address, clothingSize, profilePic, description, eligibility, isActive, codeOfConductAccepted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0)`,
      [
        fName.trim(),
        lName.trim(),
        email.trim(),
        hashedPass,
        phoneNb.trim(),
        Number(age),
        gender.trim(),
        address.trim(),
        clothingSize.trim(),
        profilePic?.trim() || null,
        normalizedDescription === undefined ? "" : normalizedDescription,
      ]
    );

    const [rows] = await db.query(
      `SELECT userId, fName, lName, email, phoneNb, age, gender, address, clothingSize,
              profilePic, description, eligibility, isActive, codeOfConductAccepted, createdAt, updatedAt
         FROM USERS
        WHERE userId = ?`,
      [result.insertId]
    );

    res.status(201).json({
      message: "Host registered successfully.",
      user: rows[0],
    });
  } catch (err) {
    console.error("Failed to register host", err);
    res.status(500).json({ message: "Failed to register host." });
  }
});

router.post("/signup/client", async (req, res) => {
  const errors = validateClientSignup(req.body);
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  const { fName, lName, email, password, phoneNb, age, gender, address } = req.body;

  try {
    const [existing] = await db.query("SELECT clientId FROM CLIENTS WHERE email = ?", [email.trim()]);
    if (existing.length) {
      return res.status(409).json({ message: "Email already exists.", field: "email" });
    }

    const hashedPass = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO CLIENTS
        (fName, lName, email, password, phoneNb, age, gender, address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fName.trim(),
        lName.trim(),
        email.trim(),
        hashedPass,
        phoneNb.trim(),
        Number(age),
        gender.trim(),
        address.trim(),
      ]
    );

    res.status(201).json({
      message: "Client registered successfully.",
      client: {
        clientId: result.insertId,
        fName: fName.trim(),
        lName: lName.trim(),
        email: email.trim(),
        phoneNb: phoneNb.trim(),
        age: Number(age),
        gender: gender.trim(),
        address: address.trim(),
      },
    });
  } catch (err) {
    console.error("Failed to register client", err);
    res.status(500).json({ message: "Failed to register client." });
  }
});

export default router;
