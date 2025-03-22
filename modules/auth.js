const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const fetch = require("node-fetch");
const indexjs = require("../app.js");
const log = require("../handlers/log");
const fs = require("fs");
const { renderFile } = require("ejs");

const RESEND_API_KEY = settings.resend_api_key;

const ShipModule = { "name": "User/Password Auth with Email", "api_level": 3, "target_platform": "1.x" };

if (ShipModule.target_platform !== settings.version) {
  console.log('Module ' + ShipModule.name + ' does not support this platform release of Ship. The module was built for platform ' + ShipModule.target_platform + ' but is attempting to run on version ' + settings.version + '.')
  process.exit()
}

module.exports.ShipModule = ShipModule;
module.exports.load = async function (app, db) {
  const rateLimit = (req, res, next) => {
    if (!req.session.lastAuthAttempt) {
      req.session.lastAuthAttempt = Date.now();
      return next();
    }

    const timeElapsed = Date.now() - req.session.lastAuthAttempt;
    if (timeElapsed < 1000) {
      return res.status(429).json({ error: "Too many requests. Please try again in " + (1000 - timeElapsed) + " ms." });
    }

    req.session.lastAuthAttempt = Date.now();
    next();
  };

  const sendEmail = async (to, subject, html) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'no-reply@ship.rocks',
        to,
        subject,
        html
      })
    });

    if (!response.ok) {
      throw new Error('Failed to send email');
    }
  };

  app.get("/test", async (req, res) => {
    const userId = req.session.userinfo.id;
    res.status(200).json({ 
        userId
    });
  });
  
  app.post("/auth/register", rateLimit, async (req, res) => {
    try {
        const { username, email, password } = req.body;
        console.log('Registration attempt:', { username, email });

        if (!username || !email || !password) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const usernameRegex = /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/;
        if (!usernameRegex.test(username)) {
          return res.status(400).json({ 
            error: "Username must start and end with alphanumeric characters and contain only letters, numbers, dashes, underscores, and periods" 
          });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ error: "Invalid email format" });
        }

        if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
          return res.status(400).json({ error: "Password must be at least 12 characters long and contain uppercase, lowercase, number, and special character" });
        }

        const existingUser = await db.get(`user-${email}`);
        if (existingUser) {
          return res.status(409).json({ error: "Email already in use" });
        }

        const existingUsername = await db.get(`username-${username}`);
        if (existingUsername) {
          return res.status(409).json({ error: "Username already taken" });
        }

        const userId = uuidv4();
        console.log('Generated userId:', userId);

        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        await db.set(`user-${email}`, {
          id: userId,
          username,
          email,
          password: hashedPassword,
          createdAt: new Date().toISOString()
        });

        await db.set(`userid-${userId}`, email);
        await db.set(`username-${username}`, userId);

        let genpassword = makeid(settings.api.client.passwordgenerator.length);
        console.log('Attempting Pterodactyl account creation...');

        let accountjson = await fetch(
          `${settings.pterodactyl.domain}/api/application/users`,
          {
            method: "post",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "Authorization": `Bearer ${settings.pterodactyl.key}`,
            },
            body: JSON.stringify({
              username: username.toLowerCase().replace(/[^a-z0-9._-]/g, ''),
              email: email.toLowerCase(),
              first_name: username,
              last_name: "User",
              password: genpassword,
              root_admin: false,
              language: "en"
            }),
          }
        );

        if (accountjson.status !== 201) {
          const errorText = await accountjson.text();
          console.error('Pterodactyl Error Details:', {
            status: accountjson.status,
            response: errorText,
            endpoint: `${settings.pterodactyl.domain}/api/application/users`,
            key: settings.pterodactyl.key.substring(0, 10) + '...'
          });
          return res.status(500).json({ 
            error: "Failed to create Pterodactyl account. Please check server logs." 
          });
        }

        let accountinfo = JSON.parse(await accountjson.text());
        console.log('Account info:', accountinfo);

        let userids = (await db.get("users")) || [];
        userids.push(accountinfo.attributes.id);
        
        console.log('Storing user data...');
        await db.set("users", userids);
        await db.set("users-" + userId, accountinfo.attributes.id);
        console.log('User data stored successfully');

        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: "An unexpected error occurred during registration" });
    }
  });

  app.post("/auth/login", rateLimit, async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const user = await db.get(`user-${email}`);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    req.session.userinfo = {
      id: user.id,
      username: user.username,
      email: user.email,
      global_name: user.username
    };

    let cacheaccount = await fetch(
      settings.pterodactyl.domain + "/api/application/users/" + (await db.get("users-" + user.id)) + "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if ((await cacheaccount.statusText) == "Not Found") {
      return res.status(500).json({ error: "Failed to fetch user information" });
    }

    let cacheaccountinfo = JSON.parse(await cacheaccount.text());
    req.session.pterodactyl = cacheaccountinfo.attributes;

    let notifications = await db.get('notifications-' + user.id) || [];
    let notification = {
      "action": "user:auth",
      "name": "Sign in from new location",
      "timestamp": new Date().toISOString()
    }

    notifications.push(notification)
    await db.set('notifications-' + user.id, notifications)

    res.json({ message: "Login successful" });
  });

  app.post("/auth/reset-password-request", async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await db.get(`user-${email}`);
    if (!user) {
      return res.json({ message: "If the email exists, a reset link will be sent" });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000;

    await db.set(`reset-${resetToken}`, {
      userId: user.id,
      expiry: resetTokenExpiry
    });

    const resetLink = `${settings.website.domain}/auth/reset-password?token=${resetToken}`;

    try {
      await sendEmail(
        email,
        'Reset Your Ship.rocks Password',
        `<h1>Reset Your Password</h1><p>Click the link below to reset your password:</p><a href="${resetLink}">${resetLink}</a><p>This link will expire in 1 hour.</p>`
      );
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      return res.status(500).json({ error: "Failed to send reset email" });
    }

    res.json({ message: "If the email exists, a reset link will be sent" });
  });

  app.post("/auth/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    const resetInfo = await db.get(`reset-${token}`);
    if (!resetInfo || resetInfo.expiry < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must be at least 12 characters long and contain uppercase, lowercase, number, and special character" });
    }

    const userEmail = await db.get(`userid-${resetInfo.userId}`);
    const user = await db.get(`user-${userEmail}`);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    user.password = hashedPassword;
    await db.set(`user-${userEmail}`, user);

    await db.delete(`reset-${token}`);

    res.json({ message: "Password reset successful" });
  });

  app.post("/auth/magic-link", rateLimit, async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await db.get(`user-${email}`);
    if (!user) {
      return res.json({ message: "If the email exists, a magic link will be sent" });
    }

    const magicToken = crypto.randomBytes(32).toString('hex');
    const magicTokenExpiry = Date.now() + 600000;

    await db.set(`magic-${magicToken}`, {
      userId: user.id,
      expiry: magicTokenExpiry
    });

    const magicLink = `${settings.website.domain}/auth/magic-login?token=${magicToken}`;

    try {
      await sendEmail(
        email,
        'Login for Ship.rocks',
        `<h1>Login to Ship.rocks</h1><p>Click the link below to log in:</p><a href="${magicLink}">${magicLink}</a><p>This link will expire in 10 minutes.</p>`
      );
    } catch (error) {
      console.error('Failed to send magic link email:', error);
      return res.status(500).json({ error: "Failed to send magic link email" });
    }

    res.json({ message: "If the email exists, a magic link will be sent" });
  });

  app.get("/auth/magic-login", async (req, res) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const magicInfo = await db.get(`magic-${token}`);
    if (!magicInfo || magicInfo.expiry < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const userEmail = await db.get(`userid-${magicInfo.userId}`);
    const user = await db.get(`user-${userEmail}`);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    req.session.userinfo = {
      id: user.id,
      username: user.username,
      email: user.email,
      global_name: user.username
    };

    let cacheaccount = await fetch(
      settings.pterodactyl.domain + "/api/application/users/" + (await db.get("users-" + user.id)) + "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );

    if ((await cacheaccount.statusText) == "Not Found") {
      return res.status(500).json({ error: "Failed to fetch user information" });
    }

    let cacheaccountinfo = JSON.parse(await cacheaccount.text());
    req.session.pterodactyl = cacheaccountinfo.attributes;

    await db.delete(`magic-${token}`);

    let notifications = await db.get('notifications-' + user.id) || [];
    let notification = {
      "action": "user:auth",
      "name": "Sign in using magic link",
      "timestamp": new Date().toISOString()
    }

    notifications.push(notification)
    await db.set('notifications-' + user.id, notifications)

    res.redirect('/dashboard');
  });
};

function makeid(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}