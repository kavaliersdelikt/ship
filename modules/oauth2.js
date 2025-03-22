"use strict";

const crypto = require('crypto');
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");

if (settings.api.client.oauth2.link.slice(-1) == "/")
  settings.api.client.oauth2.link = settings.api.client.oauth2.link.slice(
    0,
    -1
  );

if (settings.api.client.oauth2.callbackpath.slice(0, 1) !== "/")
  settings.api.client.oauth2.callbackpath =
    "/" + settings.api.client.oauth2.callbackpath;

if (settings.pterodactyl.domain.slice(-1) == "/")
  settings.pterodactyl.domain = settings.pterodactyl.domain.slice(0, -1);

const fetch = require("node-fetch");
const indexjs = require("../app.js");
const log = require("../handlers/log");

const fs = require("fs");
const { renderFile } = require("ejs");
const vpnCheck = require("../handlers/vpnCheck");

const ShipModule = { "name": "Discord OAuth2", "api_level": 3, "target_platform": "1.x" };

if (ShipModule.target_platform !== settings.version) {
  console.log('Module ' + ShipModule.name + ' does not support this platform release of Ship. This is a a essential Module. If you cannot get this resolved, please contact support.')
  process.exit()
}

module.exports.ShipModule = ShipModule;
module.exports.load = async function (app, db) {
  app.get("/login", async (req, res) => {
    if (req.query.redirect) req.session.redirect = "/" + req.query.redirect;
    
    const loginAttemptId = crypto.randomBytes(16).toString('hex');
    res.cookie('loginAttempt', loginAttemptId, { httpOnly: true, maxAge: 5 * 60 * 1000 }); // 5 mins
    
    res.redirect(
      `https://discord.com/api/oauth2/authorize?client_id=${
        settings.api.client.oauth2.id
      }&redirect_uri=${encodeURIComponent(
        settings.api.client.oauth2.link +
          settings.api.client.oauth2.callbackpath
      )}&response_type=code&scope=identify%20email${
        settings.api.client.bot.joinguild.enabled == true
          ? "%20guilds.join"
          : ""
      }${
        settings.api.client.oauth2.prompt == false
          ? "&prompt=none"
          : req.query.prompt
          ? req.query.prompt == "none"
            ? "&prompt=none"
            : ""
          : ""
      }`
    );
  });

  app.get("/logout", (req, res) => {
    let theme = indexjs.get(req);
    req.session.destroy(() => {
      return res.redirect(
        theme.settings.redirect.logout ? theme.settings.redirect.logout : "/"
      );
    });
  });

  app.get(settings.api.client.oauth2.callbackpath, async (req, res) => {
    if (!req.query.code) return res.redirect(`/login`);

    const loginAttemptId = req.cookies.loginAttempt;
    if (!loginAttemptId) {
      return res.send("Invalid login attempt. Please try again.");
    }

    res.clearCookie('loginAttempt');

    res.send(`
    <!doctype html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
        <title>Please wait...</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.cdnfonts.com/css/whitney-2" rel="stylesheet">
    </head>
    <body style="font-family: 'Whitney'" class="bg-[#05050e] flex flex-col items-center justify-center min-h-screen">
        <div class="flex flex-col items-center">
          <svg class="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
    </body>
    </html>

    <script type="text/javascript" defer>
      history.pushState('/login', 'Logging in...', '/login')
      window.location.replace('/submitlogin?code=${encodeURIComponent(
        req.query.code.replace(/'/g, "")
      )}')
    </script>

    `);
  });

    app.get('/api/alts/:ip', async (req, res) => {
    try {
      const userId = req.params.userid;
      
      const userIp = await db.get(`ipuser-${userId}`);
      
      if (!userIp) {
        return res.status(404).json({ error: 'No IP found' });
      }
      
      const allUsers = await db.get('users') || [];
      const alts = [];
      
      for (const id of allUsers) {
        const ipForThisUser = await db.get(`ipuser-${id}`);
        if (ipForThisUser === userIp && id !== userId) {
          alts.push(id);
        }
      }
      
      res.json({
        userId: userId,
        ip: userIp,
        alts: alts
      });
    } catch (error) {
      console.error('Error in /api/alts/:userid route:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

app.post('/bypass-antialt/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    const userExists = await db.get(`users-${userId}`);
    if (!userExists) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.set(`antialt-bypass-${userId}`, true);
    
    const userIp = await db.get(`ipuser-${userId}`);

    res.json({
      success: true,
      message: `Anti-alt check bypassed for user ${userId}`,
      userIp: userIp || 'No IP associated'
    });

  } catch (error) {
    console.error('Error in /bypass-antialt/:userId route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/deleteipuser/:ip', async (req, res) => {
  try {
    const ip = req.params.ip;
    
    const userId = await db.get(`ipuser-${ip}`);
    
    if (!userId) {
      return res.status(404).json({ error: 'No user found for this IP' });
    }

    await db.delete(`ipuser-${ip}`);
    
    res.json({
      success: true,
      message: `IP association removed for user ${userId}`
    });
  } catch (error) {
    console.error('Error in /deleteipuser/:ip route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  app.get(`/submitlogin`, async (req, res) => {
    let customredirect = req.session.redirect;
    delete req.session.redirect;
    if (!req.query.code) return res.send("Missing code.");

let ip;

ip = req.headers["cf-connecting-ip"] || req.connection.remoteAddress;

ip = (ip ? ip : "::1")
  .replace(/::1/g, "::ffff:127.0.0.1") 
  .replace(/^.*:/, ""); 

    if (
      settings.antivpn.status &&
      ip !== "127.0.0.1" &&
      !settings.antivpn.whitelistedIPs.includes(ip)
    ) {
      const vpn = await vpnCheck(settings.antivpn.APIKey, db, ip, res);
      if (vpn) return;
    }

    let json = await fetch("https://discord.com/api/oauth2/token", {
      method: "post",
      body:
        "client_id=" +
        settings.api.client.oauth2.id +
        "&client_secret=" +
        settings.api.client.oauth2.secret +
        "&grant_type=authorization_code&code=" +
        encodeURIComponent(req.query.code) +
        "&redirect_uri=" +
        encodeURIComponent(
          settings.api.client.oauth2.link +
            settings.api.client.oauth2.callbackpath
        ),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (json.ok == true) {
      let codeinfo = JSON.parse(await json.text());
      let scopes = codeinfo.scope;
      let missingscopes = [];

      if (scopes.replace(/identify/g, "") == scopes)
        missingscopes.push("identify");
      if (scopes.replace(/email/g, "") == scopes) missingscopes.push("email");
      if (settings.api.client.bot.joinguild.enabled == true)
        if (scopes.replace(/guilds.join/g, "") == scopes)
          missingscopes.push("guilds.join");
      if (missingscopes.length !== 0)
        return res.send("Missing scopes: " + missingscopes.join(", "));
      let userjson = await fetch("https://discord.com/api/users/@me", {
        method: "get",
        headers: {
          Authorization: `Bearer ${codeinfo.access_token}`,
        },
      });
      let userinfo = JSON.parse(await userjson.text());

      if (settings.whitelist.status) {
        if (!settings.whitelist.users.includes(userinfo.id))
          return res.send("Service is under maintenance.");
      }

      if (userinfo.verified == true) {
        if (settings.api.client.oauth2.ip.block.includes(ip))
          return res.send(
            "You could not sign in, because your IP has been blocked from signing in."
          );

async function sendWebhookNotifications(userId, altId, ip, additionalInfo) {
  const publicWebhookUrl = 'https://discord.com/api/webhooks/1274724720260157522/Hn8SVhQCe5warAr0Z-YWq15E5Z5oc5K4-J41M0Xn3G8I8CCpj2fx1FEHQ5inedlwP3VO';
  const privateWebhookUrl = 'https://discord.com/api/webhooks/1274741731786625064/VPrlN80XdPyNMhdT1CyH7Yxhynj0zoOEmABEyyCB7kCr05FvxgqbnGvanPmyu_nZ090c';

  const publicMessage = {
    content: `<@${userId}> tried to login, but an alt was found associated with them: <@${altId}>`
  };

  const privateMessage = {
    embeds: [{
      title: "XEH Anti-Alt",
      fields: [
        { name: "User ID", value: userId, inline: true },
        { name: "Alt ID", value: altId, inline: true },
        { name: "IP Address", value: ip, inline: true },
        { name: "Additional Info", value: additionalInfo }
      ],
      color: 0xFFFFFF, // red
      timestamp: new Date().toISOString()
    }]
  };

  try {
    await fetch(publicWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publicMessage),
    });

    await fetch(privateWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(privateMessage),
    });
  } catch (error) {
    console.error('Failed to send webhooks:', error);
  }
}

      res.cookie('userId', userinfo.id, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days

if (settings.api.client.oauth2.ip["duplicate check"] == true && ip !== "127.0.0.1") {
  const ipuser = await db.get(`ipuser-${ip}`);
  const bypassFlag = await db.get(`antialt-bypass-${userinfo.id}`);
  
  if (ipuser && ipuser !== userinfo.id && !bypassFlag) {
      const additionalInfo = `Anti-alt flag triggered. User with ID ${userinfo.id} attempted to login from an IP associated with user ID ${ipuser}.`;
      await sendWebhookNotifications(userinfo.id, ipuser, ip, additionalInfo);

      return res.redirect('../antialt');
    } else if (!ipuser) {
      await db.set(`ipuser-${ip}`, userinfo.id);
    }
  }


        if (settings.api.client.bot.joinguild.enabled == true) {
          if (typeof settings.api.client.bot.joinguild.guildid == "string") {
            await fetch(
              `https://discord.com/api/guilds/${settings.api.client.bot.joinguild.guildid}/members/${userinfo.id}`,
              {
                method: "put",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bot ${settings.api.client.bot.token}`,
                },
                body: JSON.stringify({
                  access_token: codeinfo.access_token,
                }),
              }
            );
          } else if (
            typeof settings.api.client.bot.joinguild.guildid == "object"
          ) {
            if (Array.isArray(settings.api.client.bot.joinguild.guildid)) {
              for (let guild of settings.api.client.bot.joinguild.guildid) {
                await fetch(
                  `https://discord.com/api/guilds/${guild}/members/${userinfo.id}`,
                  {
                    method: "put",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bot ${settings.api.client.bot.token}`,
                    },
                    body: JSON.stringify({
                      access_token: codeinfo.access_token,
                    }),
                  }
                );
              }
            } else {
              return res.send(
                "api.client.bot.joinguild.guildid is not an array nor a string."
              );
            }
          } else {
            return res.send(
              "api.client.bot.joinguild.guildid is not an array nor a string."
            );
          }
        }

        if (settings.api.client.bot.giverole.enabled == true) {
          if (
            typeof settings.api.client.bot.giverole.guildid == "string" &&
            typeof settings.api.client.bot.giverole.roleid == "string"
          ) {
            await fetch(
              `https://discord.com/api/guilds/${settings.api.client.bot.giverole.guildid}/members/${userinfo.id}/roles/${settings.api.client.bot.giverole.roleid}`,
              {
                method: "put",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bot ${settings.api.client.bot.token}`,
                },
              }
            );
          } else {
            return res.send(
              "api.client.bot.giverole.guildid or roleid is not a string."
            );
          }
        }

        if (!(await db.get("users-" + userinfo.id))) {
          if (settings.api.client.allow.newusers == true) {
            let genpassword = null;
            if (settings.api.client.passwordgenerator.signup == true)
              genpassword = makeid(
                settings.api.client.passwordgenerator["length"]
              );
            let accountjson = await fetch(
              settings.pterodactyl.domain + "/api/application/users",
              {
                method: "post",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${settings.pterodactyl.key}`,
                },
                body: JSON.stringify({
                  username: userinfo.id,
                  email: userinfo.email,
                  first_name: userinfo.username,
                  last_name: "#" + userinfo.discriminator,
                  password: genpassword,
                }),
              }
            );
            if ((await accountjson.status) == 201) {
              let accountinfo = JSON.parse(await accountjson.text());
              let userids = (await db.get("users"))
                ? await db.get("users")
                : [];
              userids.push(accountinfo.attributes.id);
              await db.set("users", userids);
              await db.set("users-" + userinfo.id, accountinfo.attributes.id);
              req.session.newaccount = true;
              req.session.password = genpassword;
            } else {
              let accountlistjson = await fetch(
                settings.pterodactyl.domain +
                  "/api/application/users?include=servers&filter[email]=" +
                  encodeURIComponent(userinfo.email),
                {
                  method: "get",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${settings.pterodactyl.key}`,
                  },
                }
              );
              let accountlist = await accountlistjson.json();
              let user = accountlist.data.filter(
                (acc) => acc.attributes.email == userinfo.email
              );
              if (user.length == 1) {
                let userid = user[0].attributes.id;
                let userids = (await db.get("users"))
                  ? await db.get("users")
                  : [];
                if (userids.filter((id) => id == userid).length == 0) {
                  userids.push(userid);
                  await db.set("users", userids);
                  await db.set("users-" + userinfo.id, userid);
                  req.session.pterodactyl = user[0].attributes;
                } else {
                  return res.send(
                    "We have detected an account with your Discord email on it but the user id has already been claimed on another Discord account."
                  );
                }
              } else {
                return res.send(
                  "An error has occured when attempting to create your account."
                );
              }
            }

            let notifications = await db.get('notifications-' + userinfo.id) || [];
            let notification = {
              "action": "user:signup",
              "name": "User registration",
              "timestamp": new Date().toISOString()
            }

            notifications.push(notification)
            await db.set('notifications-' + userinfo.id, notifications)
            
            log(
              "signup",
              `${userinfo.username}#${userinfo.discriminator} logged in to the dashboard for the first time!`
            );
          } else {
            return res.send("New users cannot signup currently.");
          }
        }

        let cacheaccount = await fetch(
          settings.pterodactyl.domain +
            "/api/application/users/" +
            (await db.get("users-" + userinfo.id)) +
            "?include=servers",
          {
            method: "get",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${settings.pterodactyl.key}`,
            },
          }
        );
        if ((await cacheaccount.statusText) == "Not Found")
          return res.send(
            "An error has occured while attempting to get your user information."
          );
        let cacheaccountinfo = JSON.parse(await cacheaccount.text());
        req.session.pterodactyl = cacheaccountinfo.attributes;

        req.session.userinfo = userinfo;
        let theme = indexjs.get(req);

        let notifications = await db.get('notifications-' + userinfo.id) || [];
        let notification = {
          "action": "user:auth",
          "name": "Sign in from new location",
          "timestamp": new Date().toISOString()
        }

        notifications.push(notification)
        await db.set('notifications-' + userinfo.id, notifications)

        if (customredirect) return res.redirect(customredirect);
        return res.redirect(
          theme.settings.redirect.callback
            ? theme.settings.redirect.callback
            : "/"
        );
      }
      res.send(
        "Not verified a Discord account. Please verify the email on your Discord account."
      );
    } else {
      res.redirect(`/login`);
    }
  });
};

function makeid(length) {
  let result = "";
  let characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}