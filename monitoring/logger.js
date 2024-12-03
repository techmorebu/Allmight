const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true, // Handle console exceptions gracefully
      format: winston.format.combine(
        winston.format.colorize(), // Colorize console output for better readability
        winston.format.simple()    // Use simple format for console logs
      ),
    }),
    new winston.transports.File({
      filename: 'logs/data-collection.log',
      handleExceptions: true, // Handle file transport exceptions gracefully
      maxsize: 5242880, // 5MB log file size limit
      maxFiles: 5, // Rotate logs, keeping the last 5 files
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: 'logs/exceptions.log', // Separate log file for uncaught exceptions
      maxsize: 5242880,
      maxFiles: 2,
    }),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

// Test the logger when run directly
if (require.main === module) {
  logger.info('This is an info log.');
  logger.warn('This is a warning log.');
  logger.error('This is an error log.');
  throw new Error('This is a test exception to log.');
}

module.exports = { logger };
