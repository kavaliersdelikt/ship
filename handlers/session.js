const mysql = require('mysql2/promise');
const { Store } = require('express-session');

class MySQLSessionStore extends Store {
  constructor(options) {
    super();
    this.pool = mysql.createPool({
      host: options.host || 'localhost',
      user: options.user || 'root',
      password: options.password,
      database: options.database,
      waitForConnections: true,
      connectionLimit: options.connectionLimit || 10,
      queueLimit: 0
    });

    
    this.initializeTable().catch(err => {
      console.error('There was an error while trying to initialize sessions table:', err);
      throw err; 
    });
  }

  async initializeTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(255) NOT NULL PRIMARY KEY,
        session TEXT NOT NULL,
        expires TIMESTAMP NOT NULL
      ) ENGINE=InnoDB;
    `;

    try {
      const conn = await this.pool.getConnection();
      await conn.execute(createTableSQL);
      console.log('Sessions have been initialized successfully.');
      conn.release();
    } catch (err) {
      console.error('Error while trying to initialize sessions table:', err);
      throw err;
    }
  }

  async get(sid, callback) {
    try {
      const conn = await this.pool.getConnection();
      const [rows] = await conn.execute(
        'SELECT session FROM sessions WHERE sid = ? AND expires > NOW()',
        [sid]
      );
      conn.release();

      if (rows.length === 0) {
        return callback(null, null);
      }

      const sessionData = JSON.parse(rows[0].session);
      callback(null, sessionData);
    } catch (err) {
      console.error(`There was an error while trying to get session: ${sid}`, err);
      callback(err);
    }
  }

  async set(sid, session, callback) {
    try {
      const conn = await this.pool.getConnection();
      const expires = new Date(Date.now() + (session.cookie.maxAge || 86400000));
      const sessionString = JSON.stringify(session);

      await conn.execute(
        'INSERT INTO sessions (sid, session, expires) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE session = ?, expires = ?',
        [sid, sessionString, expires, sessionString, expires]
      );
      conn.release();
      callback(null);
    } catch (err) {
      console.error(`There was an error while trying to set session: ${sid}`, err);
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      const conn = await this.pool.getConnection();
      await conn.execute('DELETE FROM sessions WHERE sid = ?', [sid]);
      conn.release();
      callback(null);
    } catch (err) {
      console.error(`There was an error while trying to destroy session: ${sid}`, err);
      callback(err);
    }
  }

  async clearExpiredSessions() {
    try {
      const conn = await this.pool.getConnection();
      await conn.execute('DELETE FROM sessions WHERE expires <= NOW()');
      conn.release();
    } catch (err) {
      console.error('There was an error while trying to clear expired sessions:', err);
    }
  }
}

module.exports = MySQLSessionStore;