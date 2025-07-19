const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')

//const Vec3 = require('vec3')

const bot = mineflayer.createBot({
  host:'173.73.200.194',//host: '173.73.200.194',
  port: 25565,
  username: 'Fighter',
  version: '1.21.4',
  auth: 'offline'
});

//
var state ="idle"
var target = null
const targetting_range = 10
bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

function get_nearest_player(){
    const nearest = bot.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== bot.username
      )
    //console.log(nearest)
    return nearest
}


bot.on('physicsTick', async () => {
    
    if(target == null){
        get_new_target()
    }
    if (target){
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 1))
            console.log("hi")
    }
});

function get_new_target(){
    potential_target = get_nearest_player()
    if (potential_target && 
        bot.entity.position.distanceTo(potential_target.position) < targetting_range){
            target = potential_target
        } 
}