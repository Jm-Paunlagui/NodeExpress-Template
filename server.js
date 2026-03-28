const dotenv = require('dotenv');
dotenv.config({ path: '.env' });


const db = require('./src/config');
const { logger } = require('./src/utils/logger');

// db.withConnection('userAccount', async (conn) => {
//     const result = await conn.execute('SELECT 1 FROM DUAL');
//     logger.info('Query result:', result.rows);
// }).catch((err) => {
//     logger.error('Error executing query:', err);
// });

// db.withConnection('unitInventory', async (conn) => {
//     const result = await conn.execute('SELECT 1 FROM DUAL');
//     logger.info('Query result:', result.rows);
// }).catch((err) => {
//     logger.error('Error executing query:', err);
// });