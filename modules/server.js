const express = require("express");
const PterodactylClientModule = require("../handlers/Client.js");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const WebSocket = require("ws");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const schedule = require("node-schedule");

const workflowsFilePath = path.join(__dirname, "../storage/workflows.json");
const scheduledWorkflowsFilePath = path.join(
  __dirname,
  "../storage/scheduledWorkflows.json"
);

const ShipModule = {
  name: "Pterodactyl Client",
  api_level: 3,
  target_platform: "1.x",
};

if (ShipModule.target_platform !== settings.version) {
  console.log('Module ' + ShipModule.name + ' does not support this platform release of Ship. This is a a essential Module. If you cannot get this resolved, please contact support.')
  process.exit();
}

module.exports.ShipModule = ShipModule;
module.exports.load = async function (app, db) {

async function logActivity(db, serverId, action, details) {
  const timestamp = new Date().toISOString();
  const activityLog = await db.get(`activity_log_${serverId}`) || [];
  
  activityLog.unshift({ timestamp, action, details });
  
  if (activityLog.length > 100) {
    activityLog.pop();
  }
  
  await db.set(`activity_log_${serverId}`, activityLog);
}



  async function getAvailableAllocations(nodeId) {
    const response = await apiRequest(
      `/nodes/${nodeId}/allocations?per_page=10000`
    );
    return response.data.filter(
      (allocation) => !allocation.attributes.assigned
    );
  }

  

  async function getServerDetails(serverId) {
    const response = await apiRequest(`/servers/${serverId}`);
    return response.data;
  }

  

  const router = express.Router();
  const pterodactylClient = new PterodactylClientModule(
    settings.pterodactyl.domain,
    settings.pterodactyl.client_key
  );

  const isAuthenticated = (req, res, next) => {
    if (req.session.pterodactyl) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

async function listKeys(prefix) {
  return new Promise((resolve, reject) => {
    const keys = [];
    db.db.each(
      "SELECT [key] FROM keyv WHERE [key] LIKE ?",
      [`${db.namespace}:${prefix}%`],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          keys.push(row.key.replace(`${db.namespace}:`, ''));
        }
      },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(keys);
        }
      }
    );
  });
}

async function getPterodactylUserId(userId) {
  const user = await db.get(`users-${userId}`);
  return user ? user.pterodactyl_id : null;
}


router.post('/teams', isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    const ownerId = req.session.userinfo.id;

    const teamId = Date.now().toString(); 
    const team = {
      id: teamId,
      name,
      owner: ownerId,
      members: [ownerId],
      servers: []
    };

    await db.set(`team-${teamId}`, team);
    res.status(201).json({ success: true, teamId });
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/teams/:teamId/members', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId } = req.body;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can add members' });
    }

    const pterodactylUserId = await getPterodactylUserId(userId);
    if (!pterodactylUserId) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!team.members.includes(userId)) {
      team.members.push(userId);
      await db.set(`team-${teamId}`, team);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding team member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/teams/:teamId/members/:userId', isAuthenticated, async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can remove members' });
    }

    team.members = team.members.filter(memberId => memberId !== userId);
    await db.set(`team-${teamId}`, team);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing team member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/teams/:teamId/servers', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { serverId } = req.body;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (!team.members.includes(req.session.userinfo.id)) {
      return res.status(403).json({ error: 'You are not a member of this team' });
    }

    if (!team.servers.includes(serverId)) {
      team.servers.push(serverId);
      await db.set(`team-${teamId}`, team);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding server to team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/teams/:teamId/servers/:serverId', isAuthenticated, async (req, res) => {
  try {
    const { teamId, serverId } = req.params;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (!team.members.includes(req.session.userinfo.id)) {
      return res.status(403).json({ error: 'You are not a member of this team' });
    }

    team.servers = team.servers.filter(id => id !== serverId);
    await db.set(`team-${teamId}`, team);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing server from team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teams/servers', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userinfo.id;
    const teamKeys = await listKeys('team-');
    const accessibleServers = [];

    for (const teamKey of teamKeys) {
      const team = await db.get(teamKey);
      if (team.members.includes(userId)) {
        for (const serverId of team.servers) {
          const serverDetails = await pterodactylClient.getServerDetails(serverId);
          accessibleServers.push({
            name: serverDetails.name,
            identifier: serverDetails.identifier
          });
        }
      }
    }

    res.json(accessibleServers);
  } catch (error) {
    console.error('Error listing accessible servers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/teams/:teamId', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { name } = req.body;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can edit team settings' });
    }

    team.name = name;
    await db.set(`team-${teamId}`, team);

    res.json({ success: true });
  } catch (error) {
    console.error('Error editing team settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/teams/:teamId', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can delete the team' });
    }

    if (team.servers.length > 0) {
      return res.status(400).json({ error: 'Cannot delete team with servers. Remove all servers first.' });
    }

    await db.delete(`team-${teamId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/teams', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userinfo.id;
    const teamKeys = await listKeys('team-');
    const userTeams = [];

    for (const teamKey of teamKeys) {
      const team = await db.get(teamKey);
      if (team.members.includes(userId)) {
        const memberDetails = await Promise.all(team.members.map(async (memberId) => {
          const user = await db.get(`users-${memberId}`);
          return {
            id: memberId,
            username: user ? user.username : 'Unknown',
            email: user ? user.email : 'Unknown',
            isOwner: memberId === team.owner
          };
        }));

        const serverDetails = await Promise.all(team.servers.map(async (serverId) => {
          try {
            const serverInfo = await pterodactylClient.getServerDetails(serverId);
            return {
              id: serverId,
              name: serverInfo.attributes.name,
              identifier: serverInfo.attributes.identifier,
              node: serverInfo.attributes.node,
              status: serverInfo.attributes.status
            };
          } catch (error) {
            console.error(`Error fetching details for server ${serverId}:`, error);
            return {
              id: serverId,
              name: 'Unknown',
              identifier: 'Unknown',
              node: 'Unknown',
              status: 'Unknown'
            };
          }
        }));

        userTeams.push({
          id: team.id,
          name: team.name,
          owner: team.owner,
          isOwner: team.owner === userId,
          members: memberDetails,
          servers: serverDetails
        });
      }
    }

    res.json(userTeams);
  } catch (error) {
    console.error('Error listing user teams:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const ownsServer = async (req, res, next) => {
  const serverId = req.params.id || req.params.serverId || req.params.instanceId;
  const userId = req.session.pterodactyl.username;
  console.log(`Checking server access for user ${userId} and server ${serverId}`);
  
  const userServers = req.session.pterodactyl.relationships.servers.data;
  const serverOwned = userServers.some(server => server.attributes.identifier === serverId);

  if (serverOwned) {
    console.log(`User ${userId} owns server ${serverId}`);
    return next();
  }

  try {
    const subuserServers = await db.get(`subuser-servers-${userId}`) || [];
    const hasAccess = subuserServers.some(server => server.id === serverId);
    if (hasAccess) {
      console.log(`User ${userId} is a subuser of server ${serverId}`);
      return next();
    }
  } catch (error) {
    console.error('Error checking subuser status:', error);
  }

  console.log(`User ${userId} does not have access to server ${serverId}`);
  res.status(403).json({ error: 'Forbidden.' });
};




router.put('/server/:serverId/startup', isAuthenticated, async (req, res) => {
  try {
    const serverId = req.params.serverId;
    const { startup, environment, egg, image, skip_scripts } = req.body;

    const serverDetailsResponse = await axios.get(
      `${settings.pterodactyl.domain}/api/application/servers/${serverId}?include=container`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    const currentServerDetails = serverDetailsResponse.data.attributes;
    console.log(JSON.stringify(currentServerDetails))

    const updatePayload = {
      startup: startup || currentServerDetails.container.startup_command,
      environment: environment || currentServerDetails.container.environment,
      egg: egg || currentServerDetails.egg,
      image: image || currentServerDetails.container.image,
      skip_scripts: skip_scripts !== undefined ? skip_scripts : false,
    };

    const response = await axios.patch(
      `${settings.pterodactyl.domain}/api/application/servers/${serverId}/startup`,
      updatePayload,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error updating server startup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/server/:id/allocations', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;

    const response = await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/network/allocations`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error assigning allocation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  function saveWorkflowToFile(instanceId, workflow) {
    try {
      let workflows = {};

      if (fs.existsSync(workflowsFilePath)) {
        const data = fs.readFileSync(workflowsFilePath, "utf8");
        workflows = JSON.parse(data);
      }

      workflows[instanceId] = workflow;

      fs.writeFileSync(
        workflowsFilePath,
        JSON.stringify(workflows, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Error saving workflow to file:", error);
    }
  }

  function saveScheduledWorkflows() {
    try {
      const scheduledWorkflows = {};

      for (const job of Object.values(schedule.scheduledJobs)) {
        if (job.name.startsWith("job_")) {
          const instanceId = job.name.split("_")[1];
          scheduledWorkflows[instanceId] = job.nextInvocation();
        }
      }

      fs.writeFileSync(
        scheduledWorkflowsFilePath,
        JSON.stringify(scheduledWorkflows, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Error saving scheduled workflows:", error);
    }
  }

  function loadScheduledWorkflows() {
    try {
      if (fs.existsSync(scheduledWorkflowsFilePath)) {
        const data = fs.readFileSync(scheduledWorkflowsFilePath, "utf8");
        const scheduledWorkflows = JSON.parse(data);

        for (const [instanceId, nextInvocation] of Object.entries(
          scheduledWorkflows
        )) {
          const workflow = loadWorkflowFromFile(instanceId);
          if (workflow) {
            scheduleWorkflowExecution(instanceId, workflow);
          }
        }
      }
    } catch (error) {
      console.error("Error loading scheduled workflows:", error);
    }
  }


  loadScheduledWorkflows();

async function withServerWebSocket(serverId, callback) {
  let ws = null;
  try {
    
    const credsResponse = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/websocket`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    const { socket, token } = credsResponse.data.data;

    
    return new Promise((resolve, reject) => {
      ws = new WebSocket(socket);
      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
        reject(new Error('WebSocket operation timed out'));
      }, 10000); 

      let consoleBuffer = [];
      let authenticated = false;

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('open', () => {
        console.log('WebSocket connection established');
        
        ws.send(JSON.stringify({
          event: "auth",
          args: [token]
        }));
      });

      ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());

        if (message.event === 'auth success') {
          authenticated = true;
          try {
            await callback(ws, consoleBuffer);
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        }
        else if (message.event === 'console output') {
          consoleBuffer.push(message.args[0]);
        }
        else if (message.event === 'token expiring') {
          
          const newCredsResponse = await axios.get(
            `${settings.pterodactyl.domain}/api/client/servers/${serverId}/websocket`,
            {
              headers: {
                'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
                'Accept': 'application/json',
              },
            }
          );
          
          ws.send(JSON.stringify({
            event: "auth",
            args: [newCredsResponse.data.data.token]
          }));
        }
      });

      ws.on('close', () => {
        if (!authenticated) {
          clearTimeout(timeout);
          reject(new Error('WebSocket closed before authentication'));
        }
      });
    });
  } catch (error) {
    console.error(`WebSocket error for server ${serverId}:`, error);
    throw error;
  } finally {
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}


async function sendCommandAndGetResponse(serverId, command, responseTimeout = 5000) {
  return withServerWebSocket(serverId, async (ws, consoleBuffer) => {
    return new Promise((resolve) => {
      
      consoleBuffer.length = 0;

      
      ws.send(JSON.stringify({
        event: "send command",
        args: [command]
      }));

      
      setTimeout(() => {
        resolve([...consoleBuffer]); 
      }, responseTimeout);
    });
  });
}




router.get('/server/:id/logs', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    
    const activityLog = await db.get(`activity_log_${serverId}`) || [];
    
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const totalLogs = activityLog.length;
    const totalPages = Math.ceil(totalLogs / limit);
    
    
    const paginatedLogs = activityLog.slice(startIndex, endIndex);
    
    
    const response = {
      data: paginatedLogs,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_items: totalLogs,
        items_per_page: limit,
        has_more: endIndex < totalLogs
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



  
  router.get(
    "/server/:id/backups",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error fetching backups:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  
  router.post(
    "/server/:id/backups",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups`,
          {},
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(201).json(response.data);
      } catch (error) {
        console.error("Error creating backup:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  
  router.get(
    "/server/:id/backups/:backupId/download",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const backupId = req.params.backupId;
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups/${backupId}/download`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error generating backup download link:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  
  router.delete(
    "/server/:id/backups/:backupId",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const backupId = req.params.backupId;
        await axios.delete(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups/${backupId}`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting backup:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );



  
  router.get(
    "/server/:id/workflow",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        let workflow = await db.get(serverId + "_workflow");
        if (!workflow) {
          workflow = loadWorkflowFromFile(serverId);
        }

        if (!workflow) {
          workflow = {};
        }

        res.json(workflow);
      } catch (error) {
        console.error("Error fetching server details:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );


router.get('/server/:id/variables', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/startup`,
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching server variables:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.put('/server/:id/variables', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { key, value } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Missing key or value' });
    }

    const response = await axios.put(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/startup/variable`,
      { key, value },
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error updating server variable:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/server/:id/files/copy', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { location } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'Missing location' });
    }

    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/copy`,
      { location },
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    res.status(204).send();
  } catch (error) {
    console.error('Error copying file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  
  router.post(
    "/server/:instanceId/workflow/save-workflow",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      const { instanceId } = req.params;
      const workflow = req.body;

      if (!instanceId || !workflow) {
        return res
          .status(400)
          .json({ success: false, message: "Missing required data" });
      }

      try {
        const scheduledJob = schedule.scheduledJobs[`job_${instanceId}`];
        if (scheduledJob) {
          scheduledJob.cancel();
        }

        await db.set(instanceId + "_workflow", workflow);
        saveWorkflowToFile(instanceId, workflow);

        scheduleWorkflowExecution(instanceId, workflow);

        saveScheduledWorkflows();

    await logActivity(db, instanceId, 'Save Workflow', { workflowDetails: workflow });

        res.json({ success: true, message: "Workflow saved successfully" });
      } catch (error) {
        console.error("Error saving workflow:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    }
  );


router.get('/subuser-servers', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.pterodactyl.username;
    console.log(`Fetching subuser servers for user ${userId}`);
    let subuserServers = await db.get(`subuser-servers-${userId}`) || [];
    
    console.log(`Found ${subuserServers.length} subuser servers for user ${userId}`);
    res.json(subuserServers);
  } catch (error) {
    console.error('Error fetching subuser servers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function updateSubuserInfo(serverId, serverOwnerId) {
  try {
    console.log(`Updating subuser info for server ${serverId}`);
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    const subusers = response.data.data.map(user => ({
      id: user.attributes.username,
      username: user.attributes.username,
      email: user.attributes.email,
    }));

    console.log(`Found ${subusers.length} subusers for server ${serverId}`);

    
    await db.set(`subusers-${serverId}`, subusers);

    
    const serverName = await getServerName(serverId);
    for (const subuser of subusers) {
      console.log(`Updating subuser-servers for user ${subuser.id}`);
      let subuserServers = await db.get(`subuser-servers-${subuser.id}`) || [];
      if (!subuserServers.some(server => server.id === serverId)) {
        subuserServers.push({
          id: serverId,
          name: serverName,
          ownerId: serverOwnerId
        });
        await db.set(`subuser-servers-${subuser.id}`, subuserServers);
        console.log(`Added server ${serverId} to subuser-servers for user ${subuser.id}`);
      }
    }

    
    const currentSubuserIds = new Set(subusers.map(u => u.id));
    const allUsers = await db.get('all_users') || [];
    for (const userId of allUsers) {
      let userSubuserServers = await db.get(`subuser-servers-${userId}`) || [];
      const updatedUserSubuserServers = userSubuserServers.filter(server => 
        server.id !== serverId || currentSubuserIds.has(userId)
      );
      if (updatedUserSubuserServers.length !== userSubuserServers.length) {
        await db.set(`subuser-servers-${userId}`, updatedUserSubuserServers);
        console.log(`Updated subuser-servers for user ${userId}`);
      }
    }

  } catch (error) {
    console.error(`Error updating subuser info for server ${serverId}:`, error);
  }
}

router.post('/sync-user-servers', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.pterodactyl.id;
    console.log(`Syncing servers for user ${userId}`);

    
    await addUserToAllUsersList(userId);

    
    const ownedServers = req.session.pterodactyl.relationships.servers.data;
    for (const server of ownedServers) {
      await updateSubuserInfo(server.attributes.identifier, userId);
    }

    
    const subuserServers = await db.get(`subuser-servers-${userId}`) || [];
    for (const server of subuserServers) {
      await updateSubuserInfo(server.id, server.ownerId);
    }

    res.json({ message: 'User servers synced successfully' });
  } catch (error) {
    console.error('Error syncing user servers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


async function getServerName(serverId) {
  try {
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.attributes.name;
  } catch (error) {
    console.error('Error fetching server name:', error);
    return 'Unknown Server';
  }
}

async function addUserToAllUsersList(userId) {
  let allUsers = await db.get('all_users') || [];
  if (!allUsers.includes(userId)) {
    allUsers.push(userId);
    await db.set('all_users', allUsers);
  }
}


router.get('/server/:id/users', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    
    
    await updateSubuserInfo(serverId, req.session.userinfo.id);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching subusers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/server/:id/users', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const response = await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users`,
      { email, permissions: [
          "control.console",
          "control.start",
          "control.stop",
          "control.restart",
          "user.create",
          "user.update",
          "user.delete",
          "user.read",
          "file.create",
          "file.read",
          "file.update",
          "file.delete",
          "file.archive",
          "file.sftp",
          "backup.create",
          "backup.read",
          "backup.delete",
          "backup.update",
          "backup.download",
          "allocation.update",
          "startup.update",
          "startup.read",
          "database.create",
          "database.read",
          "database.update",
          "database.delete",
          "database.view_password",
          "schedule.create",
          "schedule.read",
          "schedule.update",
          "settings.rename",
          "schedule.delete",
          "settings.reinstall",
          "websocket.connect"
        ] },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    
    await updateSubuserInfo(serverId, req.session.userinfo.id);

    
    const newUserId = response.data.attributes.username;
    await addUserToAllUsersList(newUserId);

    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating subuser:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  
  router.delete('/server/:id/users/:subuser', isAuthenticated, ownsServer, async (req, res) => {
    try {
      const { id: serverId, subuser: subuserId } = req.params;
      await axios.delete(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users/${subuserId}`,
        {
          headers: {
            'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting subuser:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  
  router.get("/server/:id", isAuthenticated, ownsServer, async (req, res) => {
    try {
      const serverId = req.params.id;
      const serverDetails = await pterodactylClient.getServerDetails(serverId);
      res.json(serverDetails);
    } catch (error) {
      console.error("Error fetching server details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  
  router.get(
    "/server/:id/websocket",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const wsCredentials = await pterodactylClient.getWebSocketCredentials(
          serverId
        );
        res.json(wsCredentials);
      } catch (error) {
        console.error("Error fetching WebSocket credentials:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  
  router.post(
    "/server/:id/command",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { command } = req.body;
        await pterodactylClient.sendCommand(serverId, command);
        res.json({ success: true, message: "Command sent successfully" });
      } catch (error) {
        console.error("Error sending command:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  
  router.post(
    "/server/:id/power",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { signal } = req.body;

        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/power`,
          {
            signal: signal,
          },
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
            },
          }
        );

        res.status(204).send();
      } catch (error) {
        console.error("Error changing power state:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  
router.get(
  "/server/:id/files/list",
  isAuthenticated,
  ownsServer,
  async (req, res) => {
    try {
      const serverId = req.params.id;
      const directory = req.query.directory || "/";
      const page = parseInt(req.query.page) || 1;
      const perPage = parseInt(req.query.per_page) || 10;

      const response = await axios.get(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/list`,
        {
          params: { 
            directory,
            page: page,
            per_page: perPage
          },
          headers: {
            Authorization: `Bearer ${settings.pterodactyl.client_key}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      
      const totalItems = response.data.meta?.pagination?.total || 0;
      const totalPages = Math.ceil(totalItems / perPage);

      const paginatedResponse = {
        ...response.data,
        meta: {
          ...response.data.meta,
          pagination: {
            ...response.data.meta?.pagination,
            current_page: page,
            per_page: perPage,
            total_pages: totalPages
          }
        }
      };

      res.json(paginatedResponse);
    } catch (error) {
      console.error("Error listing files:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

  
  router.get(
    "/server/:id/files/contents",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = encodeURIComponent(req.query.file); 
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/contents?file=${file}`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            responseType: "text", 
          }
        );

        

        
        res.send(response.data);
      } catch (error) {
        console.error("Error getting file contents:", error);

        
        if (error.response) {
          console.error("Error response data:", error.response.data);
        }

        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  
  router.get(
    "/server/:id/files/download",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = req.query.file;
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/download`,
          {
            params: { file },
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error getting download link:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.post(
    "/server/:id/files/write",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = encodeURIComponent(req.query.file); 
        const content = req.body; 

        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/write?file=${file}`,
          content, 
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "text/plain", 
            },
          }
        );

    await logActivity(db, serverId, 'Write File', { file });

        res.status(204).send(); 
      } catch (error) {
        console.error("Error writing file:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.post(
    "/server/:id/files/compress",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/compress`,
          { root, files },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(200).json(response.data);
      } catch (error) {
        console.error("Error compressing files:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.post(
    "/server/:id/files/decompress",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, file } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/decompress`,
          { root, file },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(204).send();
      } catch (error) {
        console.error("Error decompressing file:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.post(
    "/server/:id/files/delete",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/delete`,
          { root, files },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
    await logActivity(db, serverId, 'Delete File', { root, files });
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting files:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.get(
    "/server/:id/files/upload",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const directory = req.query.directory || "/";
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/upload`,
          {
            params: { directory },
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error getting upload URL:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.post(
    "/server/:id/files/create-folder",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, name } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/create-folder`,
          { root, name },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(204).send();
      } catch (error) {
        console.error("Error creating folder:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.put(
    "/server/:id/files/rename",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await axios.put(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/rename`,
          { root, files },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(204).send();
      } catch (error) {
        console.error("Error renaming file/folder:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );


const RENEWAL_PERIOD_HOURS = Infinity;
const WARNING_THRESHOLD_HOURS = 24; 
const CHECK_INTERVAL_MINUTES = 5; 

async function initializeRenewalSystem(db) {
  setInterval(async () => {
    await checkExpiredServers(db);
  }, CHECK_INTERVAL_MINUTES * 60 * 1000);
}

async function getRenewalStatus(db, serverId, user) {
  try {
    const renewalData = await db.get(`renewal_${serverId}`);
    const hasRenewalBypass = await db.get(`renewbypass-${user}`);
    
    if (!renewalData) {
      const now = new Date();
      const nextRenewal = hasRenewalBypass ? 
        new Date('2099-12-31T23:59:59.999Z').toISOString() : 
        new Date(now.getTime() + RENEWAL_PERIOD_HOURS * 60 * 60 * 1000).toISOString();
      
      const initialRenewalData = {
        lastRenewal: now.toISOString(),
        nextRenewal: nextRenewal,
        isActive: true,
        renewalCount: 0,
        hasRenewalBypass: hasRenewalBypass
      };
      await db.set(`renewal_${serverId}`, initialRenewalData);
      return initialRenewalData;
    }

    if (hasRenewalBypass && !renewalData.hasRenewalBypass) {
      const updatedRenewalData = {
        ...renewalData,
        nextRenewal: new Date('2099-12-31T23:59:59.999Z').toISOString(),
        hasRenewalBypass: true,
        isActive: true 
      };
      await db.set(`renewal_${serverId}`, updatedRenewalData);
      return updatedRenewalData;
    }

    return renewalData;
  } catch (error) {
    console.error(`Error getting renewal status for server ${serverId}:`, error);
    throw new Error('Failed to get renewal status');
  }
}

async function renewServer(db, serverId) {
  try {
    const now = new Date();
    const renewalData = await getRenewalStatus(db, serverId);
    
    const updatedRenewalData = {
      lastRenewal: now.toISOString(),
      nextRenewal: new Date(now.getTime() + RENEWAL_PERIOD_HOURS * 60 * 60 * 1000).toISOString(),
      isActive: true,
      renewalCount: (renewalData.renewalCount || 0) + 1
    };
    
    await db.set(`renewal_${serverId}`, updatedRenewalData);
    await logActivity(db, serverId, 'Server Renewal', {
      renewalCount: updatedRenewalData.renewalCount,
      nextRenewal: updatedRenewalData.nextRenewal
    });
    
    return updatedRenewalData;
  } catch (error) {
    console.error(`Error renewing server ${serverId}:`, error);
    throw new Error('Failed to renew server');
  }
}

async function checkExpiredServers(db) {
  try {
    const renewalKeys = await listKeys('renewal_');
    const now = new Date();

    for (const key of renewalKeys) {
      const serverId = key.replace('renewal_', '');
      const renewalData = await db.get(key);

      if (!renewalData || !renewalData.isActive) continue;

      const nextRenewal = new Date(renewalData.nextRenewal);
      const hoursUntilExpiration = (nextRenewal - now) / (1000 * 60 * 60);

      if (hoursUntilExpiration <= 0) {
        await handleExpiredServer(db, serverId);
      }
    }
  } catch (error) {
    console.error('Error checking expired servers:', error);
  }
}

async function handleExpiredServer(db, serverId) {
  try {
    const renewalData = await db.get(`renewal_${serverId}`);
    renewalData.isActive = false;
    await db.set(`renewal_${serverId}`, renewalData);

    await executePowerAction(serverId, 'stop');

    await logActivity(db, serverId, 'Server Expired', {
      lastRenewal: renewalData.lastRenewal,
      renewalCount: renewalData.renewalCount
    });
  } catch (error) {
    console.error(`Error handling expired server ${serverId}:`, error);
  }
}

router.get('/server/:id/renewal/status', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const renewalStatus = await getRenewalStatus(db, serverId, req.session.userinfo.id);
    
    const now = new Date();
    const nextRenewal = new Date(renewalStatus.nextRenewal);
    const timeRemaining = nextRenewal - now;
    
    const response = {
      ...renewalStatus,
      timeRemaining: {
        total: timeRemaining,
        hours: Math.floor(timeRemaining / (1000 * 60 * 60)),
        minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((timeRemaining % (1000 * 60)) / 1000)
      },
      requiresRenewal: timeRemaining <= WARNING_THRESHOLD_HOURS * 60 * 60 * 1000,
      isExpired: timeRemaining <= 0
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error getting renewal status:', error);
    res.status(500).json({ error: 'Failed to get renewal status' });
  }
});


router.post('/server/:id/renewal/renew', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const currentStatus = await getRenewalStatus(db, serverId);
    
    const now = new Date();
    const nextRenewal = new Date(currentStatus.nextRenewal);
    const timeRemaining = nextRenewal - now;
    
    if (timeRemaining > WARNING_THRESHOLD_HOURS * 60 * 60 * 1000) {
      return res.status(400).json({
        error: 'Renewal not required yet',
        nextRenewal: currentStatus.nextRenewal,
        timeRemaining: {
          hours: Math.floor(timeRemaining / (1000 * 60 * 60)),
          minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))
        }
      });
    }
    
    const renewalData = await renewServer(db, serverId);
    
    if (!currentStatus.isActive) {
      await executePowerAction(serverId, 'start');
    }
    
    res.json({
      message: 'Server renewed successfully',
      renewalData
    });
  } catch (error) {
    console.error('Error renewing server:', error);
    res.status(500).json({ error: 'Failed to renew server' });
  }
});



initializeRenewalSystem(db);

  app.use("/api", router);
};

function scheduleWorkflowExecution(instanceId, workflow) {
  const blocks = workflow.blocks;
  const intervalBlock = blocks.find((block) => block.type === "interval");

  if (intervalBlock) {
    const intervalMinutes = parseInt(intervalBlock.meta.selectedValue, 10);
    const rule = new schedule.RecurrenceRule();
    rule.minute = new schedule.Range(0, 59, intervalMinutes);

    const jobId = `job_${instanceId}`;

    const nextExecution = schedule.scheduleJob(jobId, rule, () => {
      executeWorkflow(instanceId);
      saveScheduledWorkflows();
    });

    logCountdownToNextExecution(nextExecution, intervalMinutes);
    setInterval(() => checkWorkflowValidity(instanceId, nextExecution), 5000);
  }
}

function saveScheduledWorkflows() {
  try {
    const scheduledWorkflows = {};

    for (const job of Object.values(schedule.scheduledJobs)) {
      if (job.name.startsWith("job_")) {
        const instanceId = job.name.split("_")[1];
        scheduledWorkflows[instanceId] = job.nextInvocation();
      }
    }

    fs.writeFileSync(
      scheduledWorkflowsFilePath,
      JSON.stringify(scheduledWorkflows, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Error saving scheduled workflows:", error);
  }
}

function logCountdownToNextExecution(scheduledJob, intervalMinutes) {
  const logInterval = setInterval(() => {
    const now = new Date();
    const nextDate = new Date(scheduledJob.nextInvocation());

    if (!isNaN(nextDate.getTime())) {
      const timeDiffMs = nextDate - now;
      const totalSecondsRemaining = Math.ceil(timeDiffMs / 1000);

      const minutesRemaining = Math.floor(totalSecondsRemaining / 60);
      const secondsRemaining = totalSecondsRemaining % 60;

      if (timeDiffMs > 0) {
      } else {
        clearInterval(logInterval);
      }
    } else {
      console.error(
        "Invalid next execution time. Cannot calculate remaining time."
      );
      clearInterval(logInterval);
    }
  }, 5000);
}

async function checkWorkflowValidity(instanceId, scheduledJob) {
  const workflow = loadWorkflowFromFile(instanceId);
  if (!workflow) {
    scheduledJob.cancel();
  }
}

function executeWorkflow(instanceId) {
  const workflow = loadWorkflowFromFile(instanceId);

  if (workflow) {
    const blocks = workflow.blocks;

    blocks
      .filter((block) => block.type === "power")
      .forEach((block) => {
        executePowerAction(instanceId, block.meta.selectedValue).then(
          (success) => {
            if (success) {
              const webhookBlock = blocks.find((b) => b.type === "webhook");
              if (webhookBlock) {
                sendWebhookNotification(
                  webhookBlock.meta.inputValue,
                  `Successfully executed power action: ${block.meta.selectedValue}`
                );
              }
            }
          }
        );
      });
  } else {
    console.error(`No workflow found for instance ${instanceId}`);
  }
}

async function executePowerAction(instanceId, powerAction) {
  try {
    const validActions = ['start', 'stop', 'restart', 'kill'];
    if (!validActions.includes(powerAction)) {
      throw new Error(`Invalid power action: ${powerAction}`);
    }

    const response = await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${instanceId}/power`,
      { signal: powerAction },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
        },
      }
    );

    if (response.status === 204) {
      console.log(`Successfully executed power action: ${powerAction} for server ${instanceId}`);
      return true;
    } else {
      console.error(`Unexpected response status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`Error executing power action for server ${instanceId}:`, error.message);
    return false;
  }
}

async function sendWebhookNotification(webhookUrl, message) {
  try {
    await axios.post(webhookUrl, {
      content: message,
    });
  } catch (error) {
    console.error("Failed to send webhook notification:", error.message);
  }
}

function loadWorkflowFromFile(instanceId) {
  try {
    if (fs.existsSync(workflowsFilePath)) {
      const data = fs.readFileSync(workflowsFilePath, "utf8");
      const workflows = JSON.parse(data);
      return workflows[instanceId] || null;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error loading workflow from file:", error);
    return null;
  }
}


PterodactylClientModule.prototype.getWebSocketCredentials = async function (
  serverId
) {
  try {
    const response = await axios.get(
      `${this.apiUrl}/api/client/servers/${serverId}/websocket`,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching WebSocket credentials:", error);
    throw error;
  }
};

PterodactylClientModule.prototype.sendCommand = async function (
  serverId,
  command
) {
  await this.connectWebSocket(serverId);
  this.sendToWebSocket("send command", [command]);
};

PterodactylClientModule.prototype.setPowerState = async function (
  serverId,
  state
) {
  await this.connectWebSocket(serverId);
  this.sendToWebSocket("set state", [state]);
};
