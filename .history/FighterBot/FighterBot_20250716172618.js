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

//VARIABLES & CONSTANTS
var state ="idle"
var target = null
const TARGETING_RANGE = 10
const KITE_RANGE = 50
const REACH = 3

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


/*bot state priority
1. heal
2. eat food
3. equip gear 
4. attack target
5. move to target
6. get to target

*/
bot.on('physicsTick', async () => {
    
    if(target == null){
        get_new_target()
    }
    else if (bot.entity.position.distanceTo(potential_target.position) > REACH &&
            bot.entity.position.distanceTo(potential_target.position) < KITE_RANGE
    ) {
    move_to_target();
    }
    else{
        attack_target()
    }
});



function get_new_target(){
    //console.log("getting new target")
    potential_target = get_nearest_player()
    if (potential_target && 
        bot.entity.position.distanceTo(potential_target.position) < targetting_range){
            target = potential_target
        } 
}

function move_to_target(){
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 1))
    console.log("hi") 
}

function attack_target(){
    console.log("attacking!")
}

//function 