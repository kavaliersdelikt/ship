const indexjs = require("../app.js");
const adminjs = require("./admin.js");
const fs = require("fs");
const ejs = require("ejs");
const fetch = require('node-fetch');


const ShipModule = { "name": "Referrals", "api_level": 1, "target_platform": "1.x" };


module.exports.ShipModule = ShipModule;
module.exports.load = async function (app, db) {
app.get('/generate', async (req, res) => {
  if (!req.session) return res.redirect("/login");
  if (!req.session.pterodactyl) return res.redirect("/login");

  if (!req.query.code) {
    return res.redirect('../account?err=INVALIDCODE')
  }

  let referralCode = req.query.code;
  
  if(referralCode.length > 15 || referralCode.includes(" ")) {
    return res.redirect('../referrals?err=INVALIDCODE')
  }
  
  if(await db.get(referralCode)){
    return res.redirect('../referrals?err=ALREADYEXISTS');
  }
  
  await db.set(referralCode, {
    userId: req.session.userinfo.id,
    createdAt: new Date()
  });

  
  res.redirect('../referrals?err=none')
});

app.get('/claim', async (req, res) => {
  if (!req.session) return res.redirect("/login");
  if (!req.session.pterodactyl) return res.redirect("/login");

  
  if (!req.query.code) {
    return res.redirect('../account?err=INVALIDCODE')
  }

  const referralCode = req.query.code;

  
  const referral = await db.get(referralCode);

  if (!referral) {
    return res.redirect('../account?err=INVALIDCODE')
  }

  
  if (await db.get("referral-" + req.session.userinfo.id) == "1") {
    return res.redirect('../account?err=CANNOTCLAIM')
  }

  
  if (referral.userId === req.session.userinfo.id) {
    
    return res.redirect('../account?err=CANNOTCLAIM')
  }

  try {
    
    let referrerResources = await db.get("extra-" + referral.userId) || { ram: 0, disk: 0, cpu: 0, servers: 0 };
    let friendResources = await db.get("extra-" + req.session.userinfo.id) || { ram: 0, disk: 0, cpu: 0, servers: 0 };

    
    referrerResources.ram = (referrerResources.ram || 0) + 128;
    friendResources.ram = (friendResources.ram || 0) + 256;

    
    await db.set("extra-" + referral.userId, referrerResources);
    await db.set("extra-" + req.session.userinfo.id, friendResources);

    
    await db.set("referral-" + req.session.userinfo.id, "1");

    
    res.redirect('../account?err=none');

  } catch (error) {
    console.error('Failed to process referral:', error);
    res.redirect('../account?err=FAILED');
  }
});

};