const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const fetch = require('node-fetch')

module.exports = (action, message) => {
    if (!settings.logging.status) return
    if (!settings.logging.actions.user[action] && !settings.logging.actions.admin[action]) return

    console.log(action, message);

    fetch(settings.logging.webhook, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            embeds: [
                {
                    color: hexToDecimal('#FFFFFF'),
                    title: `Event: \`${action}\``,
                    description: message,
                    author: {
                        name: 'Logging'
                    },
                    thumbnail: {
                        url: '' 
                    }
                }
            ]
        })
    })
    .catch(() => {})
}

function hexToDecimal(hex) {
    return parseInt(hex.replace("#", ""), 16)
}