const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')

//const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'173.73.200.194',//host: '173.73.200.194',
  port: 25565,
  username: 'Fighter',
  version: '1.21.4',
  auth: 'offline'
});

//PLUGINS
bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

//VARIABLES & CONSTANTS
var state ="idle"
var target = null
const TARGETING_RANGE = 10
const KITE_RANGE = 50
const REACH = 3
const CPS = 3 //sheepy cps
const COOLDOWN = new Map()
const LASTACTION = new Map()

// COOLDOWNS
COOLDOWN.set('attack',1000/CPS) //time between attacks, modify via CPS const
COOLDOWN.set('stateprint',500) // time between console output of state



/*bot state priority
1. heal
2. eat food
3. equip gear 
4. attack target
5. move to target
6. get new target
*/

bot.on("death", () => {
    bot_reset()
});


bot.on('physicsTick', async () => {
    //bot decision tree is an if else loop, meaning it can only be in one state at a time. 
    if(target == null){
        get_new_target()
    }
    else if (bot.entity.position.distanceTo(target.position) > REACH){
        if(bot.entity.position.distanceTo(target.position) > KITE_RANGE){
            console.log("kited")
            bot_reset()
            return
        }
        move_to_target()
    }

    else{
        attack_target()
    }
    if (canDoAction("stateprint")){
        console.log(state)
    }else{
    }
    //console.log(bot.getControlState('sprint'))
});

function bot_reset(){
    bot.setControlState('sprint', false)
    target = null
    bot.pathfinder.setGoal(null)
    console.log("RESETTING")

}

function get_new_target(){
    state = "LOOKING FOR TARGET"
    //console.log("getting new target")
    potential_target = get_nearest_player()
    if (potential_target && 
        bot.entity.position.distanceTo(potential_target.position) < TARGETING_RANGE){
            target = potential_target  
        } 
}

function move_to_target(){
    state = "MOVING TO TARGET"
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 1))
}

function attack_target(){
    //console.log(bot.entity.position.distanceTo(target.position))
    console.log(target)
    state = "ATTACKING TARGET"
    bot.lookAt(target.position)
    if(canDoAction("attack")){
        bot.attack(target)
    }
}

//HELPEER FIUUNCIONS
function get_nearest_player(){
    const nearest = bot.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== bot.username
      )
    //console.log(nearest)
    return nearest
}

function canDoAction(action){
    const now = Date.now();
    const last = LASTACTION.get(action) || 0;
    if (COOLDOWN.get(action) < (now - last)){
        LASTACTION.set(action, now);
        return true;
    }
    return false;
}
