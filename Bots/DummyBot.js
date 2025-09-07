const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
//const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
//const armorManager = require('mineflayer-armor-manager')
//const Vec3 = require('vec3')

function getArg(flag, fallback = undefined) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i+1] ? process.argv[i + 1]: fallback;
  }
const ACK     = process.env.ACK     || getArg('--ack', '')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost', // DO NOT PUSH HARDCODED CHANGES TO THESE VALUES.
  port: process.env.MC_PORT || 25565, // DO NOT PUSH HARDCODED CHANGES TO THESE VALUES.
  username: process.env.BOTNAME || getArg('--name', `dummy_bot`),
  version: '1.21.4',
  auth: 'offline', // or 'mojang' for older versions
});

bot.once('spawn', () => {
  bot.chat(`/minecraft:msg ADMINBOT `+ACK)
})