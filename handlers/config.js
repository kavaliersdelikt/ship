const fs = require('fs');
const toml = require('@iarna/toml');

let config = null;
let watcher = null;


function loadConfig(filePath = 'config.toml') {
  try {
    
    const tomlString = fs.readFileSync(filePath, 'utf8');
    
    
    config = toml.parse(tomlString);
    
    
    if (!watcher) {
      watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          try {
            const updatedTomlString = fs.readFileSync(filePath, 'utf8');
            config = toml.parse(updatedTomlString);
            console.log('Configuration updated');
          } catch (watcherErr) {
            console.error('Error updating configuration:', watcherErr);
          }
        }
      });
    }
    
    
    return config;
  } catch (err) {
    console.error('Error reading or parsing the TOML file:', err);
    throw err;
  }
}

module.exports = loadConfig;