const winston = require("winston");

function createLogger() {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp }) => {
        return `${message}`;
      })
    ),
    transports: [
      new winston.transports.Console()
    ],
  });

  
  const originalLog = console.log;
  console.log = function () {
    const args = Array.from(arguments); 
    const combinedMessage = args.map(arg => arg.toString()).join(' '); 

    
    logger.info(combinedMessage);
  };

  return logger;
}

module.exports = createLogger;
