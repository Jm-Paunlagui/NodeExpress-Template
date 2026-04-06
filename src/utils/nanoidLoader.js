const { logger } = require('./logger');

// Check if we're running as a compiled executable
const isCompiled = typeof process.pkg !== 'undefined';

let nanoid;

try {
    if (isCompiled) {
        logger.info('Running as compiled executable, loading ID generator');

        // Try nanoid v3 first (CommonJS compatible)
        try {
            const { nanoid: nanoidFunction } = require('nanoid');
            nanoid = nanoidFunction;
            logger.info('Successfully loaded nanoid v3 using CommonJS');
        } catch (nanoidError) {
            logger.warn('Nanoid failed, trying uuid', {
                error: nanoidError.message,
            });

            // Fallback to uuid v4
            try {
                const { v4: uuidv4 } = require('uuid');
                nanoid = (size = 21) => {
                    // Generate uuid and remove dashes, then trim to requested size
                    const uuid = uuidv4().replace(/-/g, '');
                    return uuid.substring(0, size);
                };
                logger.info('Successfully loaded uuid as nanoid fallback');
            } catch (uuidError) {
                throw uuidError; // Let it fall through to main catch
            }
        }
    } else {
        // Normal Node.js environment
        logger.info('Loading ID generator in normal Node.js environment');

        try {
            const { nanoid: nanoidFunction } = require('nanoid');
            nanoid = nanoidFunction;
            logger.info('Successfully loaded nanoid v3');
        } catch (nanoidError) {
            logger.warn('Nanoid failed, trying uuid', {
                error: nanoidError.message,
            });

            const { v4: uuidv4 } = require('uuid');
            nanoid = (size = 21) => {
                const uuid = uuidv4().replace(/-/g, '');
                return uuid.substring(0, size);
            };
            logger.info('Successfully loaded uuid as nanoid fallback');
        }
    }
} catch (error) {
    logger.error('All ID generators failed, using crypto fallback', {
        error: error.message,
    });

    // Fallback to a crypto-based ID generator (more secure than Math.random)
    const crypto = require('crypto');
    nanoid = (size = 21) => {
        const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        let id = '';
        const randomBytes = crypto.randomBytes(size);

        for (let i = 0; i < size; i++) {
            id += alphabet[randomBytes[i] % alphabet.length];
        }

        return id;
    };
    logger.info('Using crypto-based fallback ID generator');
}

// Helper function for compatibility
async function getNanoid() {
    return nanoid;
}

module.exports = { nanoid, getNanoid };
