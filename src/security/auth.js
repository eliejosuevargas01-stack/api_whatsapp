import {  config } from '../config.js';

export function authMiddleware(req, reply, done) {
    const header = req.headers.authorization  || '';
    const [type, token] = header.split(' ');

    if (type !== 'Bearer' || token !== config.apiKey) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
    }
    done();
}  