"use strict";


require("./handlers/console.js")();


const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const chalk = require("chalk");
const axios = require("axios");
const cluster = require("cluster");
const os = require("os");
const ejs = require("ejs");
const readline = require("readline");
const chokidar = require('chokidar');
global.Buffer = global.Buffer || require("buffer").Buffer;
process.emitWarning = function() {};

if (typeof btoa === "undefined") {
  global.btoa = function (str) {
    return Buffer.from(str, "binary").toString("base64");
  };
}
if (typeof atob === "undefined") {
  global.atob = function (b64Encoded) {
    return Buffer.from(b64Encoded, "base64").toString("binary");
  };
}


const loadConfig = require("./handlers/config");
const settings = loadConfig("./config.toml");


const defaultthemesettings = {
  index: "index.ejs",
  notfound: "index.ejs",
  redirect: {},
  pages: {},
  mustbeloggedin: [],
  mustbeadmin: [],
  variables: {},
};

async function renderdataeval(req, theme) {
  const JavaScriptObfuscator = require('javascript-obfuscator');
  let newsettings = loadConfig("./config.toml");
  let renderdata = {
    req: req,
    settings: newsettings,
    userinfo: req.session.userinfo,
    packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) ? await db.get("package-" + req.session.userinfo.id) : settings.api.client.packages.default : null,
    extraresources: !req.session.userinfo ? null : (await db.get("extra-" + req.session.userinfo.id) ? await db.get("extra-" + req.session.userinfo.id) : {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: 0
    }),
    packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) ? await db.get("package-" + req.session.userinfo.id) : settings.api.client.packages.default] : null,
    pterodactyl: req.session.pterodactyl,
    extra: theme.settings.variables,
    db: db
  };
  
  return renderdata;
}

module.exports.renderdataeval = renderdataeval;


const Database = require("./db.js");
const db = new Database(settings.database);


module.exports.db = db;
let isFirstWorker = false;

if (cluster.isMaster) {

  function startApp() {
    let moduleFiles = fs.readdirSync("./modules").filter((file) => file.endsWith(".js"));
    const settingsVersion = settings.version;

    moduleFiles.forEach(file => {
      const module = require('./modules/' + file);
      if (!module.load || !module.ShipModule) {
        process.exit()
        return;
      }
    
      const { name, api_level, target_platform } = module.ShipModule;
  
      if (target_platform !== settingsVersion) {
        process.exit()
        return;
      }
    });
  
    const numCPUs = parseInt(settings.clusters) - 1;
  
    if (numCPUs > 130 || numCPUs < 1) {
      process.exit()
    }

    for (let i = 0; i < numCPUs; i++) {
      const worker = cluster.fork();
      if (i === 0) {
        worker.send({ type: 'FIRST_WORKER' });
      }
    }
  
    cluster.on('exit', (worker, code, signal) => {
      cluster.fork();
    });
    
    const watcher = chokidar.watch('./modules');
    watcher.on('change', (path) => {
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    });
    
    const watcher2 = chokidar.watch('./handlers');
    watcher2.on('change', (path) => {
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    });
  }
  
  cluster.on('online', (worker) => {
    const workerTree = Object.values(cluster.workers).map(worker => ({
      id: worker.id,
      pid: worker.process.pid,
      state: worker.state,
    }));
  });

  startApp();
  console.log(chalk.cyan('✨ Ship is ready'));

} else {
  
  process.on('message', (msg) => {
    if (msg.type === 'FIRST_WORKER') {
      isFirstWorker = true;
    }
  });

  global.clusterSafeInterval = function(callback, delay) {
    if (isFirstWorker) {
      return setInterval(callback, delay);
    } else {
      return {
        unref: () => {},
        ref: () => {},
        close: () => {}
      };
    }
  };

  global.setInterval = function(callback, delay) {
     return clusterSafeInterval(callback, delay);
  };

  const express = require("express");
  const nocache = require('nocache');
  const app = express();
  app.set('view engine', 'ejs');
  require("express-ws")(app);

  const cookieParser = require('cookie-parser');
app.use(cookieParser());
app.use(express.text());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

  const session = require("express-session");
  const SessionStore = require("./handlers/session");
  const indexjs = require("./app.js");

  module.exports.app = app;

  app.use(nocache());
  app.use((req, res, next) => {
    res.setHeader("X-Powered-By", "3rd Gen Ship Next (Avalanche 2)");
    res.setHeader("X-Ship", "next v3.2.0 - \"avalanche\"");
    next();
  });

app.use((err, req, res, next) => {
  if (err.status === 500 && err.message === 'Gateway Timeout') {
    let theme = indexjs.get(req);
    const renderData = {
      err: 'Gateway Timeout'
    };
    res.status(500).render('500', renderData);
  } else {
    next(err);
  }
});

  app.use(
    session({
      secret: settings.website.secret,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }, 
      proxy: true
    })
  );

  app.use((req, res, next) => {
    if (req.ws) {
      return next();
    }
    next();
  });

  app.use(
    express.json({
      inflate: true,
      limit: "500kb",
      reviver: null,
      strict: true,
      type: "application/json",
      verify: undefined,
    })
  );

app.use(async (req, res, next) => {
  if (req.session.userinfo) {
    const userId = req.session.userinfo.id;
    const coinsKey = await db.get(`coins-${userId}`);
    
    if (coinsKey == undefined || coinsKey == null) {
      await db.set('coins-'+userId, 0);
    }
  }
  
  next(); 
});

  const listener = app.listen(settings.website.port, async function () {});

  var cache = false;
  app.use(function (req, res, next) {
    let manager = loadConfig("./config.toml").api
      .client.ratelimits;
    if (manager[req._parsedUrl.pathname]) {
      if (cache == true) {
        setTimeout(async () => {
          let allqueries = Object.entries(req.query);
          let querystring = "";
          for (let query of allqueries) {
            querystring = querystring + "&" + query[0] + "=" + query[1];
          }
          querystring = "?" + querystring.slice(1);
          res.redirect(
            (req._parsedUrl.pathname.slice(0, 1) == "/"
              ? req._parsedUrl.pathname
              : "/" + req._parsedUrl.pathname) + querystring
          );
        }, 1000);
        return;
      } else {
        cache = true;
        setTimeout(async () => {
          cache = false;
        }, 1000 * manager[req._parsedUrl.pathname]);
      }
    }
    next();
  });

  function collectRoutes(app) {
    const routes = [];
    app._router.stack.forEach(function(middleware){
      if(middleware.route){ 
        routes.push(middleware.route.path);
      } else if(middleware.name === 'router'){ 
        middleware.handle.stack.forEach(function(handler){
          if(handler.route){
            routes.push(handler.route.path);
          }
        });
      }
    });
    return routes;
  }

  let apifiles = fs.readdirSync("./modules").filter((file) => file.endsWith(".js"));

  apifiles.forEach((file) => {
    let apifile = require(`./modules/${file}`);
    apifile.load(app, db);
  });

  const routes = collectRoutes(app);
  routes.forEach(route => {});

  app.all("*", async (req, res) => {
    if (req.session.pterodactyl)
      if (
        req.session.pterodactyl.id !==
        (await db.get("users-" + req.session.userinfo.id))
      )
        return res.redirect("/login?prompt=none");
    let theme = indexjs.get(req);
    if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname))
      if (!req.session.userinfo || !req.session.pterodactyl)
        return res.redirect(
          "/login" +
            (req._parsedUrl.pathname.slice(0, 1) == "/"
              ? "?redirect=" + req._parsedUrl.pathname.slice(1)
              : "")
        );
    if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
      const renderData = await renderdataeval(req, theme);
      res.render(theme.settings.notfound, renderData);
      return;
    }
    const data = await renderdataeval(req, theme);
    res.render(theme.settings.pages[req._parsedUrl.pathname.slice(1)] || theme.settings.notfound, data);
  });

  module.exports.get = function (req) {
    return {
      settings: fs.existsSync(`./views/pages.json`)
        ? JSON.parse(fs.readFileSync(`./views/pages.json`).toString())
        : defaultthemesettings
    };
  };

  module.exports.islimited = async function () {
    return cache == true ? false : true;
  };

  module.exports.ratelimits = async function (length) {
    if (cache == true) return setTimeout(indexjs.ratelimits, 1);
    cache = true;
    setTimeout(async function () {
      cache = false;
    }, length * 1000);
  };

  process.on('uncaughtException', (error) => {});

const shimPromiseWithStackCapture = () => {
  const originalPromise = global.Promise;
  const captureStack = () => new Error().stack;

  function PromiseWithStack(executor) {
    const stack = captureStack();
    return new originalPromise((resolve, reject) => {
      return executor(resolve, (reason) => {
        if (reason instanceof Error) {
          if (!reason.stack) {
            reason.stack = stack;
          }
        } else {
          const err = new Error(reason);
          err.stack = stack;
          reject(err);
          return;
        }
        reject(reason);
      });
    });
  }

  PromiseWithStack.prototype = originalPromise.prototype;
  PromiseWithStack.all = originalPromise.all;
  PromiseWithStack.race = originalPromise.race;
  PromiseWithStack.resolve = originalPromise.resolve;
  PromiseWithStack.reject = originalPromise.reject;

  global.Promise = PromiseWithStack;
};

shimPromiseWithStackCapture();

process.on('unhandledRejection', (reason, promise) => {});
}