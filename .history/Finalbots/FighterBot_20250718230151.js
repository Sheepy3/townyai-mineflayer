const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')

//const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'localhost',//host: '173.73.200.194',
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
    0. equip armor [not yet implemented] -> implement command to set state to gearing, and then   
1. heal [not yet implemented] -> check if health below threshold, and run heal()
2. eat food [not yet implemented]   -> check if hunger below threshold, and run eat()
3. attack target [basic]
4. move to target [basic]
5. get new target [basic]
*/

bot.on("death", () => {
    bot_reset()
});

bot.on('entityGone', (entity) => {
    if (target && entity.id === target.id) {
        console.log("Target entity is gone (died or left)");
        bot_reset();
    }
});


bot.on('physicsTick', async () => {
    //bot decision tree is an if else loop, meaning it can only be in one state at a time. 
    // to add a new state to the front (eg needed for health and hunger) change previous first "if" to an "else if"
    // and add a new if to the front.  
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

    //logging
    if (canDoAction("stateprint")){
        console.log(state)
    }else{
    
    }
});



//STATE FUNCTIONS

function eat(){

}


function heal(){
    
}

function get_new_target(){
    state = "LOOKING FOR TARGET"
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
    state = "ATTACKING TARGET"
    // Look at the target's eye level (1.62 above position.y for players)
    const eyePos = target.position.offset(0, 1.62, 0);
    bot.lookAt(eyePos);
    if(canDoAction("attack")){
        bot.attack(target)
    }
}


//HELPER FUNCTIONS
function get_nearest_player(){
    const nearest = bot.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== bot.username
      )
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

function bot_reset(){
    bot.setControlState('sprint', false)
    target = null
    bot.pathfinder.setGoal(null)
    console.log("RESETTING")
}

