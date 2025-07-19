const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const Vec3 = require('vec3')
const bot = mineflayer.createBot({
  host:'107.138.47.146',//host: '173.73.200.194',
  port: 25565,
  username: 'pot_bot',
  version: '1.21.4',
  auth: 'offline'
});

var state ="idle"

