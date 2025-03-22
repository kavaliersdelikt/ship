const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const indexjs = require("../app.js");
const adminjs = require("./admin.js");
const fs = require("fs");
const ejs = require("ejs");
const fetch = require("node-fetch");
const NodeCache = require("node-cache");
const Queue = require("../handlers/Queue.js");
const log = require("../handlers/log");

const myCache = new NodeCache({ deleteOnExpire: true, stdTTL: 59 });


const ShipModule = { "name": "Ship API", "api_level": 3, "target_platform": "1.x" };

if (ShipModule.target_platform !== settings.version) {
  console.log('Module ' + ShipModule.name + ' does not support this platform release of Ship. This is a a essential Module. If you cannot get this resolved, please contact support.')
  process.exit()
}


module.exports.ShipModule = ShipModule;
module.exports.load = async function (app, db) {
  app.get("/bal/:id", async (req, res) => {
let c = await db.get('coins-' + req.params.id)
res.json({ coins: c, staking: q })
})

const cache = {
    data: {},
    timeout: {},
};

const getCacheItem = (key) => {
    return cache.data[key];
};

const setCacheItem = (key, value) => {
    cache.data[key] = value;
    
    
    if (cache.timeout[key]) {
        clearTimeout(cache.timeout[key]);
    }
    
    
    cache.timeout[key] = setTimeout(() => {
        delete cache.data[key];
        delete cache.timeout[key];
    }, 60 * 1000); 
};

app.get("/stats", async (req, res) => {
    try {
        const fetchStats = async (endpoint) => {
            
            const cacheKey = `stats_${endpoint}`;
            const cachedValue = getCacheItem(cacheKey);
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const response = await fetch(`${settings.pterodactyl.domain}/api/application/${endpoint}?per_page=100000`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${settings.pterodactyl.key}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const total = data.meta.pagination.total;

            
            setCacheItem(cacheKey, total);
            return total;
        };

        
        const [users, servers, nodes, locations] = await Promise.all([
            fetchStats('users'),
            fetchStats('servers'),
            fetchStats('nodes'),
            fetchStats('locations')
        ]);

        res.json({ users, servers, nodes, locations });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'An error occurred while fetching stats' });
    }
});

  app.get(`/api/dailystatus`, async (req, res) => {
    if (!req.session.userinfo.id) return res.redirect("/login");
  
    let lastClaim = new Date(await db.get("dailycoins12-" + req.session.userinfo.id));
  
    
    const today = new Date();
    if (lastClaim && lastClaim.toDateString() === today.toDateString()) {
      return res.json({ text: '0' });
    } else {
      
      
      return res.json({ text: '1' });
    }
      })
  
  app.get('/daily-coins', async (req, res) => {
    
    if (!req.session.userinfo.id) return res.redirect("/login");
    const userId = req.session.userinfo.id
    
    
    let lastClaim = new Date(await db.get("dailycoins12-" + req.session.userinfo.id));
    
    
    const today = new Date();
    if (lastClaim && lastClaim.toDateString() === today.toDateString()) {
      
      res.redirect('../dashboard?err=CLAIMED');
    } else {
      
      
      const coins = await db.get("coins-" + req.session.userinfo.id) || 0;
      db.set("coins-" + req.session.userinfo.id, coins + 150)
  
      await db.set("dailycoins12-" + req.session.userinfo.id, today);
      res.redirect('../dashboard?err=none');
    }
  });
  



  app.get("/api", async (req, res) => {
   
    let authentication = await check(req, res);
    if (!authentication ) return;
    res.send({
      status: true,
    });
  });



  app.get("api/v3/userinfo", async (req, res) => {
   
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (!req.query.id) return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.query.id)))
      return res.send({ status: "invalid id" });

    if (settings.api.client.oauth2.link.slice(-1) == "/")
      settings.api.client.oauth2.link =
        settings.api.client.oauth2.link.slice(0, -1);

    if (settings.api.client.oauth2.callbackpath.slice(0, 1) !== "/")
      settings.api.client.oauth2.callbackpath =
        "/" + settings.api.client.oauth2.callbackpath;

    if (settings.pterodactyl.domain.slice(-1) == "/")
      settings.pterodactyl.domain = settings.pterodactyl.domain.slice(
        0,
        -1
      );

    let packagename = await db.get("package-" + req.query.id);
    let package =
      settings.api.client.packages.list[
        packagename ? packagename : settings.api.client.packages.default
      ];
    if (!package)
      package = {
        ram: 0,
        disk: 0,
        cpu: 0,
        servers: 0,
      };
    package["name"] = packagename;

    let pterodactylid = await db.get("users-" + req.query.id);
    let userinforeq = await fetch(
      settings.pterodactyl.domain +
        "/api/application/users/" +
        pterodactylid +
        "?include=servers",
      {
        method: "get",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.key}`,
        },
      }
    );
    if ((await userinforeq.statusText) == "Not Found") {
      console.log(
        "App ― An error has occured while attempting to get a user's information"
      );
      console.log("- Discord ID: " + req.query.id);
      console.log("- Pterodactyl Panel ID: " + pterodactylid);
      return res.send({ status: "could not find user on panel" });
    }
    let userinfo = await userinforeq.json();

    res.send({
      status: "success",
      package: package,
      extra: (await db.get("extra-" + req.query.id))
        ? await db.get("extra-" + req.query.id)
        : {
            ram: 0,
            disk: 0,
            cpu: 0,
            servers: 0,
          },
      userinfo: userinfo,
      coins:
        settings.api.client.coins.enabled == true
          ? (await db.get("coins-" + req.query.id))
            ? await db.get("coins-" + req.query.id)
            : 0
          : null,
    });
  });

 

  app.post("api/v3/setcoins", async (req, res) => {
   
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    let id = req.body.id;
    let coins = req.body.coins;
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    if (!(await db.get("users-" + id)))
      return res.send({ status: "invalid id" });
    if (typeof coins !== "number")
      return res.send({ status: "coins must be number" });
    if (coins < 0 || coins > 999999999999999)
      return res.send({ status: "too small or big coins" });
    if (coins == 0) {
      await db.delete("coins-" + id);
    } else {
      await db.set("coins-" + id, coins);
    }
    res.send({ status: "success" });
  });

  app.post("/api/v3/addcoins", async (req, res) => {
   
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    let id = req.body.id;
    let coins = req.body.coins;
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    if (!(await db.get("users-" + id)))
      return res.send({ status: "invalid id" });
    if (typeof coins !== "number")
      return res.send({ status: "coins must be number" });
    if (coins < 1 || coins > 999999999999999)
      return res.send({ status: "too small or big coins" });
    if (coins == 0) {
      return res.send({ status: "cant do that mate" });
    } else {
      let current = await db.get("coins-" + id);
      await db.set("coins-" + id, current + coins);
    }
    res.send({ status: "success" });
  });



  app.post("api/v3/setplan", async (req, res) => {
   
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (!req.body) return res.send({ status: "missing body" });

    if (typeof req.body.id !== "string")
      return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.body.id)))
      return res.send({ status: "invalid id" });

    if (typeof req.body.package !== "string") {
      await db.delete("package-" + req.body.id);
      adminjs.suspend(req.body.id);
      return res.send({ status: "success" });
    } else {
      if (!settings.api.client.packages.list[req.body.package])
        return res.send({ status: "invalid package" });
      await db.set("package-" + req.body.id, req.body.package);
      adminjs.suspend(req.body.id);
      return res.send({ status: "success" });
    }
  });



  app.post("api/v3/setresources", async (req, res) => {
   
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (!req.body) return res.send({ status: "missing body" });

    if (typeof req.body.id !== "string")
      return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.body.id)))
      res.send({ status: "invalid id" });

    if (
      typeof req.body.ram == "number" ||
      typeof req.body.disk == "number" ||
      typeof req.body.cpu == "number" ||
      typeof req.body.servers == "number"
    ) {
      let ram = req.body.ram;
      let disk = req.body.disk;
      let cpu = req.body.cpu;
      let servers = req.body.servers;

      let currentextra = await db.get("extra-" + req.body.id);
      let extra;

      if (typeof currentextra == "object") {
        extra = currentextra;
      } else {
        extra = {
          ram: 0,
          disk: 0,
          cpu: 0,
          servers: 0,
        };
      }

      if (typeof ram == "number") {
        if (ram < 0 || ram > 999999999999999) {
          return res.send({ status: "ram size" });
        }
        extra.ram = ram;
      }

      if (typeof disk == "number") {
        if (disk < 0 || disk > 999999999999999) {
          return res.send({ status: "disk size" });
        }
        extra.disk = disk;
      }

      if (typeof cpu == "number") {
        if (cpu < 0 || cpu > 999999999999999) {
          return res.send({ status: "cpu size" });
        }
        extra.cpu = cpu;
      }

      if (typeof servers == "number") {
        if (servers < 0 || servers > 999999999999999) {
          return res.send({ status: "server size" });
        }
        extra.servers = servers;
      }

      if (
        extra.ram == 0 &&
        extra.disk == 0 &&
        extra.cpu == 0 &&
        extra.servers == 0
      ) {
        await db.delete("extra-" + req.body.id);
      } else {
        await db.set("extra-" + req.body.id, extra);
      }

      adminjs.suspend(req.body.id);
      return res.send({ status: "success" });
    } else {
      res.send({ status: "missing variables" });
    }
  });



  async function check(req, res) {
    let settings = loadConfig("./config.toml");
    if (settings.api.client.api.enabled == true) {
      let auth = req.headers["authorization"];
      if (auth) {
        if (auth == "Bearer " + settings.api.client.api.code) {
          return settings;
        }
      }
    }
    let theme = indexjs.get(req);
    ejs.renderFile(
      `./views/${theme.settings.notfound}`,
      await eval(indexjs.renderdataeval),
      null,
      function (err, str) {
        delete req.session.newaccount;
        if (err) {
          console.log(
            `App ― An error has occured on path ${req._parsedUrl.pathname}:`
          );
          console.log(err);
          return res.send(
            "Internal Server Error"
          );
        }
        res.status(200);
        res.send(str);
      }
    );
    return null;
  }
};
