const express = require('express');
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const WebSocket = require('ws');
const axios = require('axios');


const ShipModule = {
    "name": "Pterodactyl Client - Settings",
    "api_level": 3,
    "target_platform": "1.x"
};

if (ShipModule.target_platform !== settings.version) {
    console.log('Module ' + ShipModule.name + ' does not support this platform release of Ship. This is a a essential Module. If you cannot get this resolved, please contact support.')
    process.exit()
}


module.exports.ShipModule = ShipModule;
module.exports.load = async function(app, db) {
    const router = express.Router();

    
    const isAuthenticated = (req, res, next) => {
        if (req.session.pterodactyl) {
            next();
        } else {
            res.status(401).json({ error: "Unauthorized" });
        }
    };

    
    const ownsServer = (req, res, next) => {
        const serverId = req.params.id;
        const userServers = req.session.pterodactyl.relationships.servers.data;
        const serverOwned = userServers.some(server => server.attributes.identifier === serverId);
        
        if (serverOwned) {
            next();
        } else {
            res.status(403).json({ error: "Forbidden. You don't have access to this server." });
        }
    };

    
    router.post('/server/:id/reinstall', isAuthenticated, ownsServer, async (req, res) => {
        try {
            const serverId = req.params.id;
            await axios.post(`${settings.pterodactyl.domain}/api/client/servers/${serverId}/settings/reinstall`, {}, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.pterodactyl.client_key}`
                }
            });
            res.status(204).send(); 
        } catch (error) {
            console.error('Error reinstalling server:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    
    router.post('/server/:id/rename', isAuthenticated, ownsServer, async (req, res) => {
        try {
            const serverId = req.params.id;
            const { name } = req.body; 

            await axios.post(`${settings.pterodactyl.domain}/api/client/servers/${serverId}/settings/rename`, 
            { name: name }, 
            {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.pterodactyl.client_key}`
                }
            });
            res.status(204).send(); 
        } catch (error) {
            console.error('Error renaming server:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    
    app.use('/api', router);

};