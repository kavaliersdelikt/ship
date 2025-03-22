const indexjs = require("../app.js");
const ejs = require("ejs");
const express = require("express");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const fetch = require("node-fetch");


const ShipModule = { "name": "Pages", "api_level": 3, "target_platform": "1.x" };

if (ShipModule.target_platform !== settings.version) {
  console.log('Module ' + ShipModule.name + ' does not support this platform release of Ship. This is a a essential Module. If you cannot get this resolved, please contact support.')
  process.exit()
}


module.exports.ShipModule = ShipModule;
module.exports.load = async function (app, db) {
  app.all("/", async (req, res) => {
    try {
      if (
        req.session.pterodactyl &&
        req.session.pterodactyl.id !==
          (await db.get("users-" + req.session.userinfo.id))
      ) {
        return res.redirect("/login?prompt=none");
      }

      let theme = indexjs.get(req);
      if (
        theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname) &&
        (!req.session.userinfo || !req.session.pterodactyl)
      ) {
        return res.redirect("/login");
      }

      if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
        const renderData = await indexjs.renderdataeval(req, theme);
        res.render(theme.settings.index, renderData);
        return;
      }

      const renderDataPromise = indexjs.renderdataeval(req, theme);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database Failure')), 3000)
      );

      try {
        const renderData = await Promise.race([renderDataPromise, timeoutPromise]);
        res.render(theme.settings.index, renderData);
      } catch (error) {
        if (error.message === 'Database Failure') {
          res.status(500).render("500.ejs", { err: 'Database Failure' });
        } else {
          throw error;
        }
      }
    } catch (err) {
      console.log(err);
      res.status(500).render("500.ejs", { err });
    }
  });

  app.use("/assets", express.static("./assets"));
};