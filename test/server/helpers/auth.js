'use strict';

const jwt = require('jsonwebtoken');

function signToken(payload = {}, expiresIn = '1h') {
    return jwt.sign(
        { sub: 'test-user', userLevel: 1, ...payload },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn },
    );
}

module.exports = { signToken };