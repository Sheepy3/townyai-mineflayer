const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')

//const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'173.73.200.194',//host: '173.73.200.194',
  port: 25565,
  username: 'eatingbot',
  version: '1.21.4',
  auth: 'offline', // or 'mojang' for older versions
});

//PLUGINS
bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

// Initial gearing on spawn
bot.once('spawn', () => {
    console.log('Bot spawned and holding right click.');
    bot.activateItem();
})

bot.on('physicsTick', async () => {
    bot.activateItem();
})