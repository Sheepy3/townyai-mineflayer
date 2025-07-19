const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
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

function get_nearest_entity(){
    const nearest = bot.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== bot.username
      )
    //console.log(nearest)
    return nearest
}


bot.on('physicsTick', async () => {
    
    if(target == null){
        
        potential_target = get_nearest_entity()
        
        if (potential_target != null){
            if (bot.entity.position.distanceTo(potential_target.position) < targetting_range){
                target = potential_target
                bot.pathfinder.setGoal(target)
                console.log("hi")
            }
        }
        
    }
});
